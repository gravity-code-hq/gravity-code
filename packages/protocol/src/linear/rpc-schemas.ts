import { z } from "zod";
import {
  LinearIssueDetailSchema,
  LinearIssueListFilterSchema,
  LinearIssueSchema,
  LinearStatusSchema,
  LinearTeamSchema,
} from "./types.js";

export const LinearGetStatusRequestSchema = z.object({
  type: z.literal("linear.get_status.request"),
  requestId: z.string(),
});

export const LinearGetStatusResponseSchema = z.object({
  type: z.literal("linear.get_status.response"),
  payload: z.object({
    requestId: z.string(),
    status: LinearStatusSchema,
  }),
});

export const LinearConnectRequestSchema = z.object({
  type: z.literal("linear.connect.request"),
  requestId: z.string(),
  apiKey: z.string().min(1),
});

export const LinearConnectResponseSchema = z.object({
  type: z.literal("linear.connect.response"),
  payload: z.object({
    requestId: z.string(),
    status: LinearStatusSchema,
  }),
});

export const LinearDisconnectRequestSchema = z.object({
  type: z.literal("linear.disconnect.request"),
  requestId: z.string(),
});

export const LinearDisconnectResponseSchema = z.object({
  type: z.literal("linear.disconnect.response"),
  payload: z.object({
    requestId: z.string(),
  }),
});

export const LinearTeamsListRequestSchema = z.object({
  type: z.literal("linear.teams.list.request"),
  requestId: z.string(),
});

export const LinearTeamsListResponseSchema = z.object({
  type: z.literal("linear.teams.list.response"),
  payload: z.object({
    requestId: z.string(),
    teams: z.array(LinearTeamSchema),
  }),
});

export const LinearIssuesListRequestSchema = z.object({
  type: z.literal("linear.issues.list.request"),
  requestId: z.string(),
  filter: LinearIssueListFilterSchema,
  teamId: z.string().optional(),
  /** Non-empty search replaces the list with Linear's relevance-ranked search. */
  search: z.string().optional(),
  limit: z.number().int().positive().max(250).optional(),
  after: z.string().optional(),
});

export const LinearIssuesListResponseSchema = z.object({
  type: z.literal("linear.issues.list.response"),
  payload: z.object({
    requestId: z.string(),
    issues: z.array(LinearIssueSchema),
    hasMore: z.boolean(),
    endCursor: z.string().nullable().optional(),
  }),
});

export const LinearIssuesGetRequestSchema = z.object({
  type: z.literal("linear.issues.get.request"),
  requestId: z.string(),
  /** A Linear issue UUID or identifier such as `ENG-123`. */
  issueId: z.string(),
});

export const LinearIssuesGetResponseSchema = z.object({
  type: z.literal("linear.issues.get.response"),
  payload: z.object({
    requestId: z.string(),
    issue: LinearIssueDetailSchema,
  }),
});

export const LinearIssuesSetStateRequestSchema = z.object({
  type: z.literal("linear.issues.set_state.request"),
  requestId: z.string(),
  issueId: z.string(),
  stateId: z.string(),
});

export const LinearIssuesSetStateResponseSchema = z.object({
  type: z.literal("linear.issues.set_state.response"),
  payload: z.object({
    requestId: z.string(),
    issue: LinearIssueSchema,
  }),
});
