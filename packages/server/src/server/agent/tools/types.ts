import type { z } from "zod";
import type { ProviderGravityToolsPolicy } from "@gravity/protocol/provider-config";

export interface GravityToolExecutionContext {
  signal?: AbortSignal;
  sendUpdate?: (update: GravityToolResult) => void;
}

export interface GravityToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface GravityToolConfig {
  title?: string;
  description?: string;
  inputSchema?: z.ZodRawShape | z.ZodType;
  outputSchema?: z.ZodRawShape;
}

export interface GravityToolDefinition extends GravityToolConfig {
  name: string;
  description: string;
  handler: (input: unknown, context: GravityToolExecutionContext) => Promise<GravityToolResult>;
}

export interface GravityToolCatalog {
  tools: ReadonlyMap<string, GravityToolDefinition>;
  getTool(name: string): GravityToolDefinition | undefined;
  executeTool(
    name: string,
    input: unknown,
    context?: GravityToolExecutionContext,
  ): Promise<GravityToolResult>;
}

export interface GravityToolRuntimeContext {
  callerAgentId?: string;
  gravityToolPolicy?: ProviderGravityToolsPolicy;
  enableVoiceTools?: boolean;
  voiceOnly?: boolean;
}

export type GravityToolCatalogFactory = (
  context: GravityToolRuntimeContext,
) => GravityToolCatalog | Promise<GravityToolCatalog>;
