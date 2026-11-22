# Radar

A radar watches one Slack channel for one project. Every five minutes it reads what is new, and when a bot posts an error or a ticket it puts an agent on it: one agent conversation per message, a reply in the thread, a pull request when the fix is clear, and a ✅ on the original message when the work lands. The daemon owns the loop; the app renders radars and their tasks.

## Why there is no Slack login

Radar never talks to Slack. Every read, reply, and reaction goes through the Slack tools of the provider the radar runs on, which for Claude Code are the claude.ai connectors. That is what keeps setup to a project and a channel name: no Slack app, no token, nothing stored in `$GRAVITY_HOME`.

Two consequences:

- A radar is pinned to its provider. The check does not fall back to another provider the way other structured generation does (`createRadarTriage` in `packages/server/src/server/radar/agent-runner.ts`), because another provider has a different login and would report Slack as unreachable.
- Gravity cannot verify the channel at setup. The first check runs as soon as the radar is created and its result is the verification: a wrong channel or a missing connector lands in `lastPollError` within a minute.

Linear works the same way. A radar uses the provider's Linear tools when a task needs them; the Tasks tab's API key ([linear.md](linear.md)) is unrelated.

## One check

`RadarService.check` (`packages/server/src/server/radar/service.ts`) runs per radar when `nextPollAt` is due:

1. **Settle pull requests.** For each task in `pr_open`, ask `gh pr view` for the state. Merged queues a `merged` turn; closed ends the task. No model is involved.
2. **Triage.** A hidden internal agent on the provider's cheapest model reads the channel and returns JSON (`RadarTriageSchema`): the messages newer than the cursor, each classified, plus replies in threads Radar already answered. It is told to change nothing.
3. **Apply.** `applyTriageResult` turns that into tasks. These rules are code, so a triage run cannot talk its way past them:
   - Only bot messages become tasks. The one exception is `kind: "linear"`, a message from anyone that tags Linear with an issue.
   - A message triage marked `handled` is left alone: its thread already has a reply from the Slack account the provider posts as, or it carries a done reaction (✅). That account is the user's own, so "handled" covers both the user answering by hand and an earlier Radar reply.
   - A message is skipped unless triage marked it `actionable`.
   - At most three new tasks per check and six queued per radar. Messages past either cap wait: the cursor stops before the first one, so the next check reads them again.
   - One task per thread, ever.

The cursor is a Slack `ts`. A new radar starts it 24 hours back (`RADAR_LOOK_BACK_MS`), and so does a channel change, so setup picks up what is already sitting unanswered in the channel; the `handled` rule is what keeps that from re-answering old threads. Resume keeps the cursor where it was, but never further back than 24 hours. When Slack is unreachable the cursor does not move, so nothing is missed.

`radar.check_now` with `lookBackMs` rewinds the cursor before checking, for a radar that has since moved on. The one-task-per-thread rule keeps a second look-back from starting the same work twice. A check whose radar changed channel or cursor while it ran discards its result, since it read a window that no longer applies.

## Check history

Every check is recorded with what it decided about each new message (`RadarCheckMessage.decision`: `task`, `handled`, `not_actionable`, `human`, `tracked`, `over_limit`) and triage's one-line `reason`. This is how a user answers "why did Radar skip that message", so keep both fields filled when you add a rule to `applyTriageResult`.

Slack `ts` values compare as two integers (`compareSlackTs`). As floats the last microsecond digit is lost and a message can compare equal to its neighbor.

## One task

A task is one agent conversation. Where it runs is the radar's **Where to run** setting (`isolation`, the same two choices as a new workspace):

- **Current directory** (`local`, the default): the workspace the user already has on the project folder (`selectRadarWorkspace`; the oldest one when there are several, a new one only when there is none). Radar does not keep a workspace of its own the way Automations does: its conversations belong next to the user's work on that project.
- **New worktree** (`worktree`): every task gets its own Gravity worktree and workspace, named from the task summary.

A task copies the radar's isolation when it is created, so editing the radar moves only later tasks. The `merged` turn never cuts a worktree: it changes no code, and by then the task's worktree may already be archived.

