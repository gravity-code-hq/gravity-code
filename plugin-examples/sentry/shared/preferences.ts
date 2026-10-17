import { defineSettings } from "@gravity/plugin";
import { z } from "zod";
import { SENTRY_ISSUE_FILTERS, SENTRY_ISSUE_PERIODS, SENTRY_ISSUE_SORTS } from "./contracts";

export const SENTRY_START_GOALS = ["pull-request", "fix", "investigate"] as const;
export const SENTRY_START_TARGETS = ["worktree", "checkout"] as const;

export type SentryStartGoal = (typeof SENTRY_START_GOALS)[number];
export type SentryStartTarget = (typeof SENTRY_START_TARGETS)[number];

/** The last start choices, so the next issue from the same Sentry project starts in one tap. */
export const startPreferences = defineSettings({
  id: "start",
  scope: "host",
  version: 1,
  schema: z.object({
    // "provider/model", as the Gravity SDK expects it.
    model: z.string().nullable().default(null),
    goal: z.enum(SENTRY_START_GOALS).default("pull-request"),
    target: z.enum(SENTRY_START_TARGETS).default("worktree"),
    // Sentry project slug → Gravity project ID.
    repositories: z.record(z.string(), z.string()).default({}),
  }),
});

/** What the issues screen shows when it opens. */
export const browsePreferences = defineSettings({
  id: "browse",
  scope: "host",
  version: 1,
  schema: z.object({
    organization: z.string().nullable().default(null),
    projectId: z.string().nullable().default(null),
    filter: z.enum(SENTRY_ISSUE_FILTERS).default("unresolved"),
    sort: z.enum(SENTRY_ISSUE_SORTS).default("date"),
    period: z.enum(SENTRY_ISSUE_PERIODS).default("14d"),
  }),
});
