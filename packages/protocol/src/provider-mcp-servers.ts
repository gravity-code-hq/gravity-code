import { z } from "zod";

export const ProviderMcpServerStatusSchema = z.enum([
  "connected",
  "failed",
  "pending_approval",
  "disabled",
  "configured",
  "unknown",
]);
export type ProviderMcpServerStatus = z.infer<typeof ProviderMcpServerStatusSchema>;

export const ProviderMcpServerScopeSchema = z.enum(["claude_ai", "user", "project", "unknown"]);
export type ProviderMcpServerScope = z.infer<typeof ProviderMcpServerScopeSchema>;

/**
 * One MCP server as the provider CLI reports it. `endpoint` is the URL or the
 * bare command; headers, env, args, and tokens never leave the host.
 */
export const ProviderMcpServerSchema = z.object({
  name: z.string(),
  scope: ProviderMcpServerScopeSchema,
  transport: z.string().nullable(),
  endpoint: z.string().nullable(),
  status: ProviderMcpServerStatusSchema,
  detail: z.string().nullable(),
});
export type ProviderMcpServer = z.infer<typeof ProviderMcpServerSchema>;

export const ProviderMcpServersListRequestSchema = z.object({
  type: z.literal("provider.mcp_servers.list.request"),
  requestId: z.string(),
  provider: z.enum(["codex", "claude"]),
  cwd: z.string().optional(),
});

export const ProviderMcpServersListResponseSchema = z.object({
  type: z.literal("provider.mcp_servers.list.response"),
  payload: z.object({
    requestId: z.string(),
    servers: z.array(ProviderMcpServerSchema),
    // True when the CLI probed each server; false when it only read config.
    healthChecked: z.boolean(),
    warnings: z.array(z.string()),
  }),
});
