import { z } from "zod";

export const LinearViewerSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
export type LinearViewer = z.infer<typeof LinearViewerSchema>;

export const LinearOrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  urlKey: z.string(),
});
export type LinearOrganization = z.infer<typeof LinearOrganizationSchema>;

// A string tag, not a boolean: the generated inbound validator (docs/protocol-validation.md)
// compares discriminators as strings and rejects `z.literal(true)` branches.
export const LinearStatusSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("disconnected") }),
  z.object({
    kind: z.literal("connected"),
    viewer: LinearViewerSchema,
    organization: LinearOrganizationSchema,
  }),
]);
export type LinearStatus = z.infer<typeof LinearStatusSchema>;

/**
 * Linear's workflow state categories. Kept as a string on the wire so a new
 * category on Linear's side never breaks parsing; consumers map known values.
 */
export const LINEAR_WORKFLOW_STATE_TYPES = [
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
] as const;
export type LinearWorkflowStateType = (typeof LINEAR_WORKFLOW_STATE_TYPES)[number];

export const LinearWorkflowStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  color: z.string(),
  position: z.number(),
});
export type LinearWorkflowState = z.infer<typeof LinearWorkflowStateSchema>;

export const LinearTeamSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  states: z.array(LinearWorkflowStateSchema),
});
export type LinearTeam = z.infer<typeof LinearTeamSchema>;

export const LinearUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});
export type LinearUser = z.infer<typeof LinearUserSchema>;

export const LinearLabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
});
export type LinearLabel = z.infer<typeof LinearLabelSchema>;

const LinearIssueStateSchema = LinearWorkflowStateSchema.omit({ position: true });

const LinearIssueTeamSchema = LinearTeamSchema.omit({ states: true });

export const LinearIssueSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  url: z.string(),
  branchName: z.string(),
  /** 0 = none, 1 = urgent, 2 = high, 3 = medium, 4 = low. */
  priority: z.number().int(),
  priorityLabel: z.string(),
  estimate: z.number().nullable(),
  dueDate: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  state: LinearIssueStateSchema,
  team: LinearIssueTeamSchema,
  project: z.object({ id: z.string(), name: z.string() }).nullable(),
  assignee: LinearUserSchema.nullable(),
  labels: z.array(LinearLabelSchema),
});
export type LinearIssue = z.infer<typeof LinearIssueSchema>;

export const LinearIssueChildSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  priority: z.number().int(),
  state: LinearIssueStateSchema,
  assignee: LinearUserSchema.nullable(),
});
export type LinearIssueChild = z.infer<typeof LinearIssueChildSchema>;

export const LinearCommentSchema = z.object({
  id: z.string(),
  body: z.string(),
  createdAt: z.string(),
  user: LinearUserSchema.nullable(),
});
export type LinearComment = z.infer<typeof LinearCommentSchema>;

export const LinearIssueDetailSchema = LinearIssueSchema.extend({
  children: z.array(LinearIssueChildSchema),
  comments: z.array(LinearCommentSchema),
});
export type LinearIssueDetail = z.infer<typeof LinearIssueDetailSchema>;

/**
 * `assigned`, `created`, and `all` list open work; `completed` lists the viewer's
 * finished and canceled issues.
 */
export const LinearIssueListFilterSchema = z.enum(["assigned", "created", "all", "completed"]);
export type LinearIssueListFilter = z.infer<typeof LinearIssueListFilterSchema>;
