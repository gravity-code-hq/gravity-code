import type { DraftAgentControlsProps } from "@/composer/agent-controls";
import type { AgentMode } from "@gravity/protocol/agent-types";
import { isPlanningAgentMode, resolveNonPlanningModeId } from "@/agent-controls/policy";

export function resolvePlanModeToggle({
  modeOptions,
  selectedMode,
  previousMode,
  defaultMode,
}: {
  modeOptions: readonly AgentMode[];
  selectedMode: string | null | undefined;
  previousMode: string | null;
  defaultMode: string | null;
}): { active: boolean; nextModeId: string } | null {
  const planMode = modeOptions.find(isPlanningAgentMode);
  const previous = modeOptions.find((mode) => mode.id === previousMode);
  const restoreMode = previous && !isPlanningAgentMode(previous) ? previous.id : defaultMode;
  const offMode = resolveNonPlanningModeId(modeOptions, restoreMode);
  if (!planMode || !offMode) return null;
  const selected = modeOptions.find((mode) => mode.id === selectedMode) ?? modeOptions[0];
  const active = selected ? isPlanningAgentMode(selected) : false;
  return { active, nextModeId: active ? offMode : planMode.id };
}

export function resolveNextAgentModeId({
  modeOptions,
  selectedMode,
}: {
  modeOptions: readonly AgentMode[];
  selectedMode: string | null | undefined;
}): string | null {
  if (modeOptions.length < 2) return null;

  const selectedIndex = modeOptions.findIndex((mode) => mode.id === selectedMode);
  const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const nextIndex = (currentIndex + 1) % modeOptions.length;
  return modeOptions[nextIndex]?.id ?? null;
}

export function resolveAgentControlsMode(agentControls?: DraftAgentControlsProps) {
  return agentControls ? "draft" : "ready";
}
