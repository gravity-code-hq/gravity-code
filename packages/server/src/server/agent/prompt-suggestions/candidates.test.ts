import { describe, expect, test } from "vitest";

import type { ProviderSnapshotEntry } from "../agent-sdk-types.js";
import { resolvePromptSuggestionCandidates } from "./candidates.js";

class ProviderSnapshots {
  constructor(private readonly entries: ProviderSnapshotEntry[]) {}

  async listProviders(input: { providers?: string[] } = {}) {
    return input.providers
      ? this.entries.filter((entry) => input.providers?.includes(entry.provider))
      : this.entries;
  }
}

const CLAUDE: ProviderSnapshotEntry = {
  provider: "claude",
  status: "ready",
  enabled: true,
  models: [
    { provider: "claude", id: "claude-opus", label: "Opus", isDefault: true },
    { provider: "claude", id: "claude-haiku", label: "Haiku" },
  ],
};

const CODEX: ProviderSnapshotEntry = {
  provider: "codex",
  status: "ready",
  enabled: true,
  models: [
    { provider: "codex", id: "gpt-5.5", label: "GPT-5.5", isDefault: true },
    {
      provider: "codex",
      id: "gpt-5.4-mini",
      label: "GPT-5.4 mini",
      thinkingOptions: [{ id: "low", label: "Low" }],
    },
  ],
};

const OPENCODE: ProviderSnapshotEntry = {
  provider: "opencode",
  status: "ready",
  enabled: true,
  models: [
    {
      provider: "opencode",
      id: "ollama/qwen",
      label: "Qwen",
      isDefault: true,
      metadata: { providerId: "ollama", modelId: "qwen" },
    },
    {
      provider: "opencode",
      id: "anthropic/claude-haiku",
      label: "Claude Haiku",
      metadata: { providerId: "anthropic", modelId: "claude-haiku" },
    },
  ],
};

describe("resolvePromptSuggestionCandidates", () => {
  test("keeps a Codex agent's suggestions on Codex even when Claude is installed", async () => {
    const candidates = await resolvePromptSuggestionCandidates({
      source: "agent",
      cwd: "/repo",
      agent: { provider: "codex", model: "gpt-5.5" },
      providerSnapshotManager: new ProviderSnapshots([CLAUDE, CODEX]),
      daemonConfig: { metadataGeneration: { providers: [{ provider: "claude" }] } },
    });

    expect(candidates).toEqual([
      { provider: "codex", model: "gpt-5.4-mini", thinkingOptionId: "low" },
      { provider: "codex", model: "gpt-5.5" },
    ]);
  });

  test("skips a cheap model that routes a multi-vendor provider to another upstream", async () => {
    const candidates = await resolvePromptSuggestionCandidates({
      source: "agent",
      cwd: "/repo",
      agent: { provider: "opencode", model: "ollama/qwen" },
      providerSnapshotManager: new ProviderSnapshots([OPENCODE]),
      daemonConfig: { metadataGeneration: { providers: [] } },
    });

    expect(candidates).toEqual([{ provider: "opencode", model: "ollama/qwen" }]);
  });

  test("uses the shared metadata chain when the host opts into it", async () => {
    const candidates = await resolvePromptSuggestionCandidates({
      source: "metadata",
      cwd: "/repo",
      agent: { provider: "codex", model: "gpt-5.5" },
      providerSnapshotManager: new ProviderSnapshots([CLAUDE, CODEX]),
      daemonConfig: { metadataGeneration: { providers: [] } },
    });

    expect(candidates).toEqual([
      { provider: "claude", model: "claude-haiku" },
      { provider: "codex", model: "gpt-5.4-mini", thinkingOptionId: "low" },
      { provider: "codex", model: "gpt-5.5" },
    ]);
  });
});
