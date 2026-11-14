import { z } from "zod";
import { RadarCheckSchema, RadarStatusSchema, StoredRadarSchema } from "./types.js";

export const RadarListRequestSchema = z.object({
  type: z.literal("radar.list.request"),
  requestId: z.string(),
});

export const RadarListResponseSchema = z.object({
  type: z.literal("radar.list.response"),
  payload: z.object({
    requestId: z.string(),
    radars: z.array(StoredRadarSchema),
  }),
});

export const RadarCreateRequestSchema = z.object({
  type: z.literal("radar.create.request"),
  requestId: z.string(),
  channel: z.string().trim().min(1),
  cwd: z.string().trim().min(1),
  /** Defaults to Claude Code, whose claude.ai connectors supply Slack and Linear. */
  provider: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  instructions: z.string().optional(),
});

export const RadarCreateResponseSchema = z.object({
  type: z.literal("radar.create.response"),
  payload: z.object({
    requestId: z.string(),
    radar: StoredRadarSchema,
  }),
});

export const RadarUpdateRequestSchema = z.object({
  type: z.literal("radar.update.request"),
  requestId: z.string(),
  radarId: z.string(),
  channel: z.string().trim().min(1).optional(),
  cwd: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).nullable().optional(),
  instructions: z.string().nullable().optional(),
});

export const RadarUpdateResponseSchema = z.object({
  type: z.literal("radar.update.response"),
  payload: z.object({
    requestId: z.string(),
    radar: StoredRadarSchema,
  }),
});

export const RadarSetStatusRequestSchema = z.object({
  type: z.literal("radar.set_status.request"),
  requestId: z.string(),
  radarId: z.string(),
  status: RadarStatusSchema,
});

export const RadarSetStatusResponseSchema = z.object({
  type: z.literal("radar.set_status.response"),
  payload: z.object({
    requestId: z.string(),
    radar: StoredRadarSchema,
  }),
});

export const RadarDeleteRequestSchema = z.object({
  type: z.literal("radar.delete.request"),
  requestId: z.string(),
  radarId: z.string(),
});

export const RadarDeleteResponseSchema = z.object({
  type: z.literal("radar.delete.response"),
  payload: z.object({
    requestId: z.string(),
    radarId: z.string(),
  }),
});

/**
 * Asks for a check now. The response returns as soon as the check is queued;
 * the check itself takes as long as the provider needs to read Slack, so the
 * app refetches the list to see its result.
 */
export const RadarCheckNowRequestSchema = z.object({
  type: z.literal("radar.check_now.request"),
  requestId: z.string(),
  radarId: z.string(),
  /**
   * Rewind the cursor this far before checking, so messages posted before the
   * radar existed (or while it was paused) are considered. Messages that
   * already have a task are not picked up twice.
   */
  lookBackMs: z
    .number()
    .int()
    .positive()
    .max(7 * 24 * 60 * 60 * 1000)
    .optional(),
});

export const RadarCheckNowResponseSchema = z.object({
  type: z.literal("radar.check_now.response"),
  payload: z.object({
    requestId: z.string(),
    radar: StoredRadarSchema,
  }),
});

/** A radar's check history, newest first. Loaded on demand; `radar.list` does not carry it. */
export const RadarChecksListRequestSchema = z.object({
  type: z.literal("radar.checks.list.request"),
  requestId: z.string(),
  radarId: z.string(),
  limit: z.number().int().positive().max(2000).optional(),
});

export const RadarChecksListResponseSchema = z.object({
  type: z.literal("radar.checks.list.response"),
  payload: z.object({
    requestId: z.string(),
    radarId: z.string(),
    checks: z.array(RadarCheckSchema),
  }),
});
