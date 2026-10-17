# Sentry plugin example

This example adds a **Sentry** row to the sidebar. It lists your Sentry issues, shows the latest
event's stack trace, and starts an agent on an issue. The agent gets
the stack trace, breadcrumbs, and request as its first message and fixes the bug, opens a pull
request, or reports the root cause.

## Install

Turn on **Enable plugins** in **Settings → Plugins**, then install the example:

```bash
gravity plugin install /absolute/path/to/gravity/plugin-examples/sentry
gravity plugin ls sentry
```

Open **Sentry** in the sidebar. Until a token is connected, the screen is a setup guide:

1. Choose Sentry.io or self-hosted. On Sentry.io the plugin finds each organization's region
   (US or EU) through `/users/me/regions/`, and only sends the token to hosts under `sentry.io`.
2. Open **User Settings → Personal Tokens** in Sentry and create a token. Organization tokens
   (`sntrys_`) carry only CI permissions and cannot read issues; the guide warns when you paste one.
3. Give it Organization: Read, Project: Read, and Issue & Event: Read.
4. Paste the token. Connect lists organizations, projects, and issues before saving, and names the
   permission that is missing when one of them fails.

**Settings → Plugins → Sentry → Connection** shows the connected organizations and URL, and
replaces or removes the token. The Command Center has **Connect Sentry** to open it. If Sentry later
rejects a saved token, the issues screen offers **Connect a new token**.

The daemon stores the token in `$GRAVITY_HOME/plugin-data/sentry/credentials.json` with mode
`0600`. It never goes to the app, and it is not kept in plugin settings, which every client of
the host can read. Removing the plugin does not delete this file.

You can set `SENTRY_AUTH_TOKEN` (and `SENTRY_URL` for a non-default host) in the daemon
environment instead. A token saved from the app takes precedence; disconnecting it falls back to
the environment token.

## Start an agent

**Start agent** on a row, or in the issue detail, opens a setup dialog:

| Field      | Choices                                                                                |
| ---------- | -------------------------------------------------------------------------------------- |
| Repository | A Gravity project on this host. The choice is remembered per Sentry project.           |
| Model      | Any model from a ready provider.                                                       |
| Goal       | Fix and open a PR, fix without committing, or investigate without changing files.      |
| Run in     | A new worktree on a `sentry-<short-id>-<title>` branch, or the project's own checkout. |
| Prompt     | Editable. Changing the goal swaps the first paragraph and keeps your other edits.      |

The prompt leads with the ask and wraps the Sentry data in a block marked as untrusted input,
since exception messages, breadcrumbs, and tags come from production traffic. Agents get the
`sentry-issue` label with the issue's short ID.

## Layout

- `shared/contracts.ts` defines the RPCs; `shared/prompt.ts` builds the agent prompt and branch name.
- `server/` holds the token store and every Sentry API call. `server/models.ts` lists models on the
  daemon because the app receives provider snapshots in compact form.
- `client/` renders the screen and creates workspaces and agents with `useGravity()`.

Run `gravity plugin reload sentry` after source edits, and
`npx vitest run plugin-examples/sentry/sentry.test.ts` for the tests.
