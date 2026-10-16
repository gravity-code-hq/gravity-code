import pino from "pino";
import { describe, expect, test } from "vitest";

import type { AgentSession, AgentSessionConfig } from "../agent-sdk-types.js";
import { CodexAppServerAgentSession } from "./codex-app-server-agent.js";
import {
  createFakeCodexAppServer,
  type FakeCodexAppServer,
} from "./codex/test-utils/fake-app-server.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";

const CODEX_PROVIDER = "codex";

interface CollaborationModeRecord {
  name: string;
  mode?: string | null;
  model?: string | null;
  reasoning_effort?: string | null;
  developer_instructions?: string | null;
}

const TEST_COLLABORATION_MODES: CollaborationModeRecord[] = [
  {
    name: "Code",
    mode: "code",
    developer_instructions: "Built-in code mode",
  },
  {
    name: "Plan",
    mode: "plan",
    developer_instructions: "Built-in plan mode",
  },
];

type CodexFeaturesTestSession = AgentSession;

interface CapturedLogEntry {
  level?: number;
  msg?: string;
  [key: string]: unknown;
}

function createCapturedLogger(): { logger: pino.Logger; entries: CapturedLogEntry[] } {
  const entries: CapturedLogEntry[] = [];
  const logger = pino(
    { level: "debug" },
    {
      write(line: string) {
        entries.push(JSON.parse(line) as CapturedLogEntry);
      },
    },
  );
  return { logger, entries };
}

function createConfig(overrides: Partial<AgentSessionConfig> = {}): AgentSessionConfig {
  return {
    provider: CODEX_PROVIDER,
    cwd: "/tmp/codex-fast-mode-test",
    modeId: "auto",
    model: "gpt-5.4",
    ...overrides,
  };
}

function createSessionHarness(
  configOverrides: Partial<AgentSessionConfig> = {},
  options: { logger?: pino.Logger } = {},
): {
  session: CodexFeaturesTestSession;
  appServer: FakeCodexAppServer;
} {
  const config = createConfig(configOverrides);
  const appServer = createFakeCodexAppServer({
    "collaborationMode/list": () => ({ data: TEST_COLLABORATION_MODES }),
  });
  const session = new CodexAppServerAgentSession(
    { ...config, provider: CODEX_PROVIDER },
    null,
    options.logger ?? createTestLogger(),
    async () => appServer.child,
  ) as CodexFeaturesTestSession;
  return { session, appServer };
}

async function createConnectedSession(
  configOverrides: Partial<AgentSessionConfig> = {},
  options: { logger?: pino.Logger } = {},
): Promise<{
  session: CodexFeaturesTestSession;
  appServer: FakeCodexAppServer;
}> {
  const harness = createSessionHarness(configOverrides, options);
  await harness.session.connect();
  harness.appServer.assertNoErrors();
  return harness;
}

