import { describe, expect, it } from "vitest";
import {
  classifyClaudeScope,
  parseClaudeMcpList,
  parseCodexMcpListJson,
} from "./provider-mcp-servers.js";

describe("parseClaudeMcpList", () => {
  it("reads name, endpoint, and status from each health line", () => {
    const stdout = [
      "Checking MCP server health…",
      "",
      "claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected",
      "oneleet: https://api.oneleet.com/mcp (HTTP) - ✗ Failed to connect",
      "repo-tools: npx -y repo-tools --port 3000 - ⏸ Pending approval",
      "legacy: node server.js - ✘ Disabled",
    ].join("\n");

    expect(parseClaudeMcpList(stdout)).toEqual([
      {
        name: "claude.ai Gmail",
        transport: "http",
        endpoint: "https://gmailmcp.googleapis.com/mcp/v1",
        status: "connected",
        detail: "Connected",
      },
      {
        name: "oneleet",
        transport: "http",
        endpoint: "https://api.oneleet.com/mcp",
        status: "failed",
        detail: "Failed to connect",
      },
      {
        name: "repo-tools",
        transport: "stdio",
        endpoint: "npx -y repo-tools --port 3000",
        status: "pending_approval",
        detail: "Pending approval",
      },
      {
        name: "legacy",
        transport: "stdio",
        endpoint: "node server.js",
        status: "disabled",
        detail: "Disabled",
      },
    ]);
  });

  it("returns nothing for the empty-state hint", () => {
    expect(
      parseClaudeMcpList("No MCP servers configured. Use `claude mcp add` to add a server.\n"),
    ).toEqual([]);
  });
});

describe("classifyClaudeScope", () => {
  const scopes = { user: new Set(["linear"]), project: new Set(["oneleet"]) };

  it("recognizes claude.ai connectors by name and local scopes by config membership", () => {
    expect(classifyClaudeScope("claude.ai Gmail", scopes)).toBe("claude_ai");
    expect(classifyClaudeScope("oneleet", scopes)).toBe("project");
    expect(classifyClaudeScope("linear", scopes)).toBe("user");
    expect(classifyClaudeScope("mystery", scopes)).toBe("unknown");
  });
});

describe("parseCodexMcpListJson", () => {
  it("keeps only the command or URL and drops env and headers", () => {
    const stdout = JSON.stringify([
      {
        name: "oneleet",
        enabled: true,
        disabled_reason: null,
        transport: {
          type: "streamable_http",
          url: "https://api.oneleet.com/mcp",
          http_headers: { Authorization: "Bearer secret" },
        },
        auth_status: "bearer_token",
      },
      {
        name: "node_repl",
        enabled: false,
        disabled_reason: "disabled in config",
        transport: {
          type: "stdio",
          command: "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl",
          args: ["--token", "secret"],
          env: { API_KEY: "secret" },
        },
        auth_status: "unsupported",
      },
    ]);

    const servers = parseCodexMcpListJson(stdout);
    expect(servers).toEqual([
      {
        name: "oneleet",
        scope: "user",
        transport: "streamable_http",
        endpoint: "https://api.oneleet.com/mcp",
        status: "configured",
        detail: "bearer token",
      },
      {
        name: "node_repl",
        scope: "user",
        transport: "stdio",
        endpoint: "node_repl",
        status: "disabled",
        detail: "disabled in config",
      },
    ]);
    expect(JSON.stringify(servers)).not.toContain("secret");
  });

  it("tolerates a log line before the JSON and rejects malformed JSON", () => {
    expect(parseCodexMcpListJson("warning: something\n[]")).toEqual([]);
    expect(() => parseCodexMcpListJson("[{")).toThrow(/Could not read Codex MCP output/);
  });
});
