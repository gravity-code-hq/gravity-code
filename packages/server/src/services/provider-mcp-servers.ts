import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  ProviderMcpServer,
  ProviderMcpServerScope,
  ProviderMcpServerStatus,
} from "@gravity/protocol/provider-mcp-servers";
import type { ProviderRuntimeSettings } from "@gravity/protocol/provider-config";
import {
  checkProviderLaunchAvailable,
  resolveProviderLaunch,
} from "../server/agent/provider-launch-config.js";
import { findDefaultCodexBinary } from "../server/agent/providers/codex-app-server-agent.js";
import { execCommand } from "../utils/spawn.js";

export interface ProviderMcpServersResult {
  servers: ProviderMcpServer[];
  healthChecked: boolean;
  warnings: string[];
}

export interface ListProviderMcpServersOptions {
  provider: "codex" | "claude";
  cwd?: string;
  runtimeSettings?: ProviderRuntimeSettings;
  home?: string;
}

/**
 * The provider CLIs are the only truthful source. Claude Code merges servers
 * from `~/.claude.json`, the project's `.mcp.json`, and the claude.ai account
 * (connectors such as Gmail or Slack never appear in any local file), and only
 * `claude mcp list` resolves and health-checks that union. Codex keeps
 * everything in `config.toml`; `codex mcp list --json` reads it without
 * probing. Both outputs are reduced to names, endpoints, and status here so
 * tokens stored in those files stay on the host.
 */
export async function listProviderMcpServers(
  options: ListProviderMcpServersOptions,
): Promise<ProviderMcpServersResult> {
  return options.provider === "claude"
    ? listClaudeMcpServers(options)
    : listCodexMcpServers(options);
}

// The CLI health check connects to every server, so remote connectors with
// slow OAuth refreshes can take a while; give it room before the client's
// own request timeout.
const CLI_TIMEOUT_MS = 75_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

async function listClaudeMcpServers(
  options: ListProviderMcpServersOptions,
): Promise<ProviderMcpServersResult> {
  const launch = await resolveProviderLaunch({
    commandConfig: options.runtimeSettings?.command,
    defaultBinary: "claude",
  });
  const availability = await checkProviderLaunchAvailable(launch);
  if (!availability.available) {
    throw new Error("Claude Code is not installed on this host");
  }
  const { stdout } = await execCommand(
    availability.resolvedPath ?? launch.command,
    [...launch.args, "mcp", "list"],
    { cwd: options.cwd, timeout: CLI_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES },
  );
  const scopes = await readClaudeScopes(options);
  const servers: ProviderMcpServer[] = [];
  for (const server of parseClaudeMcpList(stdout)) {
    servers.push({ ...server, scope: classifyClaudeScope(server.name, scopes) });
  }
  return { servers, healthChecked: true, warnings: [] };
}

async function listCodexMcpServers(
  options: ListProviderMcpServersOptions,
): Promise<ProviderMcpServersResult> {
  const launch = await resolveProviderLaunch({
    commandConfig: options.runtimeSettings?.command,
    defaultBinary: { command: "codex", resolvePath: findDefaultCodexBinary },
  });
  const availability = await checkProviderLaunchAvailable(launch, {
    command: "codex",
    resolvePath: findDefaultCodexBinary,
  });
  if (!availability.available) {
    throw new Error("Codex is not installed on this host");
  }
  const { stdout } = await execCommand(
    availability.resolvedPath ?? launch.command,
    [...launch.args, "mcp", "list", "--json"],
    { cwd: options.cwd, timeout: CLI_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES },
  );
  return { servers: parseCodexMcpListJson(stdout), healthChecked: false, warnings: [] };
}

const CLAUDE_AI_PREFIX = "claude.ai ";

/**
 * `claude mcp list` prints one line per server:
 *   `<name>: <url or command> - ✔ Connected`
 * The name never contains ": ", the endpoint may, and the status sits after the
 * last " - ". Lines without that shape (the "Checking…" banner, the empty-state
 * hint) are skipped.
 */
export function parseClaudeMcpList(stdout: string): Omit<ProviderMcpServer, "scope">[] {
  const servers: Omit<ProviderMcpServer, "scope">[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    const nameEnd = line.indexOf(": ");
    const statusStart = line.lastIndexOf(" - ");
    if (nameEnd <= 0 || statusStart <= nameEnd) {
      continue;
    }
    const name = line.slice(0, nameEnd).trim();
    const { endpoint, transport } = splitClaudeEndpoint(line.slice(nameEnd + 2, statusStart));
    const statusText = line.slice(statusStart + 3).trim();
    if (!name || !statusText) {
      continue;
    }
    servers.push({
      name,
      transport,
      endpoint: endpoint || null,
      status: parseClaudeStatus(statusText),
      detail: stripStatusGlyph(statusText) || null,
    });
  }
  return servers;
}

