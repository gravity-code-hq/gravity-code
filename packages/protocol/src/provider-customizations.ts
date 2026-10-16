import { z } from "zod";

export const ProviderCustomizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  kind: z.enum(["command", "skill"]),
  source: z.enum(["personal", "project", "plugin", "provider"]),
  editable: z.boolean(),
  file: z.object({ cwd: z.string(), path: z.string() }).nullable(),
});

export type ProviderCustomization = z.infer<typeof ProviderCustomizationSchema>;

export const ProviderCommandNameSchema = z
  .string()
  .max(100)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);

export const ProviderCommandCreateRequestSchema = z.object({
  type: z.literal("provider.commands.create.request"),
  requestId: z.string(),
  provider: z.enum(["codex", "claude"]),
  cwd: z.string().optional(),
  name: ProviderCommandNameSchema,
  content: z
    .string()
    .min(1)
    .max(1024 * 1024),
});

export const ProviderCommandCreateResponseSchema = z.object({
  type: z.literal("provider.commands.create.response"),
  payload: z.object({
    requestId: z.string(),
    status: z.enum(["created", "exists"]),
  }),
});

export const ProviderCustomizationsListRequestSchema = z.object({
  type: z.literal("provider.customizations.list.request"),
  requestId: z.string(),
  provider: z.enum(["codex", "claude"]),
  cwd: z.string().optional(),
  model: z.string().optional(),
});

export const ProviderCustomizationsListResponseSchema = z.object({
  type: z.literal("provider.customizations.list.response"),
  payload: z.object({
    requestId: z.string(),
    entries: z.array(ProviderCustomizationSchema),
    warnings: z.array(z.string()),
  }),
});
