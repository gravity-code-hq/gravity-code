import { defineRpc } from "@gravity/plugin";
import { z } from "zod";

export const SentryOrganizationSchema = z.object({
  slug: z.string(),
  name: z.string(),
});

export const SentryStatusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("disconnected") }),
  z.object({
    state: z.literal("connected"),
    // "environment" means SENTRY_AUTH_TOKEN on the daemon; it cannot be disconnected from the app.
    source: z.enum(["saved", "environment"]),
    baseUrl: z.string(),
    organizations: z.array(SentryOrganizationSchema),
  }),
]);

export const SentryProjectSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  platform: z.string().nullable(),
});

export const SentryIssueSummarySchema = z.object({
  id: z.string(),
  shortId: z.string(),
  title: z.string(),
  culprit: z.string(),
  permalink: z.string(),
  level: z.string(),
  status: z.string(),
  isUnhandled: z.boolean(),
  count: z.number(),
  userCount: z.number(),
  firstSeen: z.string().nullable(),
  lastSeen: z.string().nullable(),
  project: SentryProjectSchema,
});

export const SentryFrameSchema = z.object({
  filename: z.string().nullable(),
  function: z.string().nullable(),
  module: z.string().nullable(),
  lineNo: z.number().nullable(),
  colNo: z.number().nullable(),
  inApp: z.boolean(),
  context: z.array(z.object({ line: z.number(), code: z.string() })),
});

export const SentryExceptionSchema = z.object({
  type: z.string().nullable(),
  value: z.string().nullable(),
  module: z.string().nullable(),
  handled: z.boolean().nullable(),
  // Oldest call first, crashing frame last, as Sentry orders them.
  frames: z.array(SentryFrameSchema),
  omittedFrames: z.number(),
});

export const SentryBreadcrumbSchema = z.object({
  timestamp: z.string().nullable(),
  category: z.string().nullable(),
  level: z.string().nullable(),
  message: z.string().nullable(),
});

export const SentryEventSchema = z.object({
  id: z.string(),
  dateCreated: z.string().nullable(),
  platform: z.string().nullable(),
  message: z.string().nullable(),
  environment: z.string().nullable(),
  release: z.string().nullable(),
  transaction: z.string().nullable(),
  exceptions: z.array(SentryExceptionSchema),
  breadcrumbs: z.array(SentryBreadcrumbSchema),
  request: z.object({ method: z.string().nullable(), url: z.string() }).nullable(),
  tags: z.array(z.object({ key: z.string(), value: z.string() })),
});

export const SentryIssueDetailSchema = SentryIssueSummarySchema.extend({
  event: SentryEventSchema.nullable(),
});

export const SENTRY_ISSUE_FILTERS = ["unresolved", "assigned", "resolved", "all"] as const;
export const SENTRY_ISSUE_SORTS = ["date", "new", "freq", "user"] as const;
export const SENTRY_ISSUE_PERIODS = ["24h", "7d", "14d", "30d", "90d"] as const;

export const SentryIssueListInputSchema = z.object({
  organization: z.string().min(1),
  projectId: z.string().nullable(),
  filter: z.enum(SENTRY_ISSUE_FILTERS),
  sort: z.enum(SENTRY_ISSUE_SORTS),
  period: z.enum(SENTRY_ISSUE_PERIODS),
  search: z.string(),
  cursor: z.string().nullable(),
});

export const SentryModelOptionSchema = z.object({
  // "provider/model", as the Gravity SDK expects it.
  id: z.string(),
  label: z.string(),
  providerLabel: z.string(),
  isDefault: z.boolean(),
});

export const statusRpc = defineRpc({
  name: "sentry.status",
  input: z.object({}),
  output: SentryStatusSchema,
});

export const connectRpc = defineRpc({
  name: "sentry.connect",
  input: z.object({ token: z.string().min(1), baseUrl: z.string() }),
  output: SentryStatusSchema,
});

export const disconnectRpc = defineRpc({
  name: "sentry.disconnect",
  input: z.object({}),
  output: SentryStatusSchema,
});

export const listProjectsRpc = defineRpc({
  name: "sentry.projects.list",
  input: z.object({ organization: z.string().min(1) }),
  output: z.object({ projects: z.array(SentryProjectSchema) }),
});

export const listIssuesRpc = defineRpc({
  name: "sentry.issues.list",
  input: SentryIssueListInputSchema,
  output: z.object({
    issues: z.array(SentryIssueSummarySchema),
    nextCursor: z.string().nullable(),
  }),
});

export const getIssueRpc = defineRpc({
  name: "sentry.issues.get",
  input: z.object({ organization: z.string().min(1), issueId: z.string().min(1) }),
  output: SentryIssueDetailSchema,
});

export const listModelsRpc = defineRpc({
  name: "sentry.models.list",
  input: z.object({}),
  output: z.object({ models: z.array(SentryModelOptionSchema) }),
});

export type SentryStatus = z.infer<typeof SentryStatusSchema>;
export type SentryOrganization = z.infer<typeof SentryOrganizationSchema>;
export type SentryProject = z.infer<typeof SentryProjectSchema>;
export type SentryIssueSummary = z.infer<typeof SentryIssueSummarySchema>;
export type SentryIssueDetail = z.infer<typeof SentryIssueDetailSchema>;
export type SentryEvent = z.infer<typeof SentryEventSchema>;
export type SentryException = z.infer<typeof SentryExceptionSchema>;
export type SentryBreadcrumb = z.infer<typeof SentryBreadcrumbSchema>;
export type SentryFrame = z.infer<typeof SentryFrameSchema>;
export type SentryModelOption = z.infer<typeof SentryModelOptionSchema>;
export type SentryIssueListInput = z.infer<typeof SentryIssueListInputSchema>;
export type SentryIssueFilter = (typeof SENTRY_ISSUE_FILTERS)[number];
export type SentryIssueSort = (typeof SENTRY_ISSUE_SORTS)[number];
export type SentryIssuePeriod = (typeof SENTRY_ISSUE_PERIODS)[number];
