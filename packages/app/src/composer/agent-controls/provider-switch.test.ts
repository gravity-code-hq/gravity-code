import { describe, expect, it } from "vitest";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import { resolveSwitchableProviders } from "./provider-switch";

function provider(id: string, label: string): ProviderSelectorProvider {
  return { id, label, modelSelection: { kind: "models", rows: [] } };
}

const claude = provider("claude", "Claude Code");
const codex = provider("codex", "Codex");
const opencode = provider("opencode", "OpenCode");

describe("resolveSwitchableProviders", () => {
  it("keeps the agent's own entry first and appends the other runnable providers", () => {
    expect(
      resolveSwitchableProviders({
        current: [codex],
        all: [claude, codex, opencode],
      }),
    ).toEqual([codex, claude, opencode]);
  });

  it("prefers the agent's own entry over the snapshot's copy of the same provider", () => {
    const fallbackCodex = provider("codex", "Codex (fallback)");
    expect(
      resolveSwitchableProviders({
        current: [fallbackCodex],
        all: [codex, claude],
      }),
    ).toEqual([fallbackCodex, claude]);
  });

  it("returns the current list untouched when no other provider is runnable", () => {
    const current = [codex];
    expect(resolveSwitchableProviders({ current, all: [codex] })).toBe(current);
    expect(resolveSwitchableProviders({ current, all: [] })).toBe(current);
  });
});
