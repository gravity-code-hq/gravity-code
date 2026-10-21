import type { MutableDaemonConfig } from "@gravity/protocol/messages";
import type { AgentManager } from "../agent-manager.js";
import {
  generateStructuredAgentResponseWithFallback,
  type StructuredGenerationLogger,
  type StructuredGenerationProvider,
} from "../agent-response-loop.js";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import { resolvePromptSuggestionCandidates } from "./candidates.js";
import {
  buildPromptSuggestionPrompt,
  normalizePromptSuggestion,
  PromptSuggestionResponseSchema,
  type PromptSuggestionResponse,
} from "./prompt.js";

// Enough projected rows to reach back past a turn full of tool calls to the
// developer's last message.
const TIMELINE_TAIL_ROWS = 200;
const MAX_CACHED_AGENTS = 64;

export interface PromptSuggestionResult {
  // Identifies the finished turn the suggestion answers. A new turn moves it.
  turnKey: string;
  suggestion: string | null;
}

export type PromptSuggestionGenerator = (input: {
  cwd: string;
  prompt: string;
  providers: readonly StructuredGenerationProvider[];
}) => Promise<PromptSuggestionResponse>;

interface LoggerLike extends StructuredGenerationLogger {
  debug(obj: object, msg?: string): void;
}

export interface PromptSuggestionServiceOptions {
  agents: Pick<AgentManager, "getAgent" | "fetchTimeline">;
  providerSnapshotManager: Pick<ProviderSnapshotManager, "listProviders">;
  readConfig: () => Pick<MutableDaemonConfig, "promptSuggestions" | "metadataGeneration">;
  generate: PromptSuggestionGenerator;
  logger: LoggerLike;
}

interface CacheEntry {
  turnKey: string;
  result: Promise<string | null>;
}

// Suggestions are generated on demand when a client asks for the agent it is
// showing, never for every finished turn: each one is a real provider call on
// the user's own quota. The cache lets every client viewing the same turn share
// one generation.
export class PromptSuggestionService {
  private readonly options: PromptSuggestionServiceOptions;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: PromptSuggestionServiceOptions) {
    this.options = options;
  }

  // Null when there is nothing to suggest for: the feature is off, the agent is
  // mid-turn, or the conversation has no agent reply yet.
  async suggest(agentId: string): Promise<PromptSuggestionResult | null> {
    const config = this.options.readConfig();
    if (config.promptSuggestions?.enabled !== true) {
      return null;
    }
    const agent = this.options.agents.getAgent(agentId);
    if (!agent || agent.internal || agent.lifecycle !== "idle") {
      return null;
    }
    if (agent.pendingPermissions.size > 0) {
      return null;
    }

    const timeline = this.options.agents.fetchTimeline(agentId, {
      direction: "tail",
      limit: TIMELINE_TAIL_ROWS,
    });
    const turnKey = `${timeline.epoch}:${timeline.endSeq ?? 0}`;
    const cached = this.cache.get(agentId);
    if (cached?.turnKey === turnKey) {
      return { turnKey, suggestion: await cached.result };
    }

    const prompt = buildPromptSuggestionPrompt(timeline.rows.map((row) => row.item));
    if (!prompt) {
      return null;
    }

    const result = this.generate({
      agentId,
      cwd: agent.cwd,
      prompt,
      agent: {
        provider: agent.provider,
        model: agent.runtimeInfo?.model ?? agent.config.model ?? null,
        thinkingOptionId:
          agent.runtimeInfo?.thinkingOptionId ?? agent.config.thinkingOptionId ?? null,
      },
      config,
    });
    this.remember(agentId, { turnKey, result });
    return { turnKey, suggestion: await result };
  }

  private async generate(input: {
    agentId: string;
    cwd: string;
    prompt: string;
    agent: Parameters<typeof resolvePromptSuggestionCandidates>[0]["agent"];
    config: ReturnType<PromptSuggestionServiceOptions["readConfig"]>;
  }): Promise<string | null> {
    try {
      const providers = await resolvePromptSuggestionCandidates({
        source: input.config.promptSuggestions?.model ?? "agent",
        cwd: input.cwd,
        agent: input.agent,
        providerSnapshotManager: this.options.providerSnapshotManager,
        daemonConfig: { metadataGeneration: input.config.metadataGeneration },
      });
      const response = await this.options.generate({
        cwd: input.cwd,
        prompt: input.prompt,
        providers,
      });
      return normalizePromptSuggestion(response.suggestion);
    } catch (error) {
      // A guess that never arrived is not something the user needs to hear about.
      this.options.logger.debug(
        { err: error, agentId: input.agentId },
        "Prompt suggestion generation failed",
      );
      return null;
    }
  }

  private remember(agentId: string, entry: CacheEntry): void {
    this.cache.delete(agentId);
    this.cache.set(agentId, entry);
    while (this.cache.size > MAX_CACHED_AGENTS) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.cache.delete(oldest);
    }
  }
}

export function createPromptSuggestionGenerator(deps: {
  agentManager: AgentManager;
  logger: StructuredGenerationLogger;
}): PromptSuggestionGenerator {
  return ({ cwd, prompt, providers }) =>
    generateStructuredAgentResponseWithFallback({
      manager: deps.agentManager,
      cwd,
      prompt,
      schema: PromptSuggestionResponseSchema,
      schemaName: "PromptSuggestion",
      providers,
      maxRetries: 1,
      persistSession: false,
      agentConfigOverrides: { title: "Prompt suggestion", internal: true },
      logger: deps.logger,
    });
}
