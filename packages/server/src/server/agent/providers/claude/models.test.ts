import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { ClaudeAgentClient } from "./agent.js";
import {
  CLAUDE_DISABLED_THINKING_OPTION_ID,
  CLAUDE_ULTRACODE_THINKING_OPTION_ID,
  claudeManifestModelSupportsFastMode,
  normalizeClaudeManifestModelId,
  parseClaudeCodeVersion,
  resolveClaudeDisabledThinkingForModel,
} from "./model-manifest.js";
import { mapClaudeProbeModels } from "./model-probe.js";
import { clearClaudeRuntimeModels } from "./model-registry.js";
import {
  applyClaudeRuntimeModels,
  findClaudeModel,
  getClaudeModels,
  normalizeClaudeRuntimeModelId,
} from "./models.js";

const createdClaudeConfigDirs: string[] = [];

afterEach(async () => {
  clearClaudeRuntimeModels();
  vi.unstubAllEnvs();
  await Promise.all(
    createdClaudeConfigDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
  createdClaudeConfigDirs.length = 0;
});

async function createClaudeConfigDir(settings: unknown): Promise<string> {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "gravity-claude-models-"));
  createdClaudeConfigDirs.push(configDir);
  await fs.writeFile(path.join(configDir, "settings.json"), JSON.stringify(settings, null, 2));
  return configDir;
}

async function createClaudeConfigDirWithRawSettings(settings: string): Promise<string> {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "gravity-claude-models-"));
  createdClaudeConfigDirs.push(configDir);
  await fs.writeFile(path.join(configDir, "settings.json"), settings);
  return configDir;
}

function createCatalogClient(claudeCodeVersion = "2.1.219"): ClaudeAgentClient {
  return new ClaudeAgentClient({
    logger: createTestLogger(),
    resolveVersion: async () => claudeCodeVersion,
    // Default to a CLI that reports nothing so these cases exercise the manifest path.
    probeModels: async () => [],
  });
}

