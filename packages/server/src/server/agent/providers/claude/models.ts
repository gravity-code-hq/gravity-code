import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Logger } from "pino";

import type { AgentModelDefinition } from "../../agent-sdk-types.js";
import {
  CLAUDE_DEFAULT_THINKING_OPTION_ID,
  CLAUDE_DISABLED_THINKING_OPTION_ID,
  buildThinkingOptions,
  getClaudeCustomModelThinkingOptions,
  getClaudeManifestModels,
  normalizeClaudeManifestModelId,
  normalizeClaudeRuntimeModelId as normalizeClaudeManifestRuntimeModelId,
} from "./model-manifest.js";
import {
  type ClaudeRuntimeModel,
  getClaudeRuntimeModels,
  setClaudeRuntimeModels,
} from "./model-registry.js";

const CLAUDE_SETTINGS_MODEL_ENV_KEYS = [
  "ANTHROPIC_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
] as const;

export function getClaudeModels(claudeCodeVersion?: string): AgentModelDefinition[] {
  const manifestModels = getClaudeManifestModels(claudeCodeVersion);
  const runtimeModels = getClaudeRuntimeModels();
  if (runtimeModels.length === 0) {
    return manifestModels;
  }
  return mergeClaudeRuntimeModels(runtimeModels, manifestModels);
}

/**
 * Fold what Claude Code reported into the curated manifest.
 *
 * Probe rows lead, in the order the CLI listed them: they are the current lineup, and their
 * labels and effort levels track the installed CLI rather than this build. Manifest rows the
 * probe did not cover follow, so a model the user pinned before it left the picker stays
 * selectable.
 */
function mergeClaudeRuntimeModels(
  runtimeModels: readonly ClaudeRuntimeModel[],
  manifestModels: readonly AgentModelDefinition[],
): AgentModelDefinition[] {
  const covered = new Set<string>();
  for (const model of runtimeModels) {
    covered.add(model.id);
    for (const alias of model.aliases ?? []) covered.add(alias);
  }

  const models = runtimeModels.map((model) => toClaudeModelDefinition(model));
  for (const manifestModel of manifestModels) {
    if (covered.has(manifestModel.id)) continue;
    // A probe-discovered default outranks the manifest's, which is a guess frozen at build time.
    models.push(
      runtimeModels.length > 0 ? { ...manifestModel, isDefault: undefined } : manifestModel,
    );
  }
  return models;
}

function toClaudeModelDefinition(model: ClaudeRuntimeModel): AgentModelDefinition {
  const definition: AgentModelDefinition = {
    provider: "claude",
    id: model.id,
    label: model.label,
  };
  if (model.description) definition.description = model.description;
  if (model.aliases && model.aliases.length > 0) definition.aliases = [...model.aliases];
  if (model.isDefault) definition.isDefault = true;
  if (model.contextWindowMaxTokens !== undefined) {
    definition.contextWindowMaxTokens = model.contextWindowMaxTokens;
  }
  const thinkingOptions = buildThinkingOptions(
    model.effortLevels,
    model.supportsThinkingDisabled === true,
  );
  if (thinkingOptions) {
    definition.thinkingOptions = thinkingOptions;
    definition.defaultThinkingOptionId = CLAUDE_DEFAULT_THINKING_OPTION_ID;
  }
  return definition;
}

/**
 * Publish probe results, enriched with the curated data Claude Code does not report.
 *
 * The manifest stays authoritative for a model it lists: its context window is measured
 * rather than inferred from the id, and its disabled-thinking flag is known rather than
 * guessed from the family.
 */
export function applyClaudeRuntimeModels(
  runtimeModels: readonly ClaudeRuntimeModel[],
  claudeCodeVersion?: string,
): void {
  const manifestModels = getClaudeManifestModels(claudeCodeVersion);
  setClaudeRuntimeModels(
    runtimeModels.map((model) => {
      const manifestModel = manifestModels.find((candidate) => candidate.id === model.id);
      if (!manifestModel) return model;
      const enriched: ClaudeRuntimeModel = { ...model };
      if (manifestModel.contextWindowMaxTokens !== undefined) {
        enriched.contextWindowMaxTokens = manifestModel.contextWindowMaxTokens;
      }
      enriched.supportsThinkingDisabled = manifestModel.thinkingOptions?.some(
        (option) => option.id === CLAUDE_DISABLED_THINKING_OPTION_ID,
      );
      return enriched;
    }),
  );
}

export function resolveConfiguredClaudeModel(model: AgentModelDefinition): AgentModelDefinition {
  if (model.thinkingOptions !== undefined) return model;

  const manifestModelId = normalizeClaudeManifestModelId(model.id);
  const manifestModel = manifestModelId
    ? getClaudeModels().find((candidate) => candidate.id === manifestModelId)
    : undefined;
  if (manifestModel) {
    return manifestModel.thinkingOptions
      ? { ...model, thinkingOptions: manifestModel.thinkingOptions }
      : model;
  }
  return { ...model, thinkingOptions: getClaudeCustomModelThinkingOptions() };
}

