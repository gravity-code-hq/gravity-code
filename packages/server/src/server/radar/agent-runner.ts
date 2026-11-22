import type { Logger } from "pino";
import { getUnattendedModeId } from "@gravity/protocol/provider-manifest";
import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import { ensureAgentLoaded } from "../agent/agent-loading.js";
import {
  formatSystemNotificationPrompt,
  startAgentRun,
  type AgentRunController,
} from "../agent/agent-prompt.js";
import {
  generateStructuredAgentResponseWithFallback,
  type StructuredGenerationProvider,
} from "../agent/agent-response-loop.js";
import { type BoundCreateAgentCommand, formatProviderModel } from "../agent/create-agent/create.js";
import type { ProviderSnapshotManager } from "../agent/provider-snapshot-manager.js";
import {
  resolveStructuredGenerationProviders,
  type StructuredGenerationDaemonConfig,
} from "../agent/structured-generation-providers.js";
import { execCommand } from "../../utils/spawn.js";
import type { PersistedWorkspaceRecord } from "../workspace-registry.js";
import { RadarTriageSchema } from "./prompts.js";
import type {
  RadarPullRequestState,
  RadarTaskRunner,
  RadarTaskRunResult,
  RadarTriage,
} from "./service.js";

type RadarAgentManager = Pick<
  AgentRunController,
  | "getAgent"
  | "reloadAgentSession"
  | "tryRunOutOfBand"
  | "hasInFlightRun"
  | "replaceAgentRun"
  | "steerOrReplaceActiveTurn"
  | "streamAgent"
> &
  Pick<
    AgentManager,
    | "createAgent"
    | "getRegisteredProviderIds"
    | "hydrateTimelineFromProvider"
    | "resumeAgentFromPersistence"
    | "runAgent"
    | "waitForAgentEvent"
    | "waitForAgentClose"
  >;

function assertAgentFinished(
  agentId: string,
  waitResult: Awaited<ReturnType<AgentManager["waitForAgentEvent"]>>,
): void {
  if (waitResult.permission) {
    throw new Error(`Radar agent ${agentId} is waiting for permission`);
  }
  if (waitResult.status === "error") {
    throw new Error(waitResult.lastMessage ?? `Radar agent ${agentId} failed`);
  }
}

/**
 * A task is one agent conversation. The first turn creates it in the project's
 * existing workspace, or in a worktree of its own when the task is isolated;
 * later turns (a follow-up question, the merged ✅)
 * go back into the same conversation so the agent keeps what it learned. If
 * the user archived that conversation, the turn starts a fresh one.
 */