// Project-scoped entries carry a trailing transport tag: `https://… (HTTP)`.
const CLAUDE_TRANSPORT_TAG = /\s+\((HTTP|SSE|STDIO|WS)\)$/i;

function splitClaudeEndpoint(raw: string): { endpoint: string; transport: string | null } {
  const trimmed = raw.trim();
  const tag = CLAUDE_TRANSPORT_TAG.exec(trimmed);
  if (tag?.[1]) {
    const endpoint = trimmed.slice(0, tag.index).trim();
    return { endpoint, transport: tag[1].toLowerCase() };
  }
  return { endpoint: trimmed, transport: inferClaudeTransport(trimmed) };
}

function inferClaudeTransport(endpoint: string): string | null {
  if (!endpoint) return null;
  if (/^https?:\/\//i.test(endpoint)) return "http";
  if (/^wss?:\/\//i.test(endpoint)) return "ws";
  return "stdio";
}

function parseClaudeStatus(text: string): ProviderMcpServerStatus {
  const lower = text.toLowerCase();
  if (lower.includes("connected")) return "connected";
  if (lower.includes("pending")) return "pending_approval";
  if (lower.includes("disabled")) return "disabled";
  if (lower.includes("fail") || lower.includes("error")) return "failed";
  return "unknown";
}

function stripStatusGlyph(text: string): string {
  return text.replace(/^[^\p{L}\p{N}]+/u, "").trim();
}

interface ClaudeScopeNames {
  user: Set<string>;
  project: Set<string>;
}

async function readClaudeScopes(options: ListProviderMcpServersOptions): Promise<ClaudeScopeNames> {
  const scopes: ClaudeScopeNames = { user: new Set(), project: new Set() };
  const home = options.home ?? os.homedir();
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  const globalConfigPath = configDir
    ? path.join(configDir, ".claude.json")
    : path.join(home, ".claude.json");
  const global = await readJsonObject(globalConfigPath);
  for (const name of Object.keys(asRecord(global?.mcpServers))) {
    scopes.user.add(name);
  }
  if (options.cwd) {
    const projects = asRecord(global?.projects);
    for (const name of Object.keys(asRecord(asRecord(projects[options.cwd]).mcpServers))) {
      scopes.project.add(name);
    }
    const mcpJson = await readJsonObject(path.join(options.cwd, ".mcp.json"));
    for (const name of Object.keys(asRecord(mcpJson?.mcpServers))) {
      scopes.project.add(name);
    }
  }
  return scopes;
}

export function classifyClaudeScope(
  name: string,
  scopes: ClaudeScopeNames,
): ProviderMcpServerScope {
  if (name.startsWith(CLAUDE_AI_PREFIX)) return "claude_ai";
  if (scopes.project.has(name)) return "project";
  if (scopes.user.has(name)) return "user";
  return "unknown";
}

async function readJsonObject(file: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * `codex mcp list --json` emits the configured servers with their full
 * transport, including env and headers. Only the command or URL survives.
 */
export function parseCodexMcpListJson(stdout: string): ProviderMcpServer[] {
  const start = stdout.indexOf("[");
  if (start < 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.slice(start));
  } catch (error) {
    throw new Error(
      `Could not read Codex MCP output: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!Array.isArray(parsed)) return [];
  const servers: ProviderMcpServer[] = [];
  for (const entry of parsed) {
    const record = asRecord(entry);
    const name = typeof record.name === "string" ? record.name : null;
    if (!name) continue;
    const transport = asRecord(record.transport);
    const transportType = typeof transport.type === "string" ? transport.type : null;
    const url = typeof transport.url === "string" ? transport.url : null;
    const command = typeof transport.command === "string" ? transport.command : null;
    const enabled = record.enabled !== false;
    const disabledReason =
      typeof record.disabled_reason === "string" ? record.disabled_reason : null;
    const auth = typeof record.auth_status === "string" ? record.auth_status : null;
    servers.push({
      name,
      scope: "user",
      transport: transportType,
      endpoint: url ?? (command ? path.basename(command) : null),
      status: enabled ? "configured" : "disabled",
      detail: enabled ? describeCodexAuth(auth) : disabledReason,
    });
  }
  return servers;
}

function describeCodexAuth(auth: string | null): string | null {
  if (!auth || auth === "unsupported") return null;
  return auth.replace(/_/g, " ");
}
