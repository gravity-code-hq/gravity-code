import { describe, expect, it } from "vitest";
import type { AgentMode } from "@gravity/protocol/agent-types";
import { resolveAgentControlsMode, resolveNextAgentModeId, resolvePlanModeToggle } from "./mode";

const PLAN_MODE = { id: "plan", label: "Plan" } satisfies AgentMode;

const MODES = [
  PLAN_MODE,
  { id: "build", label: "Build" },
  { id: "full-access", label: "Full Access" },
] satisfies AgentMode[];

describe("resolvePlanModeToggle", () => {
  it("restores the selected permission mode after planning", () => {
    expect(
      resolvePlanModeToggle({
        modeOptions: MODES,
        selectedMode: "full-access",
        previousMode: null,
        defaultMode: "build",
      }),
    ).toEqual({ active: false, nextModeId: "plan" });
    expect(
      resolvePlanModeToggle({
        modeOptions: MODES,
        selectedMode: "plan",
        previousMode: "full-access",
        defaultMode: "build",
      }),
    ).toEqual({ active: true, nextModeId: "full-access" });
  });

  it("falls back to the provider default if the remembered permission no longer exists", () => {
    expect(
      resolvePlanModeToggle({
        modeOptions: MODES,
        selectedMode: "plan",
        previousMode: "removed",
        defaultMode: "build",
      }),
    ).toEqual({ active: true, nextModeId: "build" });
  });

  it("recognizes ACP planning modes and does not offer an unusable toggle", () => {
    const modes = [
      { id: "acp#plan", label: "Plan" },
      { id: "acp#agent", label: "Agent" },
    ];
    expect(
      resolvePlanModeToggle({
        modeOptions: modes,
        selectedMode: "acp#agent",
        previousMode: null,
        defaultMode: null,
      }),
    ).toEqual({ active: false, nextModeId: "acp#plan" });
    expect(
      resolvePlanModeToggle({
        modeOptions: [PLAN_MODE],
        selectedMode: "plan",
        previousMode: null,
        defaultMode: null,
      }),
    ).toBeNull();
  });
});

describe("resolveAgentControlsMode", () => {
  it("uses ready mode when no controlled agent controls are provided", () => {
    expect(resolveAgentControlsMode(undefined)).toBe("ready");
  });

  it("uses draft mode when controlled agent controls are provided", () => {
    expect(
      resolveAgentControlsMode({
        providerDefinitions: [],
        selectedProvider: "codex",
        modeOptions: [],
        selectedMode: "",
        onSelectMode: () => undefined,
        models: [],
        selectedModel: "",
        onSelectModel: () => undefined,
        isModelLoading: false,
        modelSelectorProviders: [],
        isAllModelsLoading: false,
        onSelectProviderAndModel: () => undefined,
        thinkingOptions: [],
        selectedThinkingOptionId: "",
        onSelectThinkingOption: () => undefined,
        onApplyAgentProfile: () => undefined,
      }),
    ).toBe("draft");
  });
});

describe("resolveNextAgentModeId", () => {
  it("cycles from the selected mode to the next mode", () => {
    expect(resolveNextAgentModeId({ modeOptions: MODES, selectedMode: "build" })).toBe(
      "full-access",
    );
  });

  it("wraps from the last mode to the first mode", () => {
    expect(resolveNextAgentModeId({ modeOptions: MODES, selectedMode: "full-access" })).toBe(
      "plan",
    );
  });

  it("treats an empty selection as the visible first mode", () => {
    expect(resolveNextAgentModeId({ modeOptions: MODES, selectedMode: "" })).toBe("build");
  });

  it("treats a stale selection as the visible first mode", () => {
    expect(resolveNextAgentModeId({ modeOptions: MODES, selectedMode: "deleted-mode" })).toBe(
      "build",
    );
  });

  it("returns null when there are fewer than two modes", () => {
    expect(resolveNextAgentModeId({ modeOptions: [], selectedMode: "" })).toBeNull();
    expect(resolveNextAgentModeId({ modeOptions: [PLAN_MODE], selectedMode: "plan" })).toBeNull();
  });
});
