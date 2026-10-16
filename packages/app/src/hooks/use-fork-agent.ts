import { useTranslation } from "react-i18next";
import type { AgentForkContextOptions, DaemonClient } from "@gravity/client/internal/daemon-client";
import type { WorkspaceComposerAttachment } from "@/attachments/types";
import type { ToastApi } from "@/components/toast-host";
import type { AgentScreenAgent } from "@/hooks/use-agent-screen-state-machine";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useHostFeature } from "@/runtime/host-features";
import { generateDraftId } from "@/stores/draft-keys";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import {
  buildDraftWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import { toErrorMessage } from "@/utils/error-messages";
import type { WorkspaceDraftTabSetup, WorkspaceTabTarget } from "@/workspace-tabs/model";

/**
 * The subset of an agent record that a fork needs in order to seed the new
 * draft. Kept structural so both `AgentScreenAgent` (the agent-stream view's
 * live context) and the session store's `Agent` record satisfy it without a
 * projection step.
 */
export type ForkAgentSource = Pick<
  AgentScreenAgent,
  "provider" | "cwd" | "currentModeId" | "model" | "thinkingOptionId" | "runtimeInfo" | "features"
>;

/**
 * Boundary marking where the forked context should stop. Omit it entirely to
 * fork the whole timeline *up to now* — including a partially streamed
 * in-flight turn. `selectForkContextRows` projects the full timeline when
 * neither field is present, which is what makes mid-run forking work.
 */
export type ForkAgentBoundary = Pick<
  AgentForkContextOptions,
  "boundaryCursor" | "boundaryMessageId"
>;

/**
 * Provider and model the forked draft should start with. Omit it to keep the
 * source agent's provider; name another provider to switch agents — the draft
 * carries the chat history, the new provider supplies its own modes, thinking
 * options, and features, so none of those are copied across.
 */
export interface ForkAgentTarget {
  provider: string;
  model: string | null;
}

export interface ForkAgentRequest {
  agentId: string;
  agent: ForkAgentSource;
  workspaceId?: string;
  boundary?: ForkAgentBoundary;
  target?: ForkAgentTarget;
}

export interface UseForkAgentInput {
  serverId: string;
  toast?: ToastApi | null;
  /** Read-only surfaces (provider subagent panes) must never fork. */
  readOnly?: boolean;
}

function buildChatHistoryAttachment(input: {
  draftId: string;
  serverId: string;
  agentId: string;
  payload: Awaited<ReturnType<DaemonClient["buildAgentForkContext"]>>;
  missingAttachmentMessage: string;
}): WorkspaceComposerAttachment {
  if (!input.payload.attachment) {
    throw new Error(input.missingAttachmentMessage);
  }
  return {
    kind: "chat_history",
    id: `chat_history:${input.draftId}`,
    attachment: input.payload.attachment,
    source: {
      serverId: input.serverId,
      agentId: input.agentId,
      boundaryMessageId: input.payload.boundaryMessageId,
      boundaryCursor: input.payload.boundaryCursor,
      itemCount: input.payload.itemCount,
    },
  };
}

export function buildForkDraftSetup(
  agent: ForkAgentSource,
  target?: ForkAgentTarget,
): WorkspaceDraftTabSetup | undefined {
  if (target && target.provider !== agent.provider) {
    return {
      provider: target.provider,
      cwd: agent.cwd,
      modeId: null,
      model: target.model,
      thinkingOptionId: null,
      featureValues: {},
    };
  }
  if (!agent.provider) {
    return undefined;
  }

  const featureValues: Record<string, unknown> = {};
  for (const feature of agent.features ?? []) {
    featureValues[feature.id] = feature.value;
  }

  return {
    provider: agent.provider,
    cwd: agent.cwd,
    modeId: agent.currentModeId ?? agent.runtimeInfo?.modeId ?? null,
    model: target?.model ?? agent.model ?? agent.runtimeInfo?.model ?? null,
    thinkingOptionId: agent.thinkingOptionId ?? agent.runtimeInfo?.thinkingOptionId ?? null,
    featureValues,
  };
}

function buildForkDraftTabTarget(
  setup: WorkspaceDraftTabSetup | undefined,
  draftId: string,
): WorkspaceTabTarget {
  return setup ? { kind: "draft", draftId, setup } : { kind: "draft", draftId };
}

/**
 * Shared fork driver behind both turn-footer fork affordances: the completed
 * turn's footer (which supplies a boundary pinned to that turn) and the
 * in-flight turn's footer next to the progress loader (which omits the boundary
 * so the fork captures the still-streaming response), and the live model picker's
 * provider switch (which omits the boundary and names a `target` provider).
 * Resolves to whether the draft opened; failures are already surfaced as toasts.
 */
export function useForkAgent(
  input: UseForkAgentInput,
): (request: ForkAgentRequest) => Promise<boolean> {
  const { serverId, toast, readOnly = false } = input;
  const { t } = useTranslation();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const supportsAgentForkContext = useHostFeature(serverId, "agentForkHistory") && !readOnly;

  return useStableEvent(async ({ agentId, agent, workspaceId, boundary, target }) => {
    try {
      if (!supportsAgentForkContext) {
        toast?.error(t("message.actions.forkUnavailable"));
        return false;
      }
      if (!client) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      if (!workspaceId) {
        throw new Error(t("message.actions.forkMissingWorkspace"));
      }
      const draftSetup = buildForkDraftSetup(agent, target);
      const draftId = generateDraftId();
      const payload = await client.buildAgentForkContext(agentId, boundary);
      const attachment = buildChatHistoryAttachment({
        draftId,
        serverId,
        agentId,
        payload,
        missingAttachmentMessage: t("message.actions.forkFailed"),
      });
      useWorkspaceAttachmentsStore.getState().setWorkspaceAttachments({
        scopeKey: buildDraftWorkspaceAttachmentScopeKey(draftId),
        attachments: [attachment],
      });
      navigateToWorkspace({
        serverId,
        workspaceId,
        target: buildForkDraftTabTarget(draftSetup, draftId),
      });
      return true;
    } catch (error) {
      toast?.error(toErrorMessage(error) || t("message.actions.forkFailed"));
      return false;
    }
  });
}
