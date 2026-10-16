/** @vitest-environment jsdom */
import React, { act, useCallback, useMemo, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentFeature } from "@gravity/protocol/agent-types";
import { KeyboardActionDispatcherProvider } from "@/keyboard/keyboard-action-dispatcher-context";
import { AgentModeControl, type AgentModeControlValue } from "./mode-control";
import { AgentSettingsMenu } from "./settings-menu";

// The test theme adapter does not inject the animated indicator's color props.
vi.mock("@/components/ui/switch", () => ({ SwitchIndicator: () => null }));

const MODES = [
  { id: "default", label: "Default" },
  { id: "full-access", label: "Full access" },
  { id: "plan", label: "Plan" },
];
const FEATURES: AgentFeature[] = [
  { id: "fast_mode", type: "toggle", label: "Fast mode", value: false },
  { id: "plan_mode", type: "toggle", label: "Plan mode", value: false },
  {
    id: "context_window",
    type: "select",
    label: "Context window",
    value: "default",
    options: [
      { id: "default", label: "Default" },
      { id: "large", label: "Large" },
    ],
  },
];

function Controls({
  featurePlan = false,
  disabled = false,
}: {
  featurePlan?: boolean;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState("full-access");
  const [features, setFeatures] = useState(() =>
    featurePlan ? FEATURES : FEATURES.filter((feature) => feature.id !== "plan_mode"),
  );
  const setFeature = useCallback((id: string, value: unknown) => {
    setFeatures((current) =>
      current.map((feature) => {
        if (feature.id !== id) return feature;
        if (feature.type === "toggle" && typeof value === "boolean") return { ...feature, value };
        if (feature.type === "select" && typeof value === "string") return { ...feature, value };
        return feature;
      }),
    );
  }, []);
  const modeControl = useMemo<AgentModeControlValue>(
    () => ({
      provider: featurePlan ? "codex" : "claude",
      providerDefinitions: [],
      modeOptions: MODES,
      selectedModeId: mode,
      onSelectMode: setMode,
    }),
    [featurePlan, mode],
  );
  return (
    <KeyboardActionDispatcherProvider>
      <AgentModeControl
        modeControl={modeControl}
        features={features}
        onSetFeature={setFeature}
        disabled={disabled}
      />
      <AgentSettingsMenu
        modeControl={modeControl}
        features={features}
        onSetFeature={setFeature}
        disabled={disabled}
        serverId={null}
      />
      <output data-testid="current-mode">{mode}</output>
    </KeyboardActionDispatcherProvider>
  );
}

interface Mounted {
  root: Root;
  container: HTMLDivElement;
}
const mounted: Mounted[] = [];
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});
function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  mounted.push({ root, container });
}
function element(testId: string): HTMLElement {
  const node = document.querySelector(`[data-testid="${testId}"]`);
  if (!(node instanceof HTMLElement)) throw new Error(`Missing ${testId}`);
  return node;
}
function click(testId: string) {
  act(() => element(testId).click());
}

describe("unified composer controls", () => {
  it("keeps Plan in the toolbar and toggles secondary features without closing settings", () => {
    mount(<Controls featurePlan />);
    expect(document.querySelector('[data-testid="agent-feature-fast_mode"]')).toBeNull();
    click("agent-feature-plan_mode");
    expect(element("agent-feature-plan_mode").getAttribute("aria-pressed")).toBe("true");
    expect(element("current-mode").textContent).toBe("full-access");
    click("agent-controls-settings");
    expect(document.querySelectorAll('[data-testid="agent-feature-plan_mode"]').length).toBe(1);
    click("agent-feature-fast_mode");
    expect(element("agent-feature-fast_mode").getAttribute("aria-checked")).toBe("true");
    expect(element("agent-controls-settings").getAttribute("aria-expanded")).toBe("true");
  });

  it("restores the prior mode after Plan and selects permissions through the menu", async () => {
    mount(<Controls />);
    click("agent-feature-plan_mode");
    expect(element("current-mode").textContent).toBe("plan");
    click("agent-feature-plan_mode");
    expect(element("current-mode").textContent).toBe("full-access");
    click("agent-controls-settings");
    click("agent-settings-permissions");
    await expect
      .poll(() => document.querySelector('[data-testid="agent-mode-default"]') !== null)
      .toBe(true);
    expect(document.querySelector('[data-testid="agent-mode-plan"]')).toBeNull();
    click("agent-mode-default");
    expect(element("current-mode").textContent).toBe("default");
    expect(element("agent-controls-settings").getAttribute("aria-expanded")).toBe("false");
  });

  it("renders provider select settings using the same submenu", async () => {
    mount(<Controls />);
    click("agent-controls-settings");
    click("agent-feature-context_window");
    await expect
      .poll(
        () => document.querySelector('[data-testid="agent-feature-context_window-large"]') !== null,
      )
      .toBe(true);
    click("agent-feature-context_window-large");
    expect(element("agent-controls-settings").getAttribute("aria-expanded")).toBe("true");
    expect(element("agent-feature-context_window").textContent).toContain("Large");
  });

  it("disables both controls while disconnected", () => {
    mount(<Controls disabled />);
    click("agent-feature-plan_mode");
    click("agent-controls-settings");
    expect(element("current-mode").textContent).toBe("full-access");
    expect(element("agent-controls-settings").getAttribute("aria-expanded")).toBe("false");
  });
});