describe("getClaudeModels", () => {
  it("returns all claude models", () => {
    const models = getClaudeModels();
    expect(models.map((m) => m.id)).toEqual([
      "claude-opus-5",
      "claude-fable-5-1",
      "claude-fable-5",
      "claude-fable-5[1m]",
      "claude-opus-4-8[1m]",
      "claude-opus-4-8",
      "claude-sonnet-5",
      "claude-sonnet-5[1m]",
      "claude-opus-4-7[1m]",
      "claude-opus-4-7",
      "claude-opus-4-6[1m]",
      "claude-opus-4-6",
      "claude-sonnet-4-6[1m]",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ]);
  });

  it("marks exactly one model as default", () => {
    const models = getClaudeModels();
    const defaults = models.filter((m) => m.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe("claude-opus-5");
  });

  it("defines context window sizes in the catalog", () => {
    const contextWindows = new Map(
      getClaudeModels().map((model) => [model.id, model.contextWindowMaxTokens]),
    );

    expect(contextWindows).toEqual(
      new Map([
        ["claude-opus-5", 1_000_000],
        ["claude-fable-5-1", 1_000_000],
        ["claude-fable-5", 1_000_000],
        ["claude-fable-5[1m]", 1_000_000],
        ["claude-opus-4-8[1m]", 1_000_000],
        ["claude-opus-4-8", 200_000],
        ["claude-sonnet-5", 200_000],
        ["claude-sonnet-5[1m]", 1_000_000],
        ["claude-opus-4-7[1m]", 1_000_000],
        ["claude-opus-4-7", 200_000],
        ["claude-opus-4-6[1m]", 1_000_000],
        ["claude-opus-4-6", 200_000],
        ["claude-sonnet-4-6[1m]", 1_000_000],
        ["claude-sonnet-4-6", 200_000],
        ["claude-haiku-4-5", 200_000],
      ]),
    );
  });

  it("filters models by their minimum Claude Code version", () => {
    const oldVersionModels = getClaudeModels("2.1.218");
    expect(oldVersionModels.map((model) => model.id)).not.toContain("claude-opus-5");
    expect(oldVersionModels.find((model) => model.isDefault)?.id).toBe("claude-opus-4-8");
    expect(getClaudeModels("2.1.219").map((model) => model.id)).toContain("claude-opus-5");

    expect(getClaudeModels("2.1.168").map((model) => model.id)).not.toContain("claude-fable-5");
    expect(getClaudeModels("2.1.169").map((model) => model.id)).toContain("claude-fable-5");
  });

  it("derives thinking options from model effort capabilities", () => {
    const models = new Map(getClaudeModels().map((model) => [model.id, model]));

    expect(models.get("claude-opus-5")?.thinkingOptions?.map((option) => option.id)).toEqual([
      CLAUDE_DISABLED_THINKING_OPTION_ID,
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      CLAUDE_ULTRACODE_THINKING_OPTION_ID,
    ]);
    expect(models.get("claude-sonnet-5")?.thinkingOptions?.map((option) => option.id)).toEqual([
      CLAUDE_DISABLED_THINKING_OPTION_ID,
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      CLAUDE_ULTRACODE_THINKING_OPTION_ID,
    ]);
    expect(
      models
        .get("claude-sonnet-5")
        ?.thinkingOptions?.find((option) => option.id === CLAUDE_ULTRACODE_THINKING_OPTION_ID)
        ?.label,
    ).toBe("Ultra Code");
    expect(models.get("claude-sonnet-5")?.defaultThinkingOptionId).toBe("high");
    expect(models.get("claude-sonnet-5[1m]")?.thinkingOptions).toEqual(
      models.get("claude-sonnet-5")?.thinkingOptions,
    );

    expect(models.get("claude-opus-4-7")?.thinkingOptions?.map((option) => option.id)).toEqual([
      CLAUDE_DISABLED_THINKING_OPTION_ID,
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      CLAUDE_ULTRACODE_THINKING_OPTION_ID,
    ]);
    expect(models.get("claude-sonnet-4-6")?.thinkingOptions?.map((option) => option.id)).toEqual([
      CLAUDE_DISABLED_THINKING_OPTION_ID,
      "low",
      "medium",
      "high",
      "max",
    ]);
    expect(models.get("claude-fable-5")?.thinkingOptions?.map((option) => option.id)).not.toContain(
      CLAUDE_DISABLED_THINKING_OPTION_ID,
    );
    expect(
      models.get("claude-fable-5-1")?.thinkingOptions?.map((option) => option.id),
    ).not.toContain(CLAUDE_DISABLED_THINKING_OPTION_ID);
    expect(models.get("claude-haiku-4-5")?.thinkingOptions).toBeUndefined();
  });

  it.each([
    ["claude-opus-5", true, "high"],
    ["claude-opus-5-20260724", true, "high"],
    ["claude-sonnet-5", true, "high"],
    ["claude-sonnet-5[1m]", true, "high"],
    ["claude-sonnet-5-20260101", true, "high"],
    ["claude-fable-5", false, "high"],
    ["claude-fable-5-1", false, "high"],
    ["claude-haiku-4-5", false, undefined],
    ["openrouter/anthropic/claude-opus-4-8", false, undefined],
    [null, false, undefined],
  ])("resolves disabled thinking for model %s", (modelId, supported, fallbackThinkingOptionId) => {
    expect(resolveClaudeDisabledThinkingForModel(modelId)).toEqual({
      supported,
      fallbackThinkingOptionId,
    });
  });

  it("returns fresh copies each call", () => {
    const a = getClaudeModels();
    const b = getClaudeModels();
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
  });
});

describe("ClaudeAgentClient.fetchCatalog", () => {
  it("appends concrete models from Claude settings.json", async () => {
    const configDir = await createClaudeConfigDir({
      model: "us.anthropic.claude-opus-4-7[1m]",
      env: {
        ANTHROPIC_MODEL: "openrouter/anthropic/claude-sonnet-4.5",
        ANTHROPIC_SMALL_FAST_MODEL: "ollama/qwen3-coder",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "bedrock-opus-from-env",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.1",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5",
      },
    });
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    const client = createCatalogClient();

    const { models } = await client.fetchCatalog({
      scope: "workspace",
      cwd: os.tmpdir(),
      force: true,
    });

    expect(models).toEqual([
      ...getClaudeModels(),
      {
        provider: "claude",
        id: "us.anthropic.claude-opus-4-7[1m]",
        label: "us.anthropic.claude-opus-4-7[1m]",
        description: "From Claude settings.json model",
      },
      {
        provider: "claude",
        id: "openrouter/anthropic/claude-sonnet-4.5",
        label: "openrouter/anthropic/claude-sonnet-4.5",
        description: "From Claude settings.json env.ANTHROPIC_MODEL",
      },
      {
        provider: "claude",
        id: "ollama/qwen3-coder",
        label: "ollama/qwen3-coder",
        description: "From Claude settings.json env.ANTHROPIC_SMALL_FAST_MODEL",
      },
      {
        provider: "claude",
        id: "bedrock-opus-from-env",
        label: "bedrock-opus-from-env",
        description: "From Claude settings.json env.ANTHROPIC_DEFAULT_OPUS_MODEL",
      },
      {
        provider: "claude",
        id: "glm-5.1",
        label: "glm-5.1",
        description: "From Claude settings.json env.ANTHROPIC_DEFAULT_SONNET_MODEL",
      },
      {
        provider: "claude",
        id: "glm-5",
        label: "glm-5",
        description: "From Claude settings.json env.ANTHROPIC_DEFAULT_HAIKU_MODEL",
      },
    ]);
  });

  it("falls back to hardcoded models when settings.json is missing", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "gravity-claude-models-"));
    createdClaudeConfigDirs.push(configDir);
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    const client = createCatalogClient();

    const { models } = await client.fetchCatalog({
      scope: "workspace",
      cwd: os.tmpdir(),
      force: true,
    });

    expect(models).toEqual(getClaudeModels());
  });

  it("falls back to hardcoded models when settings.json is malformed", async () => {
    const configDir = await createClaudeConfigDirWithRawSettings("{ nope");
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    const client = createCatalogClient();

    const { models } = await client.fetchCatalog({
      scope: "workspace",
      cwd: os.tmpdir(),
      force: true,
    });

    expect(models).toEqual(getClaudeModels());
  });

  it("ignores empty env blocks and unexpected settings shapes", async () => {
    const configDir = await createClaudeConfigDir({
      model: " ",
      env: {
        ANTHROPIC_MODEL: "",
        ANTHROPIC_DEFAULT_OPUS_MODEL: 42,
      },
    });
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    const client = createCatalogClient();

    const { models } = await client.fetchCatalog({
      scope: "workspace",
      cwd: os.tmpdir(),
      force: true,
    });

    expect(models).toEqual(getClaudeModels());
  });

  it("deduplicates discovered settings models by ID", async () => {
    const configDir = await createClaudeConfigDir({
      model: "glm-5.1",
      env: {
        ANTHROPIC_MODEL: "glm-5.1",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-opus-4-6",
      },
    });
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    const client = createCatalogClient();

    const { models } = await client.fetchCatalog({
      scope: "workspace",
      cwd: os.tmpdir(),
      force: true,
    });

    expect(models.map((model) => model.id)).toEqual([
      ...getClaudeModels().map((model) => model.id),
      "glm-5.1",
    ]);
  });

  it("lets an exact settings model override the hidden Fable compatibility entry", async () => {
    const configDir = await createClaudeConfigDir({ model: "claude-fable-5[1m]" });
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    const client = createCatalogClient();

    const { models } = await client.fetchCatalog({
      scope: "workspace",
      cwd: os.tmpdir(),
      force: true,
    });

    const configured = models.filter((model) => model.id === "claude-fable-5[1m]");
    expect(configured).toHaveLength(1);
    expect(configured[0]).toMatchObject({
      id: "claude-fable-5[1m]",
      isSelectable: true,
      defaultThinkingOptionId: "high",
    });
  });

  it("omits models that require a newer Claude Code version", async () => {
    const client = createCatalogClient("2.1.218");

    const { models } = await client.fetchCatalog({
      scope: "workspace",
      cwd: os.tmpdir(),
      force: true,
    });

    expect(models.map((model) => model.id)).not.toContain("claude-opus-5[1m]");
    expect(models.map((model) => model.id)).not.toContain("claude-opus-5");
  });
});

