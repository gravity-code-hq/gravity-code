import { z } from "zod";
import { AgentProviderSchema } from "../provider-manifest.js";

/** The provider a radar runs on unless told otherwise: its login carries the Slack and Linear connectors. */
export const RADAR_DEFAULT_PROVIDER = "claude";

/** How often a radar reads its Slack channel. Fixed for now; not a per-radar setting. */
export const RADAR_POLL_INTERVAL_MS = 5 * 60 * 1000;

/**
 * What a reply should stay under. A target, not a cut-off: the agent may go
 * over when the point does not fit, and when someone in the thread asks for more.
 */
export const RADAR_REPLY_TARGET_CHARS = 100;

/**
 * Where a task's agent runs. "local" is the workspace already open on the
 * project folder; "worktree" gives every task its own Gravity worktree and
 * workspace. Missing means "local".
 */
export const RadarIsolationSchema = z.enum(["local", "worktree"]);
export type RadarIsolation = z.infer<typeof RadarIsolationSchema>;

export const RadarStatusSchema = z.enum(["active", "paused"]);
export type RadarStatus = z.infer<typeof RadarStatusSchema>;

export const RadarTaskStatusSchema = z.enum([
  "queued",
  "running",
  "pr_open",
  "done",
  "skipped",
  "failed",
]);
export type RadarTaskStatus = z.infer<typeof RadarTaskStatusSchema>;

/** What the next agent turn for a queued task is for. */
export const RadarTaskStepSchema = z.enum(["start", "follow_up", "merged"]);
export type RadarTaskStep = z.infer<typeof RadarTaskStepSchema>;

export const RadarFollowUpSchema = z.object({
  ts: z.string(),
  author: z.string().nullable(),
  text: z.string(),
});
export type RadarFollowUp = z.infer<typeof RadarFollowUpSchema>;

/** One Slack message a radar decided to act on. One task maps to one agent conversation. */
export const RadarTaskSchema = z.object({
  id: z.string(),
  // "error" | "ticket" | "linear" today. A string so a newer daemon can add
  // kinds without breaking an older app's parse.
  kind: z.string(),
  summary: z.string(),
  author: z.string().nullable(),
  /** Slack ts of the message that started the task. */
  messageTs: z.string(),
  /** Slack ts of the thread root the agent replies under. */
  threadTs: z.string(),
  /** Message text as the triage read it, kept so the agent starts with it. */
  text: z.string(),
  permalink: z.string().nullable(),
  status: RadarTaskStatusSchema,
  step: RadarTaskStepSchema.nullable(),
  followUp: RadarFollowUpSchema.nullable(),
  /** Newest thread reply already handled; later replies are follow-ups. */
  threadCursorTs: z.string().nullable(),
  /** The radar's isolation when the task was created; later edits to the radar do not move it. */
  isolation: RadarIsolationSchema.optional(),
  agentId: z.guid().nullable(),
  workspaceId: z.string().nullable(),
  prUrl: z.string().nullable(),
  /** Set once the pull request merged and the ✅ step was queued. */
  mergedAt: z.string().nullable().optional(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RadarTask = z.infer<typeof RadarTaskSchema>;

/**
 * What a check decided about one new message. `decision` is a string so a
 * newer daemon can add outcomes: "task" (a task was created), "not_actionable"
 * (triage saw nothing to do), "human" (posted by a person and not a Linear
 * hand-off), "tracked" (its thread already has a task), "handled" (already
 * answered by the acting Slack account or marked done with a reaction),
 * "over_limit" (past a task cap; it waits for the next check).
 */
export const RadarCheckMessageSchema = z.object({
  ts: z.string(),
  author: z.string().nullable(),
  isBot: z.boolean(),
  kind: z.string(),
  summary: z.string(),
  permalink: z.string().nullable(),
  decision: z.string(),
  /** Triage's one-line reason for its actionable call. */
  reason: z.string().nullable(),
  taskId: z.string().nullable(),
});
export type RadarCheckMessage = z.infer<typeof RadarCheckMessageSchema>;

/** One pass over the channel. Kept so the user can see why a message was or was not picked up. */
export const RadarCheckSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  /** "ok" | "unreachable" (Slack could not be read) | "failed" (the check itself broke). */
  status: z.string(),
  error: z.string().nullable(),
  /** Messages newer than this Slack ts were considered. */
  sinceTs: z.string(),
  messages: z.array(RadarCheckMessageSchema),
  /** Thread replies routed back to an existing task. */
  followUps: z.number().int().nonnegative(),
  /** Pull requests found merged, each queuing a ✅ turn. */
  merged: z.number().int().nonnegative(),
});
export type RadarCheck = z.infer<typeof RadarCheckSchema>;

/**
 * Checks kept per radar; older ones are deleted. A check is only the record of
 * one read of the channel. The tasks it started live on the radar and are kept.
 */
export const RADAR_CHECK_HISTORY_LIMIT = 30;

/**
 * How far back a radar reads when it is created, when its channel changes, and
 * when the user asks it to look back.
 */
export const RADAR_LOOK_BACK_MS = 24 * 60 * 60 * 1000;

export const StoredRadarSchema = z.object({
  id: z.string(),
  /** Channel as the user named it, without the leading "#". */
  channel: z.string().trim().min(1),
  /** Slack channel id once a check has resolved it. */
  channelId: z.string().nullable(),
  cwd: z.string().trim().min(1),
  provider: AgentProviderSchema,
  model: z.string().trim().min(1).optional(),
  isolation: RadarIsolationSchema.optional(),
  /** Extra guidance from the user, appended to every triage and task prompt. */
  instructions: z.string().optional(),
  status: RadarStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Slack ts watermark: messages at or before it were already triaged. */
  cursorTs: z.string(),
  nextPollAt: z.string().nullable(),
  lastPollAt: z.string().nullable(),
  lastPollError: z.string().nullable(),
  tasks: z.array(RadarTaskSchema),
});
export type StoredRadar = z.infer<typeof StoredRadarSchema>;

export interface CreateRadarInput {
  channel: string;
  cwd: string;
  provider?: string;
  model?: string | null;
  isolation?: RadarIsolation;
  instructions?: string | null;
}

export interface UpdateRadarInput {
  id: string;
  channel?: string;
  cwd?: string;
  model?: string | null;
  isolation?: RadarIsolation;
  instructions?: string | null;
}

/** Strip "#", whitespace, and a pasted Slack channel URL down to a name or id. */
export function normalizeRadarChannel(input: string): string {
  const trimmed = input.trim();
  const fromUrl = /\/archives\/([A-Z0-9]+)/i.exec(trimmed);
  if (fromUrl) {
    return fromUrl[1];
  }
  return trimmed.replace(/^#+/, "").trim();
}
