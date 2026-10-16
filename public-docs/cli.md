---
title: CLI reference
description: "Gravity CLI reference: manage projects, workspaces, agents, plugins, scripts, schedules, daemons, and permissions from your terminal."
nav: CLI reference
order: 35
category: Orchestration
---

# CLI reference

The Gravity CLI lets you manage agents from your terminal. It's the same interface exposed by the daemon's API, so anything you can do in the app you can do from the command line.

> **Agent orchestration:** You can tell coding agents to use the Gravity CLI to spawn and manage other agents. Gravity recognizes the calling agent, so CLI-created workers get the same workspace and parent defaults as MCP-created workers.

## Quick reference

```bash
gravity run "fix the tests"            # Start an agent
gravity ls                             # List running agents
gravity attach <id>                    # Stream agent output
gravity send <id> "also fix linting"   # Send follow-up task
gravity logs <id>                      # View agent timeline
gravity stop <id>                      # Stop an agent
```

## Provider diagnostics

Ask the daemon to inspect the provider environment it actually uses:

```bash
gravity provider diagnostic claude
gravity provider diagnostic codex --json
gravity --host devbox:6767 provider diagnostic opencode
```

The diagnostic includes the configured command, daemon `PATH` and shell, matching binaries, resolved path, version, model count, and provider status. Use the global `--host` option for a remote daemon. This is the same diagnostic shown under **Settings → your host → Providers → provider → Diagnostic**.

## Running agents

Use `gravity run` to start a new agent with a task:

```bash
gravity run "implement user authentication"
gravity run --provider codex "refactor the API layer"
gravity run --background "run the focused test suite"
gravity run --new-workspace worktree --worktree-mode branch-off --new-branch feature/x --base origin/main "implement feature X"
gravity run --workspace <workspace-id> "review the current diff"
gravity run --output-schema schema.json "extract release notes"
gravity run --output-schema '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}' "summarize release notes"
```

From a human shell, a bare `gravity run` creates a new local workspace for the current directory. Use `--workspace <id>` to add the agent to an existing workspace, or `--new-workspace local|worktree` to explicitly create a separate workspace for the run.

Worktree creation accepts `--worktree-mode branch-off|checkout-branch|checkout-pr` plus the matching `--new-branch`/`--base`, `--branch`, or `--pr-number`/`--forge` options. Use `--worktree-slug` to choose the managed directory slug.

When an existing Gravity agent runs the same command, Gravity recognizes it through `GRAVITY_AGENT_ID`. Without explicit placement, the new agent becomes its subagent in the same workspace. `--workspace` can place that subagent elsewhere without changing its parent.

Use `--output-schema` to return only matching JSON output. You can pass a schema file path or an inline JSON schema object. This mode cannot be used with `--background`.

By default, `gravity run` waits for completion. Use `--background` to return immediately while the agent keeps running.

## Projects

Register the current directory as a project, then list the projects known to the daemon:

```bash
cd ~/dev/my-app
gravity project create
gravity project ls
```

Use the project ID from `gravity project ls` to rename, reset, or delete a project:

```bash
gravity project rename <project-id> "My app"
gravity project rename <project-id> --reset
gravity project delete <project-id>
```

`--reset` restores the name derived from the project directory. Deleting a project archives its active workspaces and removes the project from Gravity. It does not delete the project directory.

For a local daemon, `gravity project create [path]` defaults to the current directory and resolves relative paths on the CLI machine. When you use the global `--host` option or `GRAVITY_HOST`, provide a path that the target daemon can access:

```bash
gravity --host devbox:6767 project create /srv/repos/api
```

The remote daemon interprets that path on its own machine. See [Workspaces](/docs/workspaces) for how projects group working directories and sessions.

## Workspaces

Create a workspace independently when you want to prepare its files before starting an agent:

```bash
gravity workspace create --path ~/dev/my-app --title feature-auth

gravity workspace create \
  --path ~/dev/my-app \
  --mode branch-off \
  --new-branch feature/auth \
  --worktree-slug feature-auth \
  --base origin/main

gravity workspace create \
  --path ~/dev/my-app \
  --mode checkout-branch \
  --branch feature/existing \
  --worktree-slug existing-copy

gravity workspace create \
  --path ~/dev/my-app \
  --mode checkout-pr \
  --pr-number 2186
```

