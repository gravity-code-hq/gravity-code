import { z } from "zod";

const TCP_PORT_RANGE_PATTERN = /^(\d{1,5})-(\d{1,5})$/;

export const GravityServicePortAllocationSchema = z
  .object({
    range: z.string().trim().regex(TCP_PORT_RANGE_PATTERN).optional(),
    portScript: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (value) => value.range !== undefined || value.portScript !== undefined,
    "Expected range or portScript",
  )
  .refine((value) => {
    if (!value.range) return true;
    const match = TCP_PORT_RANGE_PATTERN.exec(value.range);
    if (!match) return false;
    const start = Number(match[1]);
    const end = Number(match[2]);
    return start >= 1 && end <= 65_535 && start <= end;
  }, "Expected an inclusive TCP port range from 1-65535");

export function normalizeLifecycleCommands(commands: unknown): string[] {
  if (typeof commands === "string") {
    return commands.trim().length > 0 ? [commands] : [];
  }
  if (!Array.isArray(commands)) {
    return [];
  }
  return commands.filter((command): command is string => {
    return typeof command === "string" && command.trim().length > 0;
  });
}

export const GravityLifecycleCommandRawSchema = z.union([z.string(), z.array(z.string())]);

export const GravityScriptEntryRawSchema = z
  .object({
    type: z.unknown().optional(),
    command: z.unknown().optional(),
    port: z.unknown().optional(),
  })
  .passthrough();

export const GravityWorktreeConfigRawSchema = z
  .object({
    setup: GravityLifecycleCommandRawSchema.optional(),
    teardown: GravityLifecycleCommandRawSchema.optional(),
    terminals: z.unknown().optional(),
    servicePorts: GravityServicePortAllocationSchema.optional(),
  })
  .passthrough();

export const GravityMetadataGenerationEntrySchema = z
  .object({
    instructions: z.string().optional(),
  })
  .passthrough()
  .catch({});

export const GravityMetadataGenerationSchema = z
  .object({
    title: GravityMetadataGenerationEntrySchema.optional(),
    branchName: GravityMetadataGenerationEntrySchema.optional(),
    commitMessage: GravityMetadataGenerationEntrySchema.optional(),
    pullRequest: GravityMetadataGenerationEntrySchema.optional(),
  })
  // COMPAT(projectMetadataAgentTitle): `agentTitle` project metadata prompts were removed
  // in v0.1.96; keep legacy gravity.json parseable until 2026-12-16.
  .passthrough()
  .catch({});

export const GravityConfigRawSchema = z
  .object({
    worktree: GravityWorktreeConfigRawSchema.optional(),
    scripts: z.record(z.string(), GravityScriptEntryRawSchema).optional(),
    metadataGeneration: GravityMetadataGenerationSchema.optional(),
  })
  .passthrough();

export const WorktreeConfigSchema = GravityWorktreeConfigRawSchema.extend({
  setup: z.unknown().optional().transform(normalizeLifecycleCommands),
  teardown: z.unknown().optional().transform(normalizeLifecycleCommands),
})
  .passthrough()
  .catch({ setup: [], teardown: [] });

export const ScriptEntrySchema = GravityScriptEntryRawSchema.catch({});

export const GravityConfigSchema = GravityConfigRawSchema.extend({
  worktree: WorktreeConfigSchema.optional(),
  scripts: z.record(z.string(), ScriptEntrySchema).optional().catch({}),
  metadataGeneration: GravityMetadataGenerationSchema.optional(),
})
  .passthrough()
  .catch({});

export const GravityConfigRevisionSchema = z.object({
  mtimeMs: z.number(),
  size: z.number(),
});

export const ProjectConfigRpcErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("project_not_found") }),
  z.object({ code: z.literal("invalid_project_config") }),
  z.object({
    code: z.literal("stale_project_config"),
    currentRevision: GravityConfigRevisionSchema.nullable(),
  }),
  z.object({ code: z.literal("write_failed") }),
]);

export type GravityScriptEntryRaw = z.infer<typeof GravityScriptEntryRawSchema>;
export type GravityMetadataGenerationEntry = z.infer<typeof GravityMetadataGenerationEntrySchema>;
export type GravityMetadataGeneration = z.infer<typeof GravityMetadataGenerationSchema>;
export type GravityServicePortAllocation = z.infer<typeof GravityServicePortAllocationSchema>;
export type GravityConfigRaw = z.infer<typeof GravityConfigRawSchema>;
export type GravityConfig = z.infer<typeof GravityConfigSchema>;
export type GravityConfigRevision = z.infer<typeof GravityConfigRevisionSchema>;
export type ProjectConfigRpcError = z.infer<typeof ProjectConfigRpcErrorSchema>;
