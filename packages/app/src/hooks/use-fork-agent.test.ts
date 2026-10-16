import { describe, expect, it } from "vitest";
import { buildForkDraftSetup, type ForkAgentSource } from "./use-fork-agent";

const codexAgent: ForkAgentSource = {
  provider: "codex",
  cwd: "/repo",
  currentModeId: "full-access",
  model: "gpt-5-codex",
  thinkingOptionId: "high",
  runtimeInfo: null,
  features: [{ id: "web_search", type: "toggle", label: "Web search", value: true }],
};

describe("buildForkDraftSetup", () => {
  it("copies the source agent's settings when the fork stays on the same provider", () => {
    expect(buildForkDraftSetup(codexAgent)).toEqual({
      provider: "codex",
      cwd: "/repo",
      modeId: "full-access",
      model: "gpt-5-codex",
      thinkingOptionId: "high",
      featureValues: { web_search: true },
    });
  });

  it("only swaps the model when the target names the same provider", () => {
    expect(buildForkDraftSetup(codexAgent, { provider: "codex", model: "gpt-5" })).toMatchObject({
      provider: "codex",
      modeId: "full-access",
      model: "gpt-5",
      thinkingOptionId: "high",
      featureValues: { web_search: true },
    });
  });

  it("drops provider-native settings when switching to another provider", () => {
    expect(
      buildForkDraftSetup(codexAgent, { provider: "claude", model: "claude-opus-5-5" }),
    ).toEqual({
      provider: "claude",
      cwd: "/repo",
      modeId: null,
      model: "claude-opus-5-5",
      thinkingOptionId: null,
      featureValues: {},
    });
  });

  it("switches even when the source agent has no provider yet", () => {
    expect(
      buildForkDraftSetup(
        { ...codexAgent, provider: undefined },
        { provider: "claude", model: null },
      ),
    ).toMatchObject({ provider: "claude", model: null });
    expect(buildForkDraftSetup({ ...codexAgent, provider: undefined })).toBeUndefined();
  });
});