Then list, use, rename, or archive it:

```bash
gravity workspace ls
gravity run --workspace <workspace-id> "implement authentication"
gravity workspace rename <workspace-id> "Auth rework"
gravity workspace rename <workspace-id> --reset   # back to the branch or directory name
gravity workspace archive <workspace-id>
```

Add `--forge <name>` to PR checkout when Gravity cannot infer the forge from the source checkout. See [Git worktrees](/docs/worktrees) for setup hooks and services.

## Terminals

Use the workspace ID when multiple workspaces share a directory:

```bash
gravity terminal create --workspace <workspace-id> --name Development
gravity terminal ls --workspace <workspace-id> --json
gravity terminal send-keys <terminal-id> -l "echo ready"
gravity terminal send-keys <terminal-id> Enter
gravity terminal capture <terminal-id>
gravity terminal kill <terminal-id>
```

Creation defaults to the workspace directory. Add `--cwd <absolute-path>` to change the process directory while keeping that workspace as the owner. Unknown and archived workspace IDs fail.

Without `--workspace`, creation opens the project at `--cwd` or the current directory and reuses its oldest active workspace. Listing without `--workspace` filters by `--cwd` or the current directory and can include multiple workspaces. `ls --all` lists every terminal on the host and cannot be combined with directory or workspace filters.