export function findClaudeModel(
  modelId: string | null | undefined,
): AgentModelDefinition | undefined {
  const normalizedModelId = normalizeClaudeRuntimeModelId(modelId);
  if (!normalizedModelId) {
    return undefined;
  }
  return getClaudeModels().find((model) => model.id === normalizedModelId);
}

export function getClaudeContextWindowMaxTokens(
  modelId: string | null | undefined,
): number | undefined {
  if (modelId?.trim().toLowerCase().endsWith("[1m]")) {
    return 1_000_000;
  }
  return findClaudeModel(modelId)?.contextWindowMaxTokens;
}

export async function getClaudeModelsWithSettings(
  logger: Logger,
  configDir: string,
  claudeCodeVersion?: string,
): Promise<AgentModelDefinition[]> {
  const hardcodedModels = getClaudeModels(claudeCodeVersion);
  const settingsModels = await readClaudeSettingsModels(logger, configDir);
  if (settingsModels.length === 0) {
    return hardcodedModels;
  }

  const models = [...hardcodedModels];

  for (const model of settingsModels) {
    const existingIndex = models.findIndex((candidate) => candidate.id === model.id);
    if (existingIndex !== -1) {
      const existing = models[existingIndex];
      if (existing?.isSelectable === false) {
        models[existingIndex] = { ...existing, ...model, isSelectable: true };
      }
      continue;
    }
    models.push(model);
  }

  return models;
}

async function readClaudeSettingsModels(
  logger: Logger,
  configDir: string,
): Promise<AgentModelDefinition[]> {
  const settingsPath = path.join(configDir, "settings.json");

  let parsed: unknown;
  try {
    const rawSettings = await fs.readFile(settingsPath, "utf8");
    parsed = JSON.parse(rawSettings);
  } catch (error) {
    logger.debug({ err: error, settingsPath }, "Failed to read Claude settings models");
    return [];
  }

  if (!isRecord(parsed)) {
    logger.debug({ settingsPath }, "Claude settings.json is not an object");
    return [];
  }

  const models: AgentModelDefinition[] = [];
  addSettingsModel(models, parsed.model, "model");

  const env = parsed.env;
  if (env === undefined) {
    return models;
  }
  if (!isRecord(env)) {
    logger.debug({ settingsPath }, "Claude settings.json env is not an object");
    return models;
  }

  for (const envKey of CLAUDE_SETTINGS_MODEL_ENV_KEYS) {
    addSettingsModel(models, env[envKey], `env.${envKey}`);
  }

  return models;
}

function addSettingsModel(
  models: AgentModelDefinition[],
  value: unknown,
  settingsKey: string,
): void {
  if (typeof value !== "string") {
    return;
  }

  const id = value.trim();
  if (id.length === 0 || models.some((model) => model.id === id)) {
    return;
  }

  models.push({
    provider: "claude",
    id,
    label: id,
    description: `From Claude settings.json ${settingsKey}`,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalize a runtime model string (from SDK init message) to a known model ID.
 * Handles the `[1m]` suffix that the SDK appends for 1M context sessions.
 */
export function normalizeClaudeRuntimeModelId(value: string | null | undefined): string | null {
  return normalizeClaudeManifestRuntimeModelId(value);
}

/**
 * Placeholder model values Claude Code writes on frames with no real inference behind them.
 * These are not models and must never be displayed.
 */
const CLAUDE_PLACEHOLDER_MODEL_IDS = new Set(["<synthetic>"]);

/**
 * Resolve a model id observed on a Claude assistant frame, for display.
 *
 * Prefers the manifest-normalized id so equivalent spellings collapse (a dated alias and a
 * gateway prefix are the same model), but falls back to the raw string when the manifest does
 * not know it. The fallback matters: Claude Code is an Anthropic-compatible client, so subagents
 * routinely report models that are not Anthropic's — Z.AI GLM ids via `ANTHROPIC_BASE_URL`
 * (docs/custom-providers.md) among them. Manifest-only resolution would blank the model for
 * exactly those users.
 *
 * A `[1m]` suffix is preserved where it names its own manifest entry. Models such as Fable 5
 * that only have a 1M entry normalize the retired suffixed spelling to the canonical ID.
 *
 * Returns null for placeholders and empty values, meaning "not observed".
 */
export function resolveObservedClaudeModelId(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || CLAUDE_PLACEHOLDER_MODEL_IDS.has(trimmed)) {
    return null;
  }
  return normalizeClaudeManifestRuntimeModelId(trimmed) ?? trimmed;
}