export function createRadarTaskRunner(deps: {
  agentManager: RadarAgentManager;
  agentStorage: AgentStorage;
  createAgent: BoundCreateAgentCommand;
  resolveWorkspace: (input: { cwd: string }) => Promise<PersistedWorkspaceRecord>;
  /** Cuts a new Gravity worktree for one task and returns its workspace. */
  createWorktreeWorkspace: (input: {
    cwd: string;
    summary: string;
  }) => Promise<PersistedWorkspaceRecord>;
  logger: Logger;
}): RadarTaskRunner {
  const logger = deps.logger.child({ module: "radar-agent-runner" });

  async function resume(agentId: string, prompt: string): Promise<string> {
    const agent = await ensureAgentLoaded(agentId, {
      agentManager: deps.agentManager,
      agentStorage: deps.agentStorage,
      logger,
    });
    if (deps.agentManager.hasInFlightRun(agent.id)) {
      throw new Error(`Agent ${agent.id} already has an active run`);
    }
    await startAgentRun(
      deps.agentManager,
      agent.id,
      formatSystemNotificationPrompt(prompt),
      logger,
      { replaceRunning: true, activeTurnBehavior: "steer" },
    );
    const waitResult = await deps.agentManager.waitForAgentEvent(agent.id, {
      waitForActive: true,
    });
    assertAgentFinished(agent.id, waitResult);
    return waitResult.lastMessage ?? "";
  }

  // Tasks of one radar start side by side. Resolving one at a time keeps the
  // first two tasks on a folder with no workspace from each creating one.
  let resolving: Promise<unknown> = Promise.resolve();
  function resolveWorkspace(cwd: string): Promise<PersistedWorkspaceRecord> {
    const next = resolving.catch(() => undefined).then(() => deps.resolveWorkspace({ cwd }));
    resolving = next;
    return next;
  }

  return async ({ radar, task, prompt, onAgent }): Promise<RadarTaskRunResult> => {
    if (task.agentId) {
      const record = await deps.agentStorage.get(task.agentId);
      if (record && !record.archivedAt) {
        const finalText = await resume(task.agentId, prompt);
        return { agentId: task.agentId, workspaceId: task.workspaceId, finalText };
      }
    }

    // The ✅ turn changes no code, so it never needs a worktree of its own,
    // even when the task's first conversation (and its worktree) is gone.
    const ownWorktree = task.isolation === "worktree" && task.step !== "merged";
    const workspace = ownWorktree
      ? await deps.createWorktreeWorkspace({ cwd: radar.cwd, summary: task.summary })
      : await resolveWorkspace(radar.cwd);
    const modeId = getUnattendedModeId(radar.provider);
    const created = await deps.createAgent({
      kind: "mcp",
      provider: formatProviderModel(radar.provider, radar.model),
      config: {
        provider: radar.provider,
        cwd: workspace.cwd,
        ...(modeId ? { modeId } : {}),
        ...(radar.model ? { model: radar.model } : {}),
      },
      cwd: workspace.cwd,
      workspaceId: workspace.workspaceId,
      title: task.summary,
      labels: {
        "gravity.radar-id": radar.id,
        "gravity.radar-task": task.id,
      },
      mode: modeId,
      unattended: true,
      promptFailure: "return-error",
      background: true,
      notifyOnFinish: false,
    });
    const agent = created.snapshot;
    await onAgent({ agentId: agent.id, workspaceId: workspace.workspaceId });
    if (created.initialPromptError) {
      throw created.initialPromptError;
    }
    const result = await deps.agentManager.runAgent(agent.id, prompt);
    const waitResult = await deps.agentManager.waitForAgentEvent(agent.id, {
      waitForActive: true,
    });
    if (result.canceled) {
      throw new Error(`Radar agent ${agent.id} was canceled`);
    }
    assertAgentFinished(agent.id, waitResult);
    return {
      agentId: agent.id,
      workspaceId: workspace.workspaceId,
      finalText: waitResult.lastMessage ?? result.finalText,
    };
  };
}

/**
 * The check runs as a hidden agent that never appears in a workspace, on the
 * cheapest model the radar's provider offers. It stays on that provider: the
 * Slack tools belong to the provider's login, so falling back to another one
 * would report Slack as unreachable.
 */
export function createRadarTriage(deps: {
  agentManager: AgentManager;
  providerSnapshotManager: Pick<ProviderSnapshotManager, "listProviders">;
  readDaemonConfig: () => StructuredGenerationDaemonConfig;
  logger: Logger;
}): RadarTriage {
  return async ({ cwd, provider, prompt }) => {
    const candidates = await resolveStructuredGenerationProviders({
      cwd,
      providerSnapshotManager: deps.providerSnapshotManager,
      daemonConfig: deps.readDaemonConfig(),
      currentSelection: { provider },
    });
    const sameProvider = candidates.filter((candidate) => candidate.provider === provider);
    const providers: StructuredGenerationProvider[] =
      sameProvider.length > 0 ? sameProvider : [{ provider }];
    const modeId = getUnattendedModeId(provider);
    return generateStructuredAgentResponseWithFallback({
      manager: deps.agentManager,
      cwd,
      prompt,
      schema: RadarTriageSchema,
      schemaName: "RadarTriage",
      providers,
      maxRetries: 1,
      persistSession: false,
      agentConfigOverrides: {
        title: "Radar check",
        internal: true,
        // Nobody can approve a tool call on a hidden agent, and reading Slack is one.
        ...(modeId ? { modeId } : {}),
      },
      logger: deps.logger,
    });
  };
}

const PULL_REQUEST_STATE_TIMEOUT_MS = 20_000;

/** Asks the GitHub CLI where a pull request stands. Anything it cannot answer is "unknown". */
export async function getRadarPullRequestState(input: {
  url: string;
  cwd: string;
}): Promise<RadarPullRequestState> {
  const { stdout } = await execCommand("gh", ["pr", "view", input.url, "--json", "state"], {
    cwd: input.cwd,
    timeout: PULL_REQUEST_STATE_TIMEOUT_MS,
  });
  const parsed: unknown = JSON.parse(stdout);
  const state =
    parsed && typeof parsed === "object" && "state" in parsed ? String(parsed.state) : "";
  switch (state.toUpperCase()) {
    case "MERGED":
      return "merged";
    case "CLOSED":
      return "closed";
    case "OPEN":
      return "open";
    default:
      return "unknown";
  }
}
