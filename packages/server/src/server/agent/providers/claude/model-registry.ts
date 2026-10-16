export type ClaudeEffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * A model Claude Code itself reported, normalized into the shape the manifest lookups read.
 *
 * Claude Code's `/model` picker is the authority on which models exist, and it changes when
 * the user updates the CLI — not when Gravity ships. The catalogue probe writes what that CLI
 * reported here so capability lookups can answer for models released after this Gravity build.
 * Anything the CLI does not report (context window, disabled-thinking support) is inferred by
 * the probe before it lands here; see `model-probe.ts`.
 */
export interface ClaudeRuntimeModel {
  id: string;
  /** Alias rows the CLI collapses onto this id, e.g. `opus[1m]` for `claude-opus-5-5[1m]`. */
  aliases?: readonly string[];
  label: string;
  description?: string;
  isDefault?: boolean;
  contextWindowMaxTokens?: number;
  effortLevels?: readonly ClaudeEffortLevel[];
  supportsThinkingDisabled?: boolean;
  supportsFastMode?: boolean;
}

/**
 * Process-lifetime store. The provider snapshot cache has the same lifetime, so a daemon
 * restart re-probes and repopulates this before anything reads it. Empty until the first
 * successful probe, which is why every reader falls back to the static manifest.
 */
let runtimeModels: readonly ClaudeRuntimeModel[] = [];

export function setClaudeRuntimeModels(models: readonly ClaudeRuntimeModel[]): void {
  runtimeModels = models;
}

export function getClaudeRuntimeModels(): readonly ClaudeRuntimeModel[] {
  return runtimeModels;
}

export function clearClaudeRuntimeModels(): void {
  runtimeModels = [];
}

export function findClaudeRuntimeModel(
  modelId: string | null | undefined,
): ClaudeRuntimeModel | undefined {
  const trimmed = typeof modelId === "string" ? modelId.trim() : "";
  if (!trimmed) return undefined;
  return runtimeModels.find(
    (model) => model.id === trimmed || model.aliases?.includes(trimmed) === true,
  );
}
