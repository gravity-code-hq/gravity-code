# Linear

The Tasks tab (the `linear` sidebar entry) lists the Linear issues behind a personal API key and starts an agent from one. The daemon owns the key and every Linear call; the app renders.

## Where the key lives

`$GRAVITY_HOME/linear.json`, written with `writePrivateFileAtomicSync` (mode 0600), holding the key and the viewer and organization it resolved to. It is not in `config.json`: every config change is broadcast to all clients as `daemon_config_changed`, and the key must never reach a client. Status responses carry only the viewer and organization.

One key per host. The app pins the tab to one host instead of aggregating across hosts the way Schedules does, because a Linear login is a property of the daemon that holds it. The host is the one the sidebar is pinned to through the footer's Hosts button (`useSidebarViewStore.hostFilters` with exactly one entry), otherwise the active workspace's host, otherwise the first. There is no host control on the tab itself.

## RPCs

`linear.get_status`, `linear.connect`, `linear.disconnect`, `linear.teams.list`, `linear.issues.list`, `linear.issues.get`, `linear.issues.set_state`, all `.request`/`.response` pairs in `packages/protocol/src/linear/rpc-schemas.ts`. Gated once by `server_info.features.linearIntegration`; an older host shows "Update this host to use Linear". Paging additionally requires `linearIssuePagination`; hosts without it keep the first page and show an update prompt when there are more issues.

Failures come back as `rpc_error` with `code` `linear_auth`, `linear_rate_limited`, `linear_network`, `linear_not_connected`, or `linear_request`. The app maps the first four to copy in `packages/app/src/linear/error-copy.ts`; anything else shows the daemon's message.

## Reads

`packages/server/src/server/linear/service.ts` talks to `https://api.linear.app/graphql` with `fetch` and hand-written documents; there is no SDK dependency. Reads that cost an afternoon:

- Nesting `states` under `teams` in one query trips Linear's complexity limit. Teams and `workflowStates` are two top-level fields in one document, joined by team id.
- `filter: "assigned"` and `"completed"` read `viewer.assignedIssues`, `"created"` reads `viewer.createdIssues`, `"all"` reads root `issues`. All order by `updatedAt`. Tasks requests 50 issues per page and keeps the returned cursor for Previous / Next; changing the filter, team, or search starts at page one.
- A non-empty search replaces the list with `searchIssues`, which is relevance-ranked and uses the same cursor pagination.
- Workflow state `type` is a string on the wire. Linear returns values beyond the six documented ones (`duplicate` exists), and an enum there would have broken parsing.

The app caches through React Query under `["linear", serverId, …]`; there is no daemon-side cache or polling. Connect, disconnect, and Refresh invalidate that whole subtree.

## Start agent

The row's Start agent button and the drawer's footer open a setup popup. The full issue prompt is editable there; choose a repository, model, and either a new worktree or an existing workspace before submitting. Existing workspace with nothing picked runs in the repository's own folder on its current branch, with no worktree and no new branch; it reuses that folder's workspace when one exists so repeated starts don't create duplicates. Changing repositories clears the workspace selection. A non-git repository offers a new directory-backed workspace instead of a worktree. Closing setup does not create anything.

The row kebab retains quick start: its "Start agent" submenu lists repositories, and picking one immediately creates a workspace and its first agent. The menu engine ([menus.md](menus.md)) renders that repo page as a hover flyout on web and as a pushed page in the sheet on compact. If the host is offline, no model is available, or there are no projects, quick start falls back to the New workspace composer.

Both paths use `packages/app/src/linear/use-quick-start.ts` and the composer's remembered provider, model, mode, thinking option, and feature values, resolved through `useAgentFormState`. New worktrees are named from the issue identifier and title and branch off the project checkout's current upstream. Existing-workspace starts add an agent to the selected workspace without creating a worktree.

The prompt (`packages/app/src/linear/issue-prompt.ts`) leads with the ask and wraps the issue's own text, sub-issues, and recent comments in a block marked as untrusted source data, since ticket prose is third-party input. The list only has the summary shape, so a row start fetches the detail through the drawer's cache entry first and shows a spinner in the button while it does.

## The list row

Rows sit flat on the screen background with hairline separators, no card. Each row is priority, title, a meta line (identifier · team · updated), the state pill, the Start agent button, and a kebab holding Start agent and Open in Linear. The state pill is read-only in the list; changing status lives in the drawer, where the mutation also patches the row in the list cache.

Orca links a worktree back to its issue and gives the agent a CLI to read and update the ticket. Gravity does neither yet.
