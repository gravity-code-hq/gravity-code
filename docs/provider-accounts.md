# Provider accounts

The Accounts section of the Claude Code and Codex settings pages (Settings → Host → Claude Code / Codex) automatically saves each usable login detected when you open or refresh accounts. Select Switch to make a saved account active; the other accounts remain saved. The daemon side is `packages/server/src/services/provider-accounts/`; the app side is `packages/app/src/provider-accounts/`. This doc records what the code cannot tell you: where each CLI keeps its login, what a switch must and must not touch, and why the refresh policy differs from the usage fetchers.

## Ownership

The provider CLI owns its active login. Gravity reads it, snapshots it, and replaces it on a switch. It never refreshes it: the CLI redeems its own refresh token on the next request, and a refresh token is single use, so a copy Gravity refreshed would invalidate the CLI's.

A saved login that is not active exists only in `$GRAVITY_HOME/provider-accounts/<providerId>/<accountId>.json`. Gravity holds the only copy of that refresh token, so it may redeem it when usage lookup or activation needs a live access token, as long as it persists the result before anything else can read the old one. `ProviderAccountsService.refreshStoredLogin` is the one place that does this. A rejected refresh sets `reloginRequired` on the record; the account is then never refreshed again and cannot be activated until the user logs in with it in the CLI and Gravity detects the new login.

If the user also runs another switcher such as claude-swap against the same accounts, both tools hold copies of the same refresh tokens and whichever redeems first invalidates the other. There is no fix for that beyond using one tool.

Two logins are the same account when they share an email inside one organization (`isSameAccount`). Detecting an already saved login updates that record; it never creates a second one. You must switch away from an account before removing it, because the active login is saved automatically.

## Claude Code

The login is two things that travel together: the OAuth credential and the `oauthAccount` object in `~/.claude.json`. Claude Code reads the email and organization from the config, not from the token, so activating a credential without its `oauthAccount` shows the wrong account in `/status`.

The credential's plan tier can stay stale after a subscription change. Use the live OAuth profile for the displayed plan when fetching usage; refreshing Accounts bypasses the usage cache and fetches both again. This is a read-only lookup, separate from redeeming a refresh token. Do not write the fetched tier back into the CLI's credential.

Where the credential lives:

| Platform       | Store                                                                         |
| -------------- | ----------------------------------------------------------------------------- |
| macOS          | Keychain generic password, service `Claude Code-credentials`, account `$USER` |
| Linux, Windows | `~/.claude/.credentials.json`                                                 |

With `CLAUDE_CONFIG_DIR` set, the Keychain service name carries a hash of the raw directory string (`claudeKeychainServices`). On macOS the Keychain is read first and a Keychain failure is an error, not a reason to trust the file: Claude Code rotates only the Keychain item, so the file beside it can hold a spent token.

A switch changes exactly one key in `~/.claude.json`, `oauthAccount`, and deletes `primaryApiKey` so an API-key login cannot shadow the OAuth token. Everything else in that file stays. If the file is missing or not valid JSON the switch refuses rather than overwrite it.

Inside the credential, `mcpOAuth`, `mcpOAuthClientConfig`, `mcpXaaIdp`, `mcpXaaIdpConfig`, and `pluginSecrets` belong to the machine, not the account. `mergeSharedCredentialState` takes them from the outgoing live login on every activation so a switch never resurrects a stale MCP login from an older snapshot.

Claude Code blanks both tokens in place when a refresh fails with `invalid_grant`. A live login in that state is reported as not usable and is never written over a saved record.

### Locks

Claude Code guards credential and config writes with `proper-lockfile`-style directory locks. A switch takes the same three, in Claude Code's order, and releases them in reverse:

1. `<configDir>/.oauth_refresh.lock`, stale after 60s
2. `<configDir>.lock`, stale after 60s
3. `~/.claude.json.lock`, stale after 10s

`withClaudeLocks` steals a lock whose mtime is older than its staleness window and touches its own every 3s. Nothing inside the locked section may do network I/O; a refresh needed for activation happens before the locks are taken.

### Running sessions

A running Claude Code process reloads `.credentials.json` when its mtime changes and reads the Keychain through a cache of about 30s. After a Keychain write the adapter rewrites the credentials file with the same bytes when that file already exists, so the switch lands on the next request. It never creates the file: Claude Code prefers the file over the Keychain once it exists.

## Codex

The login is the whole of `~/.codex/auth.json` (`CODEX_HOME` overrides the directory). Identity and plan come from the `id_token` JWT claims; access-token expiry from the access token's own `exp`. Codex takes no locks, so activation is one private atomic file replace. Refresh posts to `https://auth.openai.com/oauth/token` with the Codex CLI's client id.

## Adding a provider

Implement `ProviderAccountAdapter<TLogin>` in `provider-accounts/<provider>/adapter.ts` and register it in `provider-accounts/manifest.ts`. The adapter owns the credential shape, where the CLI keeps it, usage lookup for a stored login, and refresh. The service owns identity matching, the store, the usage cache, snapshot-before-switch, and refresh persistence; do not duplicate those in an adapter. Usage lookup reuses the provider's quota fetcher through a `fetchUsageFor…` method so the two surfaces cannot drift.
