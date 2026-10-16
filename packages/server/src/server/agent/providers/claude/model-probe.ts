import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import type { ModelInfo, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "pino";

import { terminateWithTreeKill } from "../../../../utils/tree-kill.js";
import type { ProviderRuntimeSettings } from "../../provider-launch-config.js";
import { claudeFamilySupportsThinkingDisabled } from "./model-manifest.js";
import type { ClaudeEffortLevel, ClaudeRuntimeModel } from "./model-registry.js";
import { claudeProjectDir } from "./project-dir.js";
import { type ClaudeOptions, type ClaudeQueryFactory, claudeQuery } from "./query.js";

/**
 * The row Claude Code marks as the current default. It duplicates whichever concrete row it
 * resolves to, so it is read for `isDefault` and then dropped — two catalogue entries sharing
 * a model would collide in the picker.
 */
const CLAUDE_DEFAULT_MODEL_ROW_ID = "default";

const CLAUDE_ONE_MILLION_CONTEXT_TOKENS = 1_000_000;
const CLAUDE_STANDARD_CONTEXT_TOKENS = 200_000;

export interface ClaudeModelProbeOptions {
  logger: Logger;
  runtimeSettings?: ProviderRuntimeSettings;
  queryFactory?: ClaudeQueryFactory;
  resolveBinary: () => Promise<string>;
  settingSources: NonNullable<ClaudeOptions["settingSources"]>;
  configDir?: string;
  signal?: AbortSignal;
}

export type ClaudeModelProbe = (options: ClaudeModelProbeOptions) => Promise<ClaudeRuntimeModel[]>;

/**
 * Ask the installed Claude Code which models it offers.
 *
 * This is the same list the CLI's own `/model` picker shows, so a model released after this
 * Gravity build appears as soon as the user updates their CLI. The catalogue is host-global
 * (see `ClaudeAgentClient.getCatalogCacheKey`), so the probe runs in the home directory
 * rather than a workspace.
 */
export async function probeClaudeModels(
  options: ClaudeModelProbeOptions,
): Promise<ClaudeRuntimeModel[]> {
  const { logger, runtimeSettings, queryFactory, resolveBinary, settingSources, signal } = options;
  const cwd = homedir();
  const pathToClaudeCodeExecutable = await resolveBinary();

  let child: ChildProcess | null = null;
  let sessionId: string | null = null;

  // Control requests need streaming input mode, and this query never prompts, so the input
  // iterable only has to stay open until supportedModels() answers.
  let releaseInput: () => void = () => {};
  const inputClosed = new Promise<void>((resolve) => {
    releaseInput = resolve;
  });
  const prompt: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        await inputClosed;
        return { done: true, value: undefined };
      },
    }),
  };

  const query = claudeQuery(
    {
      prompt,
      options: {
        cwd,
        pathToClaudeCodeExecutable,
        settingSources,
        // Claude Code ignores this outside --print mode, so the transcript is swept below too.
        persistSession: false,
      },
    },
    {
      runtimeSettings,
      queryFactory,
      onChildProcess: (spawned) => {
        child = spawned;
      },
    },
  );

  // Draining the stream is what surfaces the session id; the probe sends no prompt, so the
  // only frames are the CLI's own init metadata.
  const drained = (async () => {
    try {
      for await (const message of query) {
        const id = (message as { session_id?: unknown }).session_id;
        if (typeof id === "string" && id) sessionId ??= id;
      }
    } catch (error) {
      logger.debug({ err: error }, "Claude model probe stream ended");
    }
  })();

  try {
    signal?.throwIfAborted();
    const models = await query.supportedModels();
    return mapClaudeProbeModels(models);
  } finally {
    releaseInput();
    query.close?.();
    await query.return?.().catch(() => undefined);
    await drained;
    if (child) {
      await terminateWithTreeKill(child, { gracefulTimeoutMs: 2_000, forceTimeoutMs: 2_000 });
    }
    await sweepProbeTranscript({ logger, cwd, configDir: options.configDir, sessionId });
  }
}