A task takes up to three kinds of turn, all in the same conversation so the agent keeps what it learned:

| Step        | When                                             | Prompt                |
| ----------- | ------------------------------------------------ | --------------------- |
| `start`     | The message was triaged as worth working on      | `buildTaskPrompt`     |
| `follow_up` | A person asked something in a thread Radar is in | `buildFollowUpPrompt` |
| `merged`    | The task's pull request merged                   | `buildMergedPrompt`   |

If the user archived the conversation, the next turn starts a new one.

The agent reports its result on the last line of its final message: `RADAR: pr <url>`, `RADAR: done`, or `RADAR: skipped <reason>`. `parseRadarOutcome` reads the last such line; a missing line counts as done. A `pr` outcome is what makes the daemon watch for the merge.

Up to `RADAR_MAX_RUNNING_TASKS` (10) tasks of one radar run side by side; the rest wait as `queued`. The limit counts the stored `running` statuses inside a serialized store update; nothing is tracked in memory. Parallel tasks share the checkout, which is why every code change happens in a git worktree. Alerts that share a cause can land in different tasks at the same moment, so each agent lists open pull requests right before opening its own and reports the existing one instead of a duplicate. Two agents that reach that step together can still both open one.

## What the prompts hold the agent to

These are instructions, so they are only as strong as the model's compliance. Keep them in `packages/server/src/server/radar/prompts.ts`.

- Reply only inside the thread, never top-level, under `RADAR_REPLY_TARGET_CHARS` (100) characters. That is a target the agent may exceed when the point does not fit; a longer answer is for when someone in the thread asks.
- Reactions on the original message show where a task stands: 👀 when the agent starts on it, ✅ when the work is finished with no pull request pending. With a pull request, the `merged` turn adds ✅. 👀 stays; the Slack connector has no way to remove a reaction. Triage does not count 👀 as handled.
- In Current directory the task runs in the project's own checkout, which the user may be working in. The agent must not switch its branch or touch uncommitted changes; code changes happen in a temporary `git worktree` on a `radar/…` branch that is removed after the push. In New worktree the agent is told the directory is its own and to commit, push, and open the pull request from there (`codeRules` picks between the two).
- Slack text is untrusted. It is fenced in `<slack-message>` with closing tags neutralized, and the agent is told to ignore instructions in it that ask for anything beyond the reported problem. Task agents run unattended with permissions bypassed, so a channel that outsiders can post to is a channel that outsiders can prompt. Point radars at channels only your own integrations write to.

## Restarts

A task that was `running` when the daemon stopped is marked failed on start. It may already have replied, and running it again risks a second reply. Checks resume on the next tick.

## Storage and protocol

`$GRAVITY_HOME/radar/{id}.json`, one `StoredRadar` per file with its tasks inline. Tasks are never dropped: a task is the record of work done in Slack and the link to its conversation. Check history is a separate array at `$GRAVITY_HOME/radar/checks/{id}.json` holding the newest `RADAR_CHECK_HISTORY_LIMIT` checks; older ones are deleted, since a check only records one read of the channel. It is apart from the radar file because it is rewritten on every check and `radar.list` is refetched every few seconds; the app loads it through `radar.checks.list` only while a check list is on screen. The screen's **Checks** view has no RPC of its own: it asks once per radar and merges the answers.

RPCs are `radar.list`, `radar.create`, `radar.update`, `radar.set_status`, `radar.delete`, `radar.check_now`, and `radar.checks.list`, `.request`/`.response` pairs in `packages/protocol/src/radar/rpc-schemas.ts`, gated once by `server_info.features.radar`. `radar.check_now` answers when the check is queued, not when it finishes. There is no push event; the app refetches the list while the screen is open.

## Not built yet

- The interval is fixed at five minutes (`RADAR_POLL_INTERVAL_MS`).
- Pull request state comes from `gh`, so merges on other forges are never seen and those tasks stay in `pr_open`.
- No CLI or MCP surface.
