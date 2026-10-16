# Provider MCP servers

The "MCP servers" tab on a host's Claude Code and Codex settings pages is read-only. It shows which servers the provider can reach and tells the user where to connect more. Gravity never adds, removes, or logs in to a server.

## Where the truth lives

| Provider    | Source Gravity asks                            | What it can say                                                            |
| ----------- | ---------------------------------------------- | -------------------------------------------------------------------------- |
| Claude Code | `claude mcp list`, run in the chosen directory | Connected, Failed, Needs approval, Disabled. The CLI probes each server.   |
| Codex       | `codex mcp list --json`                        | Configured or Disabled only. Codex reads `config.toml` and does not probe. |

Do not read the config files to build this list for Claude Code. The claude.ai connectors (Gmail, Slack, Google Drive, Calendar) come from the account and never appear in `~/.claude.json` or `.mcp.json`; only the CLI sees them. Local files are read only to label a server's scope (`user`, `project`), and the label falls back to `unknown` when they disagree with the CLI.

Claude Code merges project-scoped servers only when run inside that project, so the request carries a `cwd` and the tab has a scope picker. Codex has one config per host, so the picker is hidden there.

## Secrets

Codex stores bearer tokens in plain text in `config.toml`, and `codex mcp list --json` prints headers and env for every server. `packages/server/src/services/provider-mcp-servers.ts` reduces both CLIs' output to name, scope, transport, endpoint (URL or bare command), status, and a one-line detail before it leaves the host. Keep it that way; never return raw CLI output or config contents over the wire.

## Timing

The Claude health check connects to every server and can take tens of seconds when a remote connector refreshes its token. The daemon allows 75 s for the CLI, the client allows 90 s for the RPC, and the app caches the result for a minute with a manual Refresh.

Protocol: `provider.mcp_servers.list.request` / `.response` in `packages/protocol/src/provider-mcp-servers.ts`. There is no feature gate; a daemon without the RPC answers with an error the tab shows with a Retry button.