/**
 * Delete the transcript the probe's session left behind.
 *
 * `persistSession: false` is silently dropped in stream-json mode, so without this the probe
 * would litter `~/.claude/projects/` with empty sessions and surface them in provider import
 * and history UIs.
 */
async function sweepProbeTranscript(input: {
  logger: Logger;
  cwd: string;
  configDir?: string;
  sessionId: string | null;
}): Promise<void> {
  if (!input.sessionId) return;
  try {
    const projectDir = await claudeProjectDir(input.cwd, { configDir: input.configDir });
    await rm(join(projectDir, `${input.sessionId}.jsonl`), { force: true });
  } catch (error) {
    input.logger.debug(
      { err: error, sessionId: input.sessionId },
      "Failed to sweep Claude model probe transcript",
    );
  }
}

export function mapClaudeProbeModels(models: readonly ModelInfo[]): ClaudeRuntimeModel[] {
  const defaultRow = models.find((model) => model.value === CLAUDE_DEFAULT_MODEL_ROW_ID);
  const defaultModelId = defaultRow ? resolveProbeModelId(defaultRow) : undefined;

  const byId = new Map<string, ClaudeRuntimeModel>();
  for (const model of models) {
    if (model.value === CLAUDE_DEFAULT_MODEL_ROW_ID) continue;
    const id = resolveProbeModelId(model);
    if (!id) continue;
    const existing = byId.get(id);
    if (existing) {
      // Two rows resolving to one model would render twice in the picker; keep the first and
      // fold the later row's spelling in as an alias so a saved choice still matches.
      if (model.value !== id && !existing.aliases?.includes(model.value)) {
        existing.aliases = [...(existing.aliases ?? []), model.value];
      }
      continue;
    }

    const entry: ClaudeRuntimeModel = {
      id,
      label: model.displayName,
      supportsFastMode: model.supportsFastMode === true,
      supportsThinkingDisabled: claudeFamilySupportsThinkingDisabled(id),
      contextWindowMaxTokens: inferProbeContextWindow(model),
    };
    if (model.description) entry.description = model.description;
    if (model.value !== id) entry.aliases = [model.value];
    if (defaultModelId ? id === defaultModelId : model.value === defaultRow?.value) {
      entry.isDefault = true;
    }
    const effortLevels = normalizeProbeEffortLevels(model);
    if (effortLevels) entry.effortLevels = effortLevels;
    byId.set(id, entry);
  }

  return [...byId.values()];
}

/**
 * Prefer the canonical wire id over the picker's alias. `opus[1m]` changes meaning with every
 * release; `claude-opus-5-5[1m]` is what a saved agent should keep pointing at, and it is what
 * Gravity already persists for manifest models.
 */
function resolveProbeModelId(model: ModelInfo): string {
  const resolved = model.resolvedModel?.trim();
  if (resolved) return resolved;
  return model.value.trim();
}

function normalizeProbeEffortLevels(model: ModelInfo): ClaudeEffortLevel[] | undefined {
  if (model.supportsEffort !== true) return undefined;
  const levels = model.supportedEffortLevels;
  return levels && levels.length > 0 ? [...levels] : undefined;
}

/**
 * Claude Code does not report a context window. Every manifest entry follows the same rule —
 * a `[1m]` id is 1M, everything else is 200K — so apply it rather than leave the field unset
 * and lose the context meter for new models.
 *
 * The suffix can sit on either spelling: Fable's picker row is `claude-fable-5-1[1m]` but it
 * resolves to the unsuffixed `claude-fable-5-1`, so reading only the resolved id would call a
 * 1M model 200K.
 */
function inferProbeContextWindow(model: ModelInfo): number {
  const spellings = `${model.resolvedModel ?? ""} ${model.value}`.toLowerCase();
  return spellings.includes("[1m]")
    ? CLAUDE_ONE_MILLION_CONTEXT_TOKENS
    : CLAUDE_STANDARD_CONTEXT_TOKENS;
}
