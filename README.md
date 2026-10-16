<p align="center">
  <img src="packages/app/assets/images/icon.png" width="64" height="64" alt="Gravity logo">
</p>

<h1 align="center">Gravity</h1>

<p align="center">Local-only desktop app + daemon for your AI coding agents. No remote web client. See <a href="GRAVITY.md">GRAVITY.md</a>.</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://github.com/gravity-code-hq/gravity-code/stargazers">
    <img src="https://img.shields.io/github/stars/gravity-code-hq/gravity-code?style=flat&logo=github" alt="GitHub stars">
  </a>
  <a href="https://github.com/gravity-code-hq/gravity-code/releases">
    <img src="https://img.shields.io/github/v/release/gravity-code-hq/gravity-code?style=flat&logo=github" alt="GitHub release">
  </a>
</p>

<p align="center">One interface for Claude Code, Codex, Copilot, OpenCode, and Pi agents.</p>

<p align="center">
  <a href="https://github.com/gravity-code-hq/gravity-code/releases/latest/download/gravity-macos-arm64.dmg">
    <img src="https://img.shields.io/badge/Download_for_Mac-Apple_Silicon-262722?style=for-the-badge&logo=apple" alt="Download Gravity for Mac (Apple Silicon)">
  </a>
</p>

<p align="center">
  <img src=".github/assets/gravity-workspace.png" width="900" alt="Gravity workspace">
</p>

Run agents in parallel on your own machines. Ship from your phone or your desk.

- **Self-hosted:** Agents run on your machine with your full dev environment. Use your tools, your configs, and your skills.
- **Multi-provider:** Claude Code, Codex, Copilot, OpenCode, and Pi through the same interface. Pick the right model for each job.
- **Voice control:** Dictate tasks or talk through problems in voice mode. Hands-free when you need it.
- **Cross-device:** iOS, Android, desktop, web, and CLI. Start work at your desk, check in from your phone, script it from the terminal.
- **Privacy-first:** Gravity doesn't have any telemetry, tracking, or forced log-ins.

## Plugins

Add themes, workspace panels, commands, settings screens, and coding-agent providers with trusted
TypeScript plugins. Install from a local directory or Git repository with `gravity plugin add <source>`.

See the [plugin docs](https://github.com/gravity-code-hq/gravity-code/docs/plugins) for your Gravity version, or start with the
[0.8 beta quickstart](https://github.com/gravity-code-hq/gravity-code/docs/plugins/v0.8). Plugins run with access to your daemon
machine and inside connected clients; install only code you trust.

## Getting Started

Gravity runs a local server called the daemon that manages your coding agents. Clients like the desktop app, mobile app, web app, and CLI connect to it.

### Prerequisites

You need at least one agent CLI installed and configured with your credentials:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)

### Desktop app (recommended)

1. Download [Gravity for Mac (Apple Silicon)](https://github.com/gravity-code-hq/gravity-code/releases/latest/download/gravity-macos-arm64.dmg). Other builds are on the [releases page](https://github.com/gravity-code-hq/gravity-code/releases).
2. Open the downloaded `.dmg` and drag **Gravity** into **Applications**.
3. Open Gravity from Applications. The daemon starts automatically. Nothing else to install.

To connect from your phone, open **Settings → your host → Pair Device**.

### CLI / headless

Install the CLI and start Gravity:

```bash
npm install -g @gravity/cli
gravity
```

Gravity starts locally, then asks whether to enable the end-to-end encrypted relay for device pairing. If you decline, connect directly over TCP, Tailscale, or another VPN. This path is useful for servers and remote machines.

For full setup and configuration, see:

- [Docs](https://github.com/gravity-code-hq/gravity-code/docs)
- [Connectivity guide](https://github.com/gravity-code-hq/gravity-code/docs/connectivity)
- [Configuration reference](https://github.com/gravity-code-hq/gravity-code/docs/configuration)

### Docker

Run the Gravity daemon and self-hosted web UI in Docker:

```bash
docker run -d --name gravity \
  -p 6767:6767 \
  -e GRAVITY_PASSWORD=change-me \
  -v "$PWD/gravity-home:/home/gravity" \
  -v "$PWD:/workspace" \
  ghcr.io/gravity-code-hq/gravity:latest
```

Open `http://localhost:6767` after it starts. Extend the base image with the agent CLIs you use, then provide credentials through environment variables or the persistent `/home/gravity` volume. See the [Docker documentation](docs/docker.md) for full setup details.

## CLI

Everything you can do in the app, you can do from the terminal.

```bash
gravity run --provider claude/opus-4.6 "implement user authentication"
gravity run --provider codex/gpt-5.5 --worktree feature-x "implement feature X"

gravity ls                           # list running agents
gravity attach abc123                # stream live output
gravity send abc123 "also add tests" # follow-up task

# run on a remote daemon; --cwd is a path on that host
gravity run --host workstation.local:6767 --cwd /workspace "run the full test suite"
```

See the [full CLI reference](https://github.com/gravity-code-hq/gravity-code/docs/cli) for more.

## TypeScript SDK

Build issue integrations, dashboards, and orchestration services with `@gravity/client`:

```ts
import { createGravityClient } from "@gravity/client";

const client = createGravityClient({ url: "ws://127.0.0.1:6767/ws" });
await client.connect();

const agent = await client.agents.create({
  config: { provider: "codex/gpt-5.5" },
  cwd: "/Users/me/dev/storefront",
  prompt: "Review the current diff and name the riskiest change.",
});

const result = await agent.waitForFinish();
console.log(result.lastMessage);

await client.close();
```

See the [SDK quickstart](https://github.com/gravity-code-hq/gravity-code/docs/sdk/quickstart), [recipes](https://github.com/gravity-code-hq/gravity-code/docs/sdk/recipes), and [API reference](https://github.com/gravity-code-hq/gravity-code/docs/sdk/reference).

## Skills

Skills teach your agent to use Gravity to orchestrate other agents.

```bash
npx skills add gravity-code-hq/gravity-code
```

Then use them in any agent conversation:

- `/gravity-handoff` — hand off work between agents. I use this to plan with Claude and then handoff to Codex to implement.
- `/gravity-advisor` — spin up a single agent as an advisor for a second opinion, without delegating the work itself.
- `/gravity-committee` — form a committee of two contrasting agents to step back, do root cause analysis, and produce a plan.

## Development

Quick monorepo package map:

- `packages/server`: Gravity daemon (agent process orchestration, WebSocket API, MCP server)
- `packages/app`: Expo client (iOS, Android, web)
- `packages/cli`: `gravity` CLI for daemon and agent workflows
- `packages/desktop`: Electron desktop app
- `packages/relay`: Relay transport and encryption used by the daemon and clients
- `packages/gravity-website`: Marketing site and download page

Common commands:

```bash
# run all local dev services
npm run dev

# run individual surfaces
npm run dev:server
npm run dev:app
npm run dev:desktop
npm run dev:website

# build the server stack
npm run build:server

# repo-wide checks
npm run typecheck
```

## License

Gravity is licensed under the [MIT License](LICENSE).

Gravity includes code from another project licensed under the [Apache License 2.0](LICENSES/Apache-2.0.txt). That code remains under Apache 2.0. See [NOTICE](NOTICE) for attribution. Third-party components keep their own licenses.