describe("normalizeClaudeRuntimeModelId", () => {
  it("returns exact match for known model IDs", () => {
    expect(normalizeClaudeRuntimeModelId("claude-opus-5")).toBe("claude-opus-5");
    expect(normalizeClaudeRuntimeModelId("claude-fable-5")).toBe("claude-fable-5");
    expect(normalizeClaudeRuntimeModelId("claude-fable-5[1m]")).toBe("claude-fable-5");
    expect(normalizeClaudeRuntimeModelId("claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(normalizeClaudeRuntimeModelId("claude-sonnet-5[1m]")).toBe("claude-sonnet-5[1m]");
    expect(normalizeClaudeRuntimeModelId("claude-opus-4-6")).toBe("claude-opus-4-6");
    expect(normalizeClaudeRuntimeModelId("claude-opus-4-6[1m]")).toBe("claude-opus-4-6[1m]");
    expect(normalizeClaudeRuntimeModelId("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    expect(normalizeClaudeRuntimeModelId("claude-haiku-4-5")).toBe("claude-haiku-4-5");
  });

  it("normalizes dated model IDs to base model", () => {
    expect(normalizeClaudeRuntimeModelId("claude-opus-5-20260724")).toBe("claude-opus-5");
    expect(normalizeClaudeRuntimeModelId("claude-fable-5-20260301")).toBe("claude-fable-5");
    expect(normalizeClaudeRuntimeModelId("claude-sonnet-5-20260101")).toBe("claude-sonnet-5");
    expect(normalizeClaudeRuntimeModelId("claude-opus-4-6-20260101")).toBe("claude-opus-4-6");
    expect(normalizeClaudeRuntimeModelId("claude-sonnet-4-6-20260101")).toBe("claude-sonnet-4-6");
    expect(normalizeClaudeRuntimeModelId("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
    expect(normalizeClaudeRuntimeModelId("claude-fable-5-20260301[1m]")).toBe("claude-fable-5");
    expect(normalizeClaudeRuntimeModelId("claude-sonnet-5-20260101[1m]")).toBe(
      "claude-sonnet-5[1m]",
    );
  });

  it("preserves [1m] only when it identifies a distinct catalog entry", () => {
    expect(normalizeClaudeRuntimeModelId("claude-fable-5[1m]")).toBe("claude-fable-5");
    expect(normalizeClaudeRuntimeModelId("claude-sonnet-5[1m]")).toBe("claude-sonnet-5[1m]");
    expect(normalizeClaudeRuntimeModelId("claude-opus-4-6[1m]")).toBe("claude-opus-4-6[1m]");
  });

  it("returns null for empty/null/undefined", () => {
    expect(normalizeClaudeRuntimeModelId(null)).toBeNull();
    expect(normalizeClaudeRuntimeModelId(undefined)).toBeNull();
    expect(normalizeClaudeRuntimeModelId("")).toBeNull();
    expect(normalizeClaudeRuntimeModelId("  ")).toBeNull();
  });

  it("returns null for unrecognized strings", () => {
    expect(normalizeClaudeRuntimeModelId("gpt-5")).toBeNull();
    expect(normalizeClaudeRuntimeModelId("random")).toBeNull();
  });

  it("normalizes provider-form runtime model strings", () => {
    expect(normalizeClaudeRuntimeModelId("openrouter/anthropic/claude-opus-4-8")).toBe(
      "claude-opus-4-8",
    );
    expect(normalizeClaudeRuntimeModelId("us.anthropic.claude-opus-4-8[1m]")).toBe(
      "claude-opus-4-8[1m]",
    );
    expect(normalizeClaudeRuntimeModelId("us.anthropic.claude-opus-4-8-20260101")).toBe(
      "claude-opus-4-8",
    );
  });
});

describe("parseClaudeCodeVersion", () => {
  it("prefers the Claude Code version over a wrapper banner", () => {
    expect(parseClaudeCodeVersion("wrapper 1.0.0\n2.1.219 (Claude Code)")).toEqual([2, 1, 219]);
  });
});

describe("findClaudeModel", () => {
  it("resolves runtime model IDs to catalog entries", () => {
    expect(findClaudeModel("claude-sonnet-5-20260101")?.id).toBe("claude-sonnet-5");
    expect(findClaudeModel("claude-sonnet-5[1m]")?.contextWindowMaxTokens).toBe(1_000_000);
    expect(findClaudeModel("us.anthropic.claude-opus-4-8[1m]")?.contextWindowMaxTokens).toBe(
      1_000_000,
    );
  });
});

describe("Claude Opus 5 catalog", () => {
  it("offers a single Opus 5 entry with a 1M context window", () => {
    const opus5Models = getClaudeModels()
      .filter((model) => model.id.startsWith("claude-opus-5"))
      .map(({ id, label, contextWindowMaxTokens }) => ({ id, label, contextWindowMaxTokens }));

    expect(opus5Models).toEqual([
      { id: "claude-opus-5", label: "Opus 5", contextWindowMaxTokens: 1_000_000 },
    ]);
  });

  it("resolves retired and dated Opus 5 IDs to the single catalog entry", () => {
    expect(findClaudeModel("claude-opus-5[1m]")?.id).toBe("claude-opus-5");
    expect(findClaudeModel("claude-opus-5-20260724")?.id).toBe("claude-opus-5");
    expect(findClaudeModel("claude-opus-5-20260724[1m]")?.id).toBe("claude-opus-5");
    expect(findClaudeModel("claude-opus-5[1m]")?.contextWindowMaxTokens).toBe(1_000_000);
  });

  it("keeps disabled thinking available for agents persisted on the retired 1M ID", () => {
    expect(resolveClaudeDisabledThinkingForModel("claude-opus-5[1m]")).toEqual({
      supported: true,
      fallbackThinkingOptionId: "high",
    });
  });
});

describe("Claude Fable 5 catalog", () => {
  it("offers one selectable Fable 5 entry and a compatibility entry for old apps", () => {
    const fable5Models = getClaudeModels()
      .filter((model) => model.id === "claude-fable-5" || model.id === "claude-fable-5[1m]")
      .map(({ id, aliases, isSelectable, label, contextWindowMaxTokens }) => ({
        id,
        aliases,
        isSelectable,
        label,
        contextWindowMaxTokens,
      }));

    expect(fable5Models).toEqual([
      {
        id: "claude-fable-5",
        aliases: ["claude-fable-5[1m]"],
        isSelectable: undefined,
        label: "Fable 5",
        contextWindowMaxTokens: 1_000_000,
      },
      {
        id: "claude-fable-5[1m]",
        aliases: undefined,
        isSelectable: false,
        label: "Fable 5",
        contextWindowMaxTokens: 1_000_000,
      },
    ]);
  });

  it("resolves retired Fable 5 IDs to the canonical catalog entry", () => {
    expect(findClaudeModel("claude-fable-5[1m]")?.id).toBe("claude-fable-5");
    expect(findClaudeModel("claude-fable-5-20260301[1m]")?.id).toBe("claude-fable-5");
  });
});

describe("Claude Fable 5.1 catalog", () => {
  it("offers one Fable 5.1 entry with a 1M context window", () => {
    const fable51Models = getClaudeModels()
      .filter((model) => model.id.startsWith("claude-fable-5-1"))
      .map(({ id, label, contextWindowMaxTokens }) => ({ id, label, contextWindowMaxTokens }));

    expect(fable51Models).toEqual([
      { id: "claude-fable-5-1", label: "Fable 5.1", contextWindowMaxTokens: 1_000_000 },
    ]);
  });

  it("resolves suffixed and dated Fable 5.1 IDs to the catalog entry", () => {
    expect(findClaudeModel("claude-fable-5-1[1m]")?.id).toBe("claude-fable-5-1");
    expect(findClaudeModel("claude-fable-5-1-20260901")?.id).toBe("claude-fable-5-1");
    expect(findClaudeModel("claude-fable-5-1-20260901[1m]")?.id).toBe("claude-fable-5-1");
  });
});

describe("claudeManifestModelSupportsFastMode", () => {
  it("keeps fast mode strict to first-party manifest model IDs", () => {
    expect(normalizeClaudeManifestModelId("openrouter/anthropic/claude-opus-4-8")).toBeNull();
    expect(claudeManifestModelSupportsFastMode("openrouter/anthropic/claude-opus-4-8")).toBe(false);
    expect(claudeManifestModelSupportsFastMode("claude-opus-4-8-20260101")).toBe(true);
  });

  it("supports fast mode on Opus 5 but not on other Claude 5 models", () => {
    expect(claudeManifestModelSupportsFastMode("claude-opus-5")).toBe(true);
    expect(claudeManifestModelSupportsFastMode("claude-sonnet-5")).toBe(false);
    expect(claudeManifestModelSupportsFastMode("claude-fable-5")).toBe(false);
    expect(claudeManifestModelSupportsFastMode("claude-fable-5-1")).toBe(false);
  });
});

// Verbatim `supportedModels()` output from Claude Code v2.1.280, trimmed to the fields the
// mapper reads. Keeping it real is the point: the shapes that matter (an alias row and a
// concrete row resolving to one model, a family the manifest predates) only occur together.
const CLAUDE_CODE_MODEL_ROWS = [
  {
    value: "default",
    resolvedModel: "claude-opus-5-5[1m]",
    displayName: "Default (recommended)",
    description: "Use the default model (currently Opus 5.5 (1M context)) · $4/$20 per Mtok",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
    supportsFastMode: true,
  },
  {
    value: "opus[1m]",
    resolvedModel: "claude-opus-5-5[1m]",
    displayName: "Opus (1M context)",
    description: "Opus 5.5 with 1M context · Best for everyday, complex tasks · $4/$20 per Mtok",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
    supportsFastMode: true,
  },
  {
    value: "claude-fable-5[1m]",
    resolvedModel: "claude-fable-5",
    displayName: "Fable",
    description: "Fable 5 · Most capable for your hardest and longest-running tasks",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    value: "sonnet",
    resolvedModel: "claude-sonnet-5",
    displayName: "Sonnet",
    description: "Sonnet 5 · Efficient for routine tasks · $2/$10 per Mtok",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    value: "haiku",
    resolvedModel: "claude-haiku-4-5-20251001",
    displayName: "Haiku",
    description: "Haiku 4.5 · Fastest for quick answers · $1/$5 per Mtok",
  },
] as const;

function probedClaudeModels() {
  return mapClaudeProbeModels([...CLAUDE_CODE_MODEL_ROWS]);
}

describe("mapClaudeProbeModels", () => {
  it("keys models by their canonical wire id, not the picker alias", () => {
    expect(probedClaudeModels().map((model) => model.id)).toEqual([
      "claude-opus-5-5[1m]",
      "claude-fable-5",
      "claude-sonnet-5",
      "claude-haiku-4-5-20251001",
    ]);
  });

  it("drops the Default row and marks the model it resolves to", () => {
    const models = probedClaudeModels();
    expect(models.some((model) => model.id === "default")).toBe(false);
    expect(models.filter((model) => model.isDefault).map((model) => model.id)).toEqual([
      "claude-opus-5-5[1m]",
    ]);
  });

  it("keeps the picker alias so a saved choice still matches", () => {
    const opus = probedClaudeModels().find((model) => model.id === "claude-opus-5-5[1m]");
    expect(opus?.aliases).toEqual(["opus[1m]"]);
  });

  it("carries the CLI's label, description and effort levels", () => {
    const sonnet = probedClaudeModels().find((model) => model.id === "claude-sonnet-5");
    expect(sonnet?.label).toBe("Sonnet");
    expect(sonnet?.description).toBe("Sonnet 5 · Efficient for routine tasks · $2/$10 per Mtok");
    expect(sonnet?.effortLevels).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("omits effort levels for a model that does not support them", () => {
    const haiku = probedClaudeModels().find((model) => model.id.startsWith("claude-haiku-"));
    expect(haiku?.effortLevels).toBeUndefined();
  });

  it("infers the context window from the 1M suffix", () => {
    const models = probedClaudeModels();
    expect(models.find((model) => model.id === "claude-opus-5-5[1m]")?.contextWindowMaxTokens).toBe(
      1_000_000,
    );
    expect(models.find((model) => model.id === "claude-sonnet-5")?.contextWindowMaxTokens).toBe(
      200_000,
    );
  });

  it("reads the 1M suffix off the picker row when the resolved id lacks it", () => {
    // Fable lists as `claude-fable-5[1m]` but resolves to the unsuffixed `claude-fable-5`.
    const fable = probedClaudeModels().find((model) => model.id === "claude-fable-5");
    expect(fable?.contextWindowMaxTokens).toBe(1_000_000);
  });

  it("takes fast mode from the CLI and disabled thinking from the model family", () => {
    const models = probedClaudeModels();
    const opus = models.find((model) => model.id === "claude-opus-5-5[1m]");
    const fable = models.find((model) => model.id === "claude-fable-5");
    expect(opus?.supportsFastMode).toBe(true);
    expect(opus?.supportsThinkingDisabled).toBe(true);
    expect(fable?.supportsFastMode).toBe(false);
    expect(fable?.supportsThinkingDisabled).toBe(false);
  });
});

describe("Claude catalog with probed models", () => {
  function applyProbe(claudeCodeVersion = "2.1.280"): void {
    applyClaudeRuntimeModels(probedClaudeModels(), claudeCodeVersion);
  }

  it("lists a model this build predates", () => {
    applyProbe();
    const model = getClaudeModels().find((candidate) => candidate.id === "claude-opus-5-5[1m]");
    expect(model?.label).toBe("Opus (1M context)");
    expect(model?.isDefault).toBe(true);
  });

  it("leads with the probed lineup and keeps uncovered manifest models selectable", () => {
    applyProbe();
    const ids = getClaudeModels().map((model) => model.id);
    expect(ids.slice(0, 4)).toEqual([
      "claude-opus-5-5[1m]",
      "claude-fable-5",
      "claude-sonnet-5",
      "claude-haiku-4-5-20251001",
    ]);
    expect(ids).toContain("claude-opus-4-8");
    expect(ids).toContain("claude-fable-5-1");
  });

  it("lists every model exactly once", () => {
    applyProbe();
    const ids = getClaudeModels().map((model) => model.id);
    expect(ids).toEqual([...new Set(ids)]);
  });

  it("lets the probed default outrank the manifest's", () => {
    applyProbe();
    expect(
      getClaudeModels()
        .filter((model) => model.isDefault)
        .map((model) => model.id),
    ).toEqual(["claude-opus-5-5[1m]"]);
  });

  it("prefers the manifest's curated context window for a model it lists", () => {
    applyProbe();
    // The probe would infer 200K from the id; the manifest measures the same value, and for
    // Sonnet 5 that agreement is what keeps the context meter stable across the two sources.
    expect(findClaudeModel("claude-sonnet-5")?.contextWindowMaxTokens).toBe(200_000);
  });

  it("exposes effort and off-thinking options for a probed model", () => {
    applyProbe();
    const model = getClaudeModels().find((candidate) => candidate.id === "claude-opus-5-5[1m]");
    expect(model?.thinkingOptions?.map((option) => option.id)).toEqual([
      CLAUDE_DISABLED_THINKING_OPTION_ID,
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      CLAUDE_ULTRACODE_THINKING_OPTION_ID,
    ]);
  });

  it("answers capability lookups for a probed model", () => {
    applyProbe();
    expect(claudeManifestModelSupportsFastMode("claude-opus-5-5[1m]")).toBe(true);
    expect(resolveClaudeDisabledThinkingForModel("claude-opus-5-5[1m]")).toEqual({
      supported: true,
      fallbackThinkingOptionId: "high",
    });
    expect(normalizeClaudeManifestModelId("claude-opus-5-5[1m]")).toBe("claude-opus-5-5[1m]");
  });

  it("does not grant fast mode to a probed model whose family lacks it", () => {
    applyProbe();
    expect(claudeManifestModelSupportsFastMode("claude-fable-5")).toBe(false);
  });

  it("falls back to the manifest when the probe reports nothing", () => {
    applyClaudeRuntimeModels([], "2.1.280");
    expect(getClaudeModels().map((model) => model.id)).toContain("claude-opus-5");
    expect(getClaudeModels().some((model) => model.id === "claude-opus-5-5[1m]")).toBe(false);
  });
});

describe("ClaudeAgentClient.fetchCatalog model probe", () => {
  it("serves what Claude Code reported", async () => {
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      resolveVersion: async () => "2.1.280",
      probeModels: async () => probedClaudeModels(),
    });
    const { models } = await client.fetchCatalog({ scope: "global", force: false });
    expect(models[0]?.id).toBe("claude-opus-5-5[1m]");
  });

  it("keeps serving the manifest when the probe fails", async () => {
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      resolveVersion: async () => "2.1.280",
      probeModels: async () => {
        throw new Error("claude is not installed");
      },
    });
    const { models } = await client.fetchCatalog({ scope: "global", force: false });
    expect(models.map((model) => model.id)).toContain("claude-opus-5");
  });
});