describe("Codex app-server provider features", () => {
  test("preserves Codex background work and lets the user cancel a pending budget change", async () => {
    const appServer = createFakeCodexAppServer({
      "thread/backgroundTerminals/list": () => ({ data: [{ id: "background-command" }] }),
    });
    const session = new CodexAppServerAgentSession(
      createConfig(),
      null,
      createTestLogger(),
      async () => appServer.child,
    );
    try {
      await session.startTurn("first turn");
      appServer.completeTurn();
      await new Promise<void>((resolve) => setImmediate(resolve));
      await session.setFeature("context_budget", "500000");
      await expect(session.startTurn("next turn")).rejects.toThrow("Finish Codex background work");
      await session.setFeature("context_budget", "auto");
      await expect(session.startTurn("continue with the existing budget")).resolves.toMatchObject({
        turnId: expect.any(String),
      });
      expect(
        appServer.requests().filter((request) => request.method === "initialize"),
      ).toHaveLength(1);
      appServer.assertNoErrors();
    } finally {
      await session.close();
    }
  });

  test("changes the context budget on the next turn and restores Auto on resume", async () => {
    const first = createFakeCodexAppServer();
    const second = createFakeCodexAppServer();
    const third = createFakeCodexAppServer();
    const children = [first.child, second.child, third.child];
    const session = new CodexAppServerAgentSession(
      createConfig(),
      null,
      createTestLogger(),
      async () => {
        const child = children.shift();
        if (!child) throw new Error("Unexpected Codex process restart");
        return child;
      },
    );
    try {
      await session.startTurn("first turn");
      expect(await first.waitForRequest("thread/start")).not.toHaveProperty("config");
      await session.setFeature("context_budget", "500000");
      expect(children).toHaveLength(2);
      first.completeTurn();
      await new Promise<void>((resolve) => setImmediate(resolve));
      await session.startTurn("second turn");
      expect(await second.waitForRequest("thread/resume")).toMatchObject({
        threadId: "thread-1",
        config: { model_auto_compact_token_limit: 500000 },
      });
      second.completeTurn();
      await new Promise<void>((resolve) => setImmediate(resolve));
      await session.setFeature("context_budget", "auto");
      await session.startTurn("third turn");
      expect(await third.waitForRequest("thread/resume")).not.toHaveProperty("config");
      expect(session.id).toBe("thread-1");
      expect(session.features).toContainEqual(
        expect.objectContaining({ id: "context_budget", value: "auto" }),
      );
      first.assertNoErrors();
      second.assertNoErrors();
      third.assertNoErrors();
    } finally {
      await session.close();
    }
  });

  test("rejects invalid context budgets without changing the selection", async () => {
    const { session } = await createConnectedSession();
    try {
      await expect(session.setFeature?.("context_budget", "unlimited")).rejects.toThrow();
      expect(session.features).toContainEqual(
        expect.objectContaining({ id: "context_budget", value: "auto" }),
      );
    } finally {
      await session.close();
    }
  });

  test("starts Codex with the selected context budget", async () => {
    const { session, appServer } = await createConnectedSession({
      featureValues: { context_budget: "250000" },
    });
    try {
      await session.startTurn("hello");
      expect(await appServer.waitForRequest("thread/start")).toMatchObject({
        config: { model_auto_compact_token_limit: 250000 },
      });
      expect(session.features).toContainEqual(
        expect.objectContaining({ id: "context_budget", type: "select", value: "250000" }),
      );
    } finally {
      await session.close();
    }
  });

  test.each([
    "gpt-6-astra",
    "gpt-5.6",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.4",
  ])("exposes and sends Fast for %s", async (model) => {
    const { session, appServer } = await createConnectedSession({ model });
    try {
      expect(session.features).toContainEqual(
        expect.objectContaining({
          id: "fast_mode",
          value: false,
        }),
      );
      await session.setFeature?.("fast_mode", true);
      await session.startTurn("hello");
      await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
        model,
        serviceTier: "fast",
      });
    } finally {
      await session.close();
    }
  });

  test.each([
    "gpt-5.3-codex-spark",
    "gpt-5.3-codex",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.5-pro",
    "gpt-5",
    "gpt-4.1",
    "o3",
    "o4-mini",
    "gpt-6-unknown",
  ])("does not expose or restore Fast for %s", async (model) => {
    const { session, appServer } = await createConnectedSession({
      model,
      featureValues: { fast_mode: true },
    });
    try {
      expect(session.features.map((feature) => feature.id)).toEqual([
        "plan_mode",
        "context_budget",
      ]);
      await expect(session.setFeature?.("fast_mode", true)).rejects.toThrow(
        `Codex fast mode is not available for model '${model}'`,
      );
      await session.startTurn("hello");
      await expect(appServer.waitForTurnStart()).resolves.not.toMatchObject({
        serviceTier: expect.anything(),
      });
    } finally {
      await session.close();
    }
  });

  test("restores Fast on Astra and preserves it when switching supported models", async () => {
    const { session, appServer } = await createConnectedSession({
      model: "gpt-6-astra",
      featureValues: { fast_mode: true },
    });
    try {
      expect(session.features).toContainEqual(
        expect.objectContaining({
          id: "fast_mode",
          value: true,
        }),
      );
      await session.setModel("gpt-5.6-sol");
      await session.setModel("gpt-6-astra");
      await session.startTurn("hello");
      await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
        model: "gpt-6-astra",
        serviceTier: "fast",
      });
    } finally {
      await session.close();
    }
  });

  test("features returns fast and plan toggles when supported", async () => {
    const { session } = await createConnectedSession();

    expect(session.features).toEqual([
      {
        type: "toggle",
        id: "fast_mode",
        label: "Fast",
        description: "Priority inference at increased usage",
        tooltip: "Toggle fast mode",
        icon: "zap",
        value: false,
      },
      {
        type: "toggle",
        id: "plan_mode",
        label: "Plan",
        description: "Switch Codex into planning-only collaboration mode",
        tooltip: "Toggle plan mode",
        icon: "list-todo",
        value: false,
      },
      expect.objectContaining({ id: "context_budget", value: "auto" }),
    ]);

    await session.setFeature?.("fast_mode", true);
    await session.setFeature?.("plan_mode", true);

    expect(session.features).toEqual([
      {
        type: "toggle",
        id: "fast_mode",
        label: "Fast",
        description: "Priority inference at increased usage",
        tooltip: "Toggle fast mode",
        icon: "zap",
        value: true,
      },
      {
        type: "toggle",
        id: "plan_mode",
        label: "Plan",
        description: "Switch Codex into planning-only collaboration mode",
        tooltip: "Toggle plan mode",
        icon: "list-todo",
        value: true,
      },
      expect.objectContaining({ id: "context_budget", value: "auto" }),
    ]);
  });

  test("features returns only plan toggle when model does not support fast mode", async () => {
    const { session } = await createConnectedSession({ model: "gpt-3.5-turbo" });

    expect(session.features).toEqual([
      {
        type: "toggle",
        id: "plan_mode",
        label: "Plan",
        description: "Switch Codex into planning-only collaboration mode",
        tooltip: "Toggle plan mode",
        icon: "list-todo",
        value: false,
      },
      expect.objectContaining({ id: "context_budget", value: "auto" }),
    ]);
  });

  test("constructor ignores restored fast mode when model does not support it", async () => {
    const { session, appServer } = await createConnectedSession({
      model: "gpt-3.5-turbo",
      featureValues: { fast_mode: true },
    });

    expect(session.features).toEqual([
      {
        type: "toggle",
        id: "plan_mode",
        label: "Plan",
        description: "Switch Codex into planning-only collaboration mode",
        tooltip: "Toggle plan mode",
        icon: "list-todo",
        value: false,
      },
      expect.objectContaining({ id: "context_budget", value: "auto" }),
    ]);

    await session.startTurn("hello");
    await expect(appServer.waitForTurnStart()).resolves.not.toMatchObject({
      serviceTier: expect.anything(),
    });
  });

  test("setFeature('fast_mode', true) sets serviceTier to fast", async () => {
    const { session, appServer } = await createConnectedSession();

    await session.setFeature?.("fast_mode", true);
    await session.startTurn("hello");

    await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
      serviceTier: "fast",
    });
  });

  test("setFeature('fast_mode', false) clears serviceTier to null", async () => {
    const { session, appServer } = await createConnectedSession({
      featureValues: { fast_mode: true },
    });

    await session.setFeature?.("fast_mode", false);
    await session.startTurn("hello");

    await expect(appServer.waitForTurnStart()).resolves.not.toMatchObject({
      serviceTier: expect.anything(),
    });
  });

  test("setFeature('fast_mode', true) rejects models that do not support fast mode", async () => {
    const { session } = await createConnectedSession({ model: "gpt-3.5-turbo" });

    await expect(session.setFeature?.("fast_mode", true)).rejects.toThrow(
      "Codex fast mode is not available for model 'gpt-3.5-turbo'",
    );
  });

  test("setFeature invalidates runtime info", async () => {
    const { session } = await createConnectedSession();

    await expect(session.getRuntimeInfo()).resolves.not.toMatchObject({
      extra: { collaborationMode: "Plan" },
    });

    await session.setFeature?.("plan_mode", true);

    await expect(session.getRuntimeInfo()).resolves.toMatchObject({
      extra: { collaborationMode: "Plan" },
    });
  });

  test("setFeature throws for unknown feature ids", async () => {
    const { session } = createSessionHarness();

    await expect(session.setFeature?.("unknown_feature", true)).rejects.toThrow(
      "Unknown Codex feature: unknown_feature",
    );
  });

  test("constructor restores feature flags from config.featureValues", async () => {
    const { session, appServer } = await createConnectedSession({
      featureValues: { fast_mode: true, plan_mode: true },
    });

    expect(session.features).toEqual([
      {
        type: "toggle",
        id: "fast_mode",
        label: "Fast",
        description: "Priority inference at increased usage",
        tooltip: "Toggle fast mode",
        icon: "zap",
        value: true,
      },
      {
        type: "toggle",
        id: "plan_mode",
        label: "Plan",
        description: "Switch Codex into planning-only collaboration mode",
        tooltip: "Toggle plan mode",
        icon: "list-todo",
        value: true,
      },
      expect.objectContaining({ id: "context_budget", value: "auto" }),
    ]);

    await session.startTurn("hello");
    await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
      serviceTier: "fast",
      collaborationMode: expect.objectContaining({
        mode: "plan",
      }),
    });
  });

  test("startTurn includes serviceTier when fast mode is enabled", async () => {
    const { session, appServer } = await createConnectedSession();

    await session.setFeature?.("fast_mode", true);
    await session.startTurn("hello");

    await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
      serviceTier: "fast",
    });
  });

  test("startTurn logs a sanitized turn/start summary for fast mode observability", async () => {
    const capture = createCapturedLogger();
    const prompt = "secret prompt text should not be logged";
    const { session } = await createConnectedSession(
      { featureValues: { fast_mode: true } },
      { logger: capture.logger },
    );

    await session.startTurn(prompt);

    const entry = capture.entries.find(
      (candidate) => candidate.msg === "Starting Codex app-server turn",
    );
    expect(entry).toMatchObject({
      level: 30,
      msg: "Starting Codex app-server turn",
      model: "gpt-5.4",
      modeId: "auto",
      serviceTier: "fast",
      cwd: "/tmp/codex-fast-mode-test",
    });
    expect(JSON.stringify(entry)).not.toContain(prompt);
  });

  test("setModel clears fast mode when switching to an unsupported model", async () => {
    const { session, appServer } = await createConnectedSession();

    await session.setFeature?.("fast_mode", true);
    await session.setModel("gpt-3.5-turbo");

    expect(session.features).toEqual([
      {
        type: "toggle",
        id: "plan_mode",
        label: "Plan",
        description: "Switch Codex into planning-only collaboration mode",
        tooltip: "Toggle plan mode",
        icon: "list-todo",
        value: false,
      },
      expect.objectContaining({ id: "context_budget", value: "auto" }),
    ]);
    await session.startTurn("hello");

    await expect(appServer.waitForTurnStart()).resolves.not.toMatchObject({
      serviceTier: expect.anything(),
    });
  });

  test("startTurn switches collaboration mode when plan mode is enabled", async () => {
    const { session, appServer } = await createConnectedSession();

    await session.setFeature?.("plan_mode", true);
    await session.startTurn("hello");

    await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
      collaborationMode: expect.objectContaining({
        mode: "plan",
      }),
    });
  });
});
