import { describe, expect, test } from "vitest";

import type { MutableDaemonConfig } from "@gravity/protocol/messages";
import type { AgentTimelineItem, ProviderSnapshotEntry } from "../agent-sdk-types.js";
import type { ManagedAgent } from "../agent-manager.js";
import type { AgentTimelineFetchResult } from "../agent-timeline-store-types.js";
import { PromptSuggestionService, type PromptSuggestionGenerator } from "./service.js";

const CODEX: ProviderSnapshotEntry = {
  provider: "codex",
  status: "ready",
  enabled: true,
  models: [{ provider: "codex", id: "gpt-5.5", label: "GPT-5.5", isDefault: true }],
};

class FakeAgents {
  lifecycle: ManagedAgent["lifecycle"] = "idle";
  epoch = "epoch-1";
  items: AgentTimelineItem[] = [
    { type: "user_message", text: "Fix the flaky login test" },
    { type: "reasoning", text: "private chain of thought" },
    { type: "assistant_message", text: "Fixed login.test.ts. Should I also update the docs?" },
  ];

  getAgent(): ManagedAgent | null {
    return {
      id: "agent-1",
      provider: "codex",
      cwd: "/repo",
      config: { provider: "codex", cwd: "/repo", model: "gpt-5.5" },
      lifecycle: this.lifecycle,
      pendingPermissions: new Map(),
    } as unknown as ManagedAgent;
  }

  fetchTimeline(): AgentTimelineFetchResult {
    const rows = this.items.map((item, index) => ({ seq: index + 1, item }));
    return {
      epoch: this.epoch,
      endSeq: rows.length,
      rows,
    } as unknown as AgentTimelineFetchResult;
  }
}

class FakeGeneration {
  readonly calls: Parameters<PromptSuggestionGenerator>[0][] = [];
  reply: () => Promise<{ suggestion: string }> = async () => ({
    suggestion: '"Yes, update docs/login.md too"',
  });

  readonly generate: PromptSuggestionGenerator = (input) => {
    this.calls.push(input);
    return this.reply();
  };
}

function createService(
  config: Pick<MutableDaemonConfig, "promptSuggestions" | "metadataGeneration"> = {
    promptSuggestions: { enabled: true, model: "agent" },
    metadataGeneration: { providers: [] },
  },
) {
  const agents = new FakeAgents();
  const generation = new FakeGeneration();
  const service = new PromptSuggestionService({
    agents,
    providerSnapshotManager: { listProviders: async () => [CODEX] },
    readConfig: () => config,
    generate: generation.generate,
    logger: { debug: () => {}, info: () => {}, warn: () => {} },
  });
  return { agents, generation, service };
}

describe("PromptSuggestionService", () => {
  test("suggests the next message from the finished turn's conversation only", async () => {
    const { generation, service } = createService();

    const result = await service.suggest("agent-1");

    expect(result).toEqual({ turnKey: "epoch-1:3", suggestion: "Yes, update docs/login.md too" });
    expect(generation.calls).toHaveLength(1);
    expect(generation.calls[0]?.providers).toEqual([{ provider: "codex", model: "gpt-5.5" }]);
    expect(generation.calls[0]?.prompt).toContain("Developer: Fix the flaky login test");
    expect(generation.calls[0]?.prompt).toContain(
      "Agent: Fixed login.test.ts. Should I also update the docs?",
    );
    expect(generation.calls[0]?.prompt).not.toContain("private chain of thought");
  });

  test("shares one generation between every request for the same turn", async () => {
    const { generation, service } = createService();

    const results = await Promise.all([service.suggest("agent-1"), service.suggest("agent-1")]);

    expect(results).toEqual([
      { turnKey: "epoch-1:3", suggestion: "Yes, update docs/login.md too" },
      { turnKey: "epoch-1:3", suggestion: "Yes, update docs/login.md too" },
    ]);
    expect(generation.calls).toHaveLength(1);
  });

  test("generates again once a newer turn finishes", async () => {
    const { agents, generation, service } = createService();
    await service.suggest("agent-1");

    agents.items.push(
      { type: "user_message", text: "Yes" },
      { type: "assistant_message", text: "Docs updated." },
    );
    const result = await service.suggest("agent-1");

    expect(result?.turnKey).toBe("epoch-1:5");
    expect(generation.calls).toHaveLength(2);
  });

  test("does not generate while the agent is mid-turn", async () => {
    const { agents, generation, service } = createService();
    agents.lifecycle = "running";

    expect(await service.suggest("agent-1")).toBeNull();
    expect(generation.calls).toHaveLength(0);
  });

  test("does not generate when the host turned suggestions off", async () => {
    const { generation, service } = createService({
      promptSuggestions: { enabled: false, model: "agent" },
      metadataGeneration: { providers: [] },
    });

    expect(await service.suggest("agent-1")).toBeNull();
    expect(generation.calls).toHaveLength(0);
  });

  test("does not generate before the agent has replied", async () => {
    const { agents, generation, service } = createService();
    agents.items = [{ type: "user_message", text: "Hello" }];

    expect(await service.suggest("agent-1")).toBeNull();
    expect(generation.calls).toHaveLength(0);
  });

  test("answers with no suggestion, and does not retry the turn, when generation fails", async () => {
    const { generation, service } = createService();
    generation.reply = async () => {
      throw new Error("provider unavailable");
    };

    expect(await service.suggest("agent-1")).toEqual({ turnKey: "epoch-1:3", suggestion: null });
    expect(await service.suggest("agent-1")).toEqual({ turnKey: "epoch-1:3", suggestion: null });
    expect(generation.calls).toHaveLength(1);
  });
});
