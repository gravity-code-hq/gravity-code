import type { PromptSuggestionModelSource } from "@gravity/protocol/messages";
import type {
  AgentModelDefinition,
  AgentProvider,
  ProviderSnapshotEntry,
} from "../agent-sdk-types.js";
import type { StructuredGenerationProvider } from "../agent-response-loop.js";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import {
  resolveStructuredGenerationProviders,
  type StructuredGenerationDaemonConfig,
} from "../structured-generation-providers.js";

export interface PromptSuggestionCandidateInput {
  source: PromptSuggestionModelSource;
  cwd: string;
  agent: {
    provider: AgentProvider;
    model?: string | null;
    thinkingOptionId?: string | null;
  };
  providerSnapshotManager: Pick<ProviderSnapshotManager, "listProviders">;
  daemonConfig: StructuredGenerationDaemonConfig;
}

// "agent" keeps the conversation inside the provider the user picked for this
// agent: its cheapest known model first, then the agent's own model. "metadata"
// uses the shared metadata chain, which can hand a Codex conversation to Claude.
export async function resolvePromptSuggestionCandidates(
  input: PromptSuggestionCandidateInput,
): Promise<StructuredGenerationProvider[]> {
  const currentSelection = {
    provider: input.agent.provider,
    model: input.agent.model ?? null,
    thinkingOptionId: input.agent.thinkingOptionId ?? null,
  };
  if (input.source === "metadata") {
    return resolveStructuredGenerationProviders({
      cwd: input.cwd,
      providerSnapshotManager: input.providerSnapshotManager,
      daemonConfig: input.daemonConfig,
      currentSelection,
    });
  }

  const entries = await input.providerSnapshotManager.listProviders({
    cwd: input.cwd,
    providers: [input.agent.provider],
    wait: true,
  });
  const ownEntries = entries
    .filter((entry) => entry.provider === input.agent.provider)
    .map((entry) => restrictToAgentUpstream(entry, input.agent.model ?? null));
  return resolveStructuredGenerationProviders({
    cwd: input.cwd,
    providerSnapshotManager: { listProviders: async () => ownEntries },
    daemonConfig: null,
    currentSelection,
  });
}

// OpenCode and Pi route to many vendors from one provider. A cheap model from
// a different vendor would still send the conversation somewhere new, so only
// models from the agent's own upstream count.
function restrictToAgentUpstream(
  entry: ProviderSnapshotEntry,
  agentModelId: string | null,
): ProviderSnapshotEntry {
  const models = entry.models ?? [];
  const agentModel =
    models.find((model) => model.id === agentModelId) ??
    models.find((model) => model.isDefault) ??
    models[0];
  const upstream = agentModel ? readUpstream(agentModel) : undefined;
  if (!upstream) {
    return entry;
  }
  return { ...entry, models: models.filter((model) => readUpstream(model) === upstream) };
}

function readUpstream(model: AgentModelDefinition): string | undefined {
  const value = model.metadata?.["providerId"];
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : undefined;
}
