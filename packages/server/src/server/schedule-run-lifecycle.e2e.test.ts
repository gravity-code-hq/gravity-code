import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { sep } from "node:path";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, test } from "vitest";

import { getFullAccessConfig } from "./daemon-e2e/agent-configs.js";
import {
  createDaemonTestContext,
  type DaemonClient,
  type DaemonTestContext,
} from "./test-utils/index.js";
import type { SessionOutboundMessage } from "./messages.js";
import { getGravityWorktreesRoot } from "../utils/worktree.js";

type AgentUpdateMessage = Extract<SessionOutboundMessage, { type: "agent_update" }>;
type WorkspaceUpdateMessage = Extract<SessionOutboundMessage, { type: "workspace_update" }>;
type ScheduleCreateOptions = Parameters<DaemonClient["scheduleCreate"]>[0];
type ScheduleSummary = NonNullable<Awaited<ReturnType<DaemonClient["scheduleCreate"]>>["schedule"]>;
type ScheduleWithRuns = NonNullable<
  Awaited<ReturnType<DaemonClient["scheduleRunOnce"]>>["schedule"]
>;

let ctx: DaemonTestContext;
const tempRoots: string[] = [];

beforeEach(async () => {
  ctx = await createDaemonTestContext();
});

afterEach(async () => {
  await ctx.cleanup();
  for (const tempRoot of tempRoots.splice(0)) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function createGitRepo(): string {
  const tempRoot = makeTempDir("schedule-run-worktree-");
  const repoDir = path.join(tempRoot, "repo");
  execFileSync("git", ["init", "-b", "main", repoDir], { stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@gravity.local"], {
    cwd: repoDir,
    stdio: "pipe",
  });
  execFileSync("git", ["config", "user.name", "Gravity Test"], {
    cwd: repoDir,
    stdio: "pipe",
  });
  writeFileSync(path.join(repoDir, "README.md"), "hello\n");
  execFileSync("git", ["add", "README.md"], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "initial"], {
    cwd: repoDir,
    stdio: "pipe",
  });
  return repoDir;
}

async function createNewAgentSchedule(options: ScheduleCreateOptions): Promise<ScheduleSummary> {
  const response = await ctx.client.scheduleCreate(options);
  if (response.error || !response.schedule) {
    throw new Error(response.error ?? "schedule/create returned no schedule");
  }
  return response.schedule;
}

async function runScheduleOnce(scheduleId: string): Promise<ScheduleWithRuns> {
  const response = await ctx.client.scheduleRunOnce({ id: scheduleId });
  if (response.error || !response.schedule) {
    throw new Error(response.error ?? "schedule/run-once returned no schedule");
  }
  return response.schedule;
}

async function updateSchedule(
  options: Parameters<DaemonClient["scheduleUpdate"]>[0],
): Promise<ScheduleWithRuns> {
  const response = await ctx.client.scheduleUpdate(options);
  if (response.error || !response.schedule) {
    throw new Error(response.error ?? "schedule/update returned no schedule");
  }
  return response.schedule;
}

function requireCompletedAgentId(schedule: ScheduleWithRuns): string {
  const run = schedule.runs[0];
  if (!run || run.status !== "succeeded" || !run.agentId) {
    throw new Error(
      `Expected one succeeded run with an agent id: ${JSON.stringify(schedule.runs)}`,
    );
  }
  return run.agentId;
}

function collectLifecycleUpdates(): {
  agentUpdates: AgentUpdateMessage[];
  workspaceUpdates: WorkspaceUpdateMessage[];
  stop: () => void;
} {
  const agentUpdates: AgentUpdateMessage[] = [];
  const workspaceUpdates: WorkspaceUpdateMessage[] = [];
  const stopAgentUpdates = ctx.client.on("agent_update", (message) => {
    agentUpdates.push(message);
  });
  const stopWorkspaceUpdates = ctx.client.on("workspace_update", (message) => {
    workspaceUpdates.push(message);
  });
  return {
    agentUpdates,
    workspaceUpdates,
    stop: () => {
      stopAgentUpdates();
      stopWorkspaceUpdates();
    },
  };
}

async function waitForAgentUpsert(events: AgentUpdateMessage[], agentId: string): Promise<void> {
  await expect
    .poll(
      () =>
        events.some(
          (message) => message.payload.kind === "upsert" && message.payload.agent.id === agentId,
        ),
      { timeout: 10_000, interval: 100 },
    )
    .toBe(true);
}

async function waitForWorkspaceUpsert(
  events: WorkspaceUpdateMessage[],
  workspaceId: string,
): Promise<void> {
  await expect
    .poll(
      () =>
        events.some(
          (message) =>
            message.payload.kind === "upsert" && message.payload.workspace.id === workspaceId,
        ),
      { timeout: 10_000, interval: 100 },
    )
    .toBe(true);
}

function workspaceWasRemoved(events: WorkspaceUpdateMessage[], workspaceId: string): boolean {
  return events.some(
    (message) => message.payload.kind === "remove" && message.payload.id === workspaceId,
  );
}

function requireWorkspaceUpsert(
  events: WorkspaceUpdateMessage[],
  workspaceId: string,
): Extract<WorkspaceUpdateMessage["payload"], { kind: "upsert" }>["workspace"] {
  const message = events.find(
    (event) => event.payload.kind === "upsert" && event.payload.workspace.id === workspaceId,
  );
  if (!message || message.payload.kind !== "upsert") {
    throw new Error(`Expected workspace upsert for ${workspaceId}`);
  }
  return message.payload.workspace;
}

async function activeAgentIds(): Promise<Set<string>> {
  const agents = await ctx.client.fetchAgents({ scope: "active" });
  return new Set(agents.entries.map((entry) => entry.agent.id));
}

async function activeAgent(agentId: string) {
  const agent = await ctx.client.fetchAgent({ agentId });
  if (!agent) {
    throw new Error(`Expected active agent ${agentId}`);
  }
  return agent.agent;
}

test("local scheduled run emits upserts and remains active", async () => {
  const cwd = makeTempDir("schedule-run-local-");
  const schedule = await createNewAgentSchedule({
    prompt: "Say done.",
    cadence: { type: "every", everyMs: 60_000 },
    target: {
      type: "new-agent",
      config: {
        ...getFullAccessConfig("codex"),
        cwd,
        isolation: "local",
      },
    },
    runOnCreate: false,
  });
  await ctx.client.fetchWorkspaces({ subscribe: {} });
  const events = collectLifecycleUpdates();

  const ran = await runScheduleOnce(schedule.id);
  const agentId = requireCompletedAgentId(ran);
  const agent = await activeAgent(agentId);
  const workspaceId = agent.workspaceId;

  expect(workspaceId).toMatch(/^wks_/);
  await waitForWorkspaceUpsert(events.workspaceUpdates, workspaceId!);
  await waitForAgentUpsert(events.agentUpdates, agentId);
  expect(workspaceWasRemoved(events.workspaceUpdates, workspaceId!)).toBe(false);
  expect(await activeAgentIds()).toContain(agentId);

  events.stop();
});

test("worktree isolation creates a run worktree and keeps the agent active", async () => {
  const repoDir = createGitRepo();
  const expectedRoot = await getGravityWorktreesRoot(
    repoDir,
    realpathSync(ctx.daemon.gravityHome),
    ctx.daemon.config.worktreesRoot,
  );
  const schedule = await createNewAgentSchedule({
    prompt: "Say done.",
    cadence: { type: "every", everyMs: 60_000 },
    target: {
      type: "new-agent",
      config: {
        ...getFullAccessConfig("codex"),
        cwd: repoDir,
        isolation: "worktree",
      },
    },
    runOnCreate: false,
  });
  await ctx.client.fetchWorkspaces({
    subscribe: {},
  });
  const events = collectLifecycleUpdates();

  const ran = await runScheduleOnce(schedule.id);
  const agentId = requireCompletedAgentId(ran);
  const agent = await activeAgent(agentId);
  const workspace = requireWorkspaceUpsert(events.workspaceUpdates, agent.workspaceId!);

  expect(workspace.workspaceKind).toBe("worktree");
  expect(
    agent.cwd.startsWith(`${expectedRoot}${sep}`),
    `agent cwd ${agent.cwd}; expected root ${expectedRoot}`,
  ).toBe(true);
  expect(agent.cwd).not.toBe(repoDir);
  expect(existsSync(agent.cwd)).toBe(true);

  events.stop();
});

test("update_schedule patches thinking and isolation for the next run", async () => {
  const repoDir = createGitRepo();
  const expectedRoot = await getGravityWorktreesRoot(
    repoDir,
    realpathSync(ctx.daemon.gravityHome),
    ctx.daemon.config.worktreesRoot,
  );
  const schedule = await createNewAgentSchedule({
    prompt: "Say done.",
    cadence: { type: "every", everyMs: 60_000 },
    target: {
      type: "new-agent",
      config: {
        ...getFullAccessConfig("codex"),
        cwd: repoDir,
        isolation: "local",
      },
    },
    runOnCreate: false,
  });

  await updateSchedule({
    id: schedule.id,
    newAgentConfig: {
      thinkingOptionId: "think-hard",
      isolation: "worktree",
    },
  });

  const ran = await runScheduleOnce(schedule.id);
  const agentId = requireCompletedAgentId(ran);
  const agent = await activeAgent(agentId);

  expect(agent.thinkingOptionId).toBe("think-hard");
  expect(agent.cwd.startsWith(`${expectedRoot}${sep}`)).toBe(true);
  expect(agent.cwd).not.toBe(repoDir);
  expect(await activeAgentIds()).toContain(agentId);
  expect(existsSync(agent.cwd)).toBe(true);
});