Create and list results include `id`, `name`, `cwd`, and `workspaceId`. Use `--json` for structured output and the global `--host` option to target another daemon. These commands require a host that supports the [workspace terminal API](/docs/sdk/reference#clientterminals); older hosts return an update message.

## Workspace scripts

List, start, and stop the scripts configured in a workspace's `gravity.json`:

```bash
gravity script ls
gravity script start web
gravity script stop web
```

By default, Gravity selects the workspace whose directory is the current directory. Pass `--cwd <path>` to select a different directory, or `--workspace <workspace-id>` when a directory has multiple workspaces. Use the global `--host` option to target another daemon. These commands also accept standard output options such as `--json`.

The output includes each script's lifecycle and supervised terminal ID. Services also include their assigned port, proxy URL, and health. See [Git worktrees](/docs/worktrees#scripts-and-services) for `gravity.json` configuration.

## Plugins

> **Trust every plugin you add.** `gravity plugin add` and `gravity plugin install` mean “I trust this codebase.” Plugin server code and Git preparation commands run unsandboxed with the daemon user's access on the daemon host; client contributions run inside Gravity. Dependencies and future updates are part of that decision. With the global `--host` option, commands run on the remote daemon host.

Create and manage trusted plugins on a daemon:

```bash
gravity plugin init /absolute/path/to/plugin
gravity plugin install /absolute/path/to/plugin
gravity plugin add owner/repository
gravity plugin add https://gitlab.com/group/repository.git --ref main
gravity plugin add owner/monorepo:plugins/review
gravity plugin ls [id]
gravity plugin update my-plugin
gravity plugin update --all
gravity plugin reload my-plugin
gravity plugin logs my-plugin
gravity plugin disable my-plugin
gravity plugin enable my-plugin
gravity plugin remove my-plugin
```

GitHub shorthand checks an existing host directory first. Append `:<directory>` for a plugin in a
monorepo. `gravity plugin ls [id]` does not contact the remote. `gravity plugin logs <id>` returns the
plugin's recent daemon-side stdout and stderr. Add `--json` for structured entries, or run
`gravity --host <target> plugin logs <id>` for another daemon. See the
[Plugin reference](/docs/plugins/v0.7/reference) for installation, trust, lifecycle, and log-retention
behavior.

## Listing agents

```bash
gravity ls                    # Non-archived agents in active workspaces
gravity ls -a                 # Also include archived agents
gravity ls -g                 # Non-archived agents across all workspaces
gravity ls -a -g --json       # All agents, including archived, as JSON
```

## Streaming output

Use `gravity attach` to stream an agent's output in real-time:

```bash
gravity attach abc123   # Attach to agent (Ctrl+C to detach)
```

Agent IDs can be shortened, `abc` works if it's unambiguous.

## Sending messages

Send follow-up tasks to a running or idle agent:

Use the recipient's agent ID from `gravity ls`, or [copy it from the agent's tab](/docs/orchestration-workflows#send-a-prompt-to-another-agent).

```bash
gravity send <id> "now run the tests"
gravity send <id> --image screenshot.png "what's wrong here?"
gravity send <id> --no-wait "queue this task"
```

## Viewing logs

```bash
gravity logs <id>                  # Full timeline
gravity logs <id> -f               # Follow (streaming)
gravity logs <id> --tail 10        # Last 10 entries
gravity logs <id> --filter tools   # Only tool calls
```

## Waiting for agents

Block until an agent finishes its current task:

```bash
gravity wait <id>
gravity wait <id> --timeout 60   # 60 second timeout
```

Useful in scripts or when one agent needs to wait for another.

## Schedules

Run an agent on a cron schedule. The CLI also accepts simple cadence presets and compiles them to cron. See [Schedules from the CLI](/docs/schedules-cli) for the full reference.

```bash
gravity schedule create --every 30m --cwd ~/dev/my-app "Continue the refactor and leave a note."
gravity schedule ls
gravity schedule pause <id>
```

## Permissions

Agents may request permission for certain actions. Manage these from the CLI:

```bash
gravity permit ls                # List pending requests
gravity permit allow <id>        # Allow all pending for agent
gravity permit deny <id> --all   # Deny all pending
```

## Agent modes

Change an agent's operational mode (provider-specific):

```bash
gravity agent mode <id> --list   # Show available modes
gravity agent mode <id> bypass   # Set bypass mode
gravity agent mode <id> plan     # Set plan mode
gravity agent detach <id>        # Make a subagent top-level
```

Detaching is an explicit lifecycle action, not a creation flag. The agent keeps running; only its relationship to its parent changes.

## Daemon management

Define an instance once, then start its saved configuration:

```bash
gravity daemon config set daemon.listen 127.0.0.1:6799 --home ~/gravity-test
gravity daemon config set daemon.relay.enabled false --home ~/gravity-test
gravity daemon start --home ~/gravity-test
gravity project ls --home ~/gravity-test
gravity daemon restart --home ~/gravity-test
gravity daemon stop --home ~/gravity-test
```

`start` runs in the background and reports the actual listening address and supervisor PID. It accepts only home selection and `--timeout <seconds>` (default 600). If waiting times out, the supervisor remains running: use the printed status, log, and stop instructions. A worker that exits before becoming ready makes startup fail.

`restart` requests a replacement worker from the existing supervisor. It rereads the file and retains the supervisor's original environment and arguments. Success confirms a different ready worker, following a changed address for a home target. It never starts a stopped daemon or refreshes the supervisor binary. A timeout reports whether the request was acknowledged; it does not prove why reconnection failed.

`stop --home` waits for that local supervisor to exit. On POSIX it signals the supervisor without contacting a TCP endpoint. On Windows it uses the ready daemon's shutdown RPC; an unbound instance requires explicit `--force`. `--force` permits forced process-tree cleanup after the graceful timeout (default 15 seconds). `stop --host` only reports **shutdown requested**; remote process exit is not verified. A service manager may start another instance after the captured supervisor exits.

`status` separates local supervisor state, its published endpoint, the configured address, and RPC reachability. A stopped home is never probed at its configured address. An unbound live supervisor is **not ready**. If an authenticated local connection remains open but status details time out, the result stays `reachable` with a note explaining the unavailable details. Worker and provider fields are omitted. An explicit `--host` query still fails when its status request fails.

`reload` validates the file, applies runtime-safe changes, and reports `appliedPaths`, `restartRequiredPaths`, and `overrideControlledPaths`. It never implicitly restarts. Use `--json` or `--format yaml` for structured results. An older host lacking the capability reports that it needs an update.

The root aliases `start`, `status`, `restart`, `reload`, and `pair` use the same commands as `daemon`. Root `run` and `stop` remain agent operations.

### Foreground deployments and migration

Use environment overrides with the foreground deployment command:

```bash
GRAVITY_LISTEN=127.0.0.1:6799 GRAVITY_RELAY_ENABLED=false gravity daemon run --home ~/gravity-test
```

It stays attached until the supervisor exits or you cancel, without a readiness timeout. Worker restart retains these launch inputs. Stop and relaunch the deployment to change them. If the home already has a live supervisor, `run` returns `already_running` without owning or launching a foreground process.

Managed `start` ignores inherited daemon-setting overrides, including `PORT`, `GRAVITY_LISTEN`, relay, voice, and web UI settings. It preserves provider credentials and executable/runtime controls. `start --foreground` is removed; use `daemon run`. Former start/restart configuration flags such as `--port`, `--no-relay`, and `--web-ui` fail before side effects, with the corresponding `config set` migration. See [configuration edits](/docs/configuration#apply-changes).

### Select one daemon

Every daemon-connected CLI command accepts global `--home` or `--host`, before or after the command. A home selects a local supervisor's published endpoint; a host selects an explicit endpoint. There is no configured-address or default-port fallback.

| Selectors                                  | Result                                                 |
| ------------------------------------------ | ------------------------------------------------------ |
| `--home`                                   | That local home, overriding both environment selectors |
| `--host`                                   | That endpoint, overriding both environment selectors   |
| Both flags, or conflicting duplicate flags | `TARGET_AMBIGUOUS`                                     |
| Only `GRAVITY_HOME` or only `GRAVITY_HOST` | The corresponding target                               |
| Both environment selectors, without a flag | `TARGET_AMBIGUOUS`                                     |
| Neither                                    | Default local home, `~/.gravity`                       |

Local-only `start`, `daemon run`, `config`, `onboard`, and `set-password` reject explicit `--host` and ignore `GRAVITY_HOST`. Endpoint operations retain TCP, Unix socket, Windows pipe, SSH, and pairing-offer transports. A host-side CLI controlling a container needs `--host` or `GRAVITY_HOST`.

## Hub

```bash
gravity hub login [url]          # Approve and store organization-scoped CLI access
gravity hub init                 # Create and optionally deploy a starter trigger here
gravity hub connect [url]        # Enroll this daemon using CLI access
gravity hub projects             # List legacy projects in the authenticated organization
gravity hub status               # Show the current Hub relationship
gravity hub disconnect           # End it
gravity hub deploy               # Validate and install .gravity/triggers/*.yml
gravity hub deploy --dry-run     # Validate without installing
gravity hub deploy -p <project>   # Deploy an existing legacy project bundle
gravity hub logout               # Remove the active stored CLI login
```

Run deploy from the repository root. By default it reads every direct `.gravity/triggers/*.yml` file in deterministic path order. It validates all triggers before installing them one at a time. If an installation fails after earlier ones succeeded, the error lists the installed files. `--dry-run` only validates; it does not create or activate revisions.

Pass `-p, --project <slug>` for an existing legacy bundle: `.gravity/hub.yml`, direct `.gravity/workflows/*.yml` files, and referenced workflow partials. See [Deploy from the CLI](/docs/hub/configuration#deploy-from-the-cli).

`login` opens the Hub approval page and stores a durable organization-scoped CLI credential under `GRAVITY_HOME`. In an interactive terminal it offers to connect this daemon, then separately asks whether to allow Hub automations to run agents. Connection defaults to yes; execution permission defaults to no. It then links to Hub's **Triggers** page and prints `gravity hub init` for setup as code. `--json` and non-TTY login remain login-only and never prompt. The stored login is separate from the daemon relationship created by `connect`.

`init` requires a TTY. It signs in and connects the daemon as needed, then lists the organization's app connections that can back a starter trigger. One usable connection is selected automatically; with several, you choose a **Trigger connection**. If none is ready, setup sends you to **Hub → Apps** and stops before selecting an agent or writing files.

Setup asks which agent provider, model, and mode to run. Providers must be enabled and expose both a selectable model and an execution mode. Suggested model and mode entries are the daemon's defaults; a mode is still selected explicitly when there is no default. Setup then asks for the identity allowed to trigger the bot: a GitHub username, Slack member ID, or Discord user ID. It validates the trigger, writes `.gravity/triggers/<provider>-help.yml`, and asks whether to deploy. Replacing that file requires confirmation; existing legacy bundles and other trigger files are preserved. See the [generated starter trigger](/docs/hub/configuration#generated-starter-trigger).

Interactive logout checks the same-origin daemon relationship and asks whether to disconnect before deleting the login. Declining removes only the login. JSON and noninteractive logout never prompt or disconnect implicitly; `--disconnect-daemon` is the explicit automation path, and `--force` applies to that daemon disconnection. If a requested disconnection fails, the login is preserved.

Every command resolves and normalizes its destination before Hub or daemon work. Origin precedence is an explicit command origin or `--hub`, then `GRAVITY_HUB_URL`, then the active stored login origin, then the hosted default `https://hub.gravity.example`. The hosted default never overrides an active login. Credential precedence is `--api-key <secret>`, then `GRAVITY_HUB_API_KEY`, then a stored login for the exact resolved origin. A stored credential is never sent to a different origin. API keys passed through flags or the environment are not stored.

Human output reports the resolved destination before each action. JSON output keeps stdout machine-readable and includes the normalized Hub origin. Bundle diagnostics identify paths without printing configuration contents or credentials.

See [Daemons in Hub](/docs/hub/daemons), [Hub configuration](/docs/hub/configuration), and the [Hub public API](/docs/hub/api).

## Connecting to a remote daemon

The global `--host` option accepts either a local target (`host:port`, a unix socket, or a Windows pipe) or a pairing offer URL, the same `https://app.gravity.example/#offer=...` link the mobile app uses for QR pairing. With an offer URL the CLI connects through the Gravity relay with end-to-end encryption, so you can drive a daemon on another machine without exposing it to the network.

Get an offer URL from the daemon you want to control:

```bash
gravity daemon pair          # prints the QR and link when relay is enabled
gravity daemon pair --relay  # enables relay without prompting
gravity daemon pair --json   # structured output; never prompts
```

Relay is off for new installations. A disabled relay returns a `RELAY_DISABLED` error; pass `--relay` to provide explicit consent. For a stopped home, pairing is labelled offline; `--relay` saves relay enablement and the offer includes a start instruction. A live but unreachable home never falls back to an offline identity. Relay pairing is end-to-end encrypted. See [Security](/docs/security).

Use it from anywhere:

```bash
gravity --host 'https://app.gravity.example/#offer=eyJ2IjoyLC...' ls
gravity --host "$OFFER_URL" run "fix the failing tests"
```

You can also set it once via `GRAVITY_HOST` instead of passing `--host` on every command. An explicit flag overrides the environment variable.

## Multi-agent workflows

The CLI is designed to be used by agents themselves. You can instruct an agent to spawn sub-agents for parallel work:

```bash
# Agent A spawns Agent B and waits for it
agent_id=$(gravity run --background --quiet --title api-agent "implement the API")
gravity wait "$agent_id"
gravity logs "$agent_id" --tail 5
```

Because Agent A's ID is present in the environment, Agent B is created as its subagent in the same workspace unless `--workspace` is specified.

Simple implement + verify loop:

```bash
# Requires jq
while true; do
  gravity run --provider codex "make the tests pass" >/dev/null

  verdict=$(gravity run --provider claude --output-schema '{"type":"object","properties":{"criteria_met":{"type":"boolean"}},"required":["criteria_met"],"additionalProperties":false}' "ensure tests all pass")
  if echo "$verdict" | jq -e '.criteria_met == true' >/dev/null; then
    echo "criteria met"
    break
  fi
done
```

This pattern enables hierarchical task decomposition, a lead agent can break down work, delegate to specialists, and synthesize results.

## Output formats

Most commands support multiple output formats for scripting:

```bash
gravity ls --json                # JSON output
gravity ls --format yaml         # YAML output
gravity ls -q                    # IDs only (quiet)
```

## Global options

- `--host <target>`, connect to a different daemon (`host:port`, unix socket, or `https://app.gravity.example/#offer=...` for relay). See [Connecting to a remote daemon](#connecting-to-a-remote-daemon).
- `--json`, JSON output
- `-q, --quiet`, minimal output
- `--no-color`, disable colors
