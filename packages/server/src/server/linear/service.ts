import { z } from "zod";
import type pino from "pino";
import {
  LinearCommentSchema,
  LinearIssueChildSchema,
  LinearIssueSchema,
  LinearOrganizationSchema,
  LinearViewerSchema,
  LinearWorkflowStateSchema,
  type LinearIssue,
  type LinearIssueDetail,
  type LinearIssueListFilter,
  type LinearStatus,
  type LinearTeam,
} from "@gravity/protocol/linear/types";
import { LinearError, LinearGraphqlClient, type LinearFetch } from "./client.js";
import { LinearConnectionStore, type StoredLinearConnection } from "./store.js";

export interface LinearServiceOptions {
  gravityHome: string;
  logger: pino.Logger;
  fetchImpl?: LinearFetch;
}

export interface ListLinearIssuesInput {
  filter: LinearIssueListFilter;
  teamId?: string;
  search?: string;
  limit?: number;
  after?: string;
}

export interface ListLinearIssuesResult {
  issues: LinearIssue[];
  hasMore: boolean;
  endCursor: string | null;
}

const DEFAULT_LIST_LIMIT = 100;
/** Linear caps `first` at 250; 50 keeps every page well under its complexity budget. */
const PAGE_SIZE = 50;
const SEARCH_LIMIT = 50;

const ISSUE_FIELDS = `
  id identifier title description url branchName priority priorityLabel estimate dueDate createdAt updatedAt
  state { id name type color }
  team { id key name }
  project { id name }
  assignee { id name displayName avatarUrl }
  labels(first: 50) { nodes { id name color } }
`;

const CHILD_FIELDS = `
  id identifier title priority
  state { id name type color }
  assignee { id name displayName avatarUrl }
`;

const VIEWER_QUERY = `query GravityLinearViewer {
  viewer { id name displayName email avatarUrl organization { id name urlKey } }
}`;

const TEAMS_QUERY = `query GravityLinearTeams {
  teams(first: 100) { nodes { id key name } }
  workflowStates(first: 250) { nodes { id name type color position team { id } } }
}`;

const ISSUES_QUERY = `query GravityLinearIssues($first: Int, $after: String, $filter: IssueFilter) {
  issues(first: $first, after: $after, filter: $filter, orderBy: updatedAt) {
    pageInfo { hasNextPage endCursor }
    nodes { ${ISSUE_FIELDS} }
  }
}`;

const ASSIGNED_ISSUES_QUERY = `query GravityLinearAssignedIssues($first: Int, $after: String, $filter: IssueFilter) {
  viewer {
    assignedIssues(first: $first, after: $after, filter: $filter, orderBy: updatedAt) {
      pageInfo { hasNextPage endCursor }
      nodes { ${ISSUE_FIELDS} }
    }
  }
}`;

const CREATED_ISSUES_QUERY = `query GravityLinearCreatedIssues($first: Int, $after: String, $filter: IssueFilter) {
  viewer {
    createdIssues(first: $first, after: $after, filter: $filter, orderBy: updatedAt) {
      pageInfo { hasNextPage endCursor }
      nodes { ${ISSUE_FIELDS} }
    }
  }
}`;

const SEARCH_ISSUES_QUERY = `query GravityLinearSearchIssues($term: String!, $first: Int, $after: String, $filter: IssueFilter) {
  searchIssues(term: $term, first: $first, after: $after, filter: $filter) {
    pageInfo { hasNextPage endCursor }
    nodes { ${ISSUE_FIELDS} }
  }
}`;

const ISSUE_QUERY = `query GravityLinearIssue($id: String!) {
  issue(id: $id) {
    ${ISSUE_FIELDS}
    children(first: 25) { nodes { ${CHILD_FIELDS} } }
    comments(first: 50) { nodes { id body createdAt user { id name displayName avatarUrl } } }
  }
}`;

const SET_STATE_MUTATION = `mutation GravityLinearSetState($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) {
    success
    issue { ${ISSUE_FIELDS} }
  }
}`;

const RawIssueSchema = LinearIssueSchema.omit({ labels: true }).extend({
  labels: z.object({ nodes: z.array(LinearIssueSchema.shape.labels.element) }),
});

const PageInfoSchema = z.object({
  hasNextPage: z.boolean(),
  endCursor: z.string().nullable(),
});

const IssueConnectionSchema = z.object({
  pageInfo: PageInfoSchema,
  nodes: z.array(RawIssueSchema),
});

const ViewerResultSchema = z.object({
  viewer: LinearViewerSchema.extend({ organization: LinearOrganizationSchema }),
});

const TeamsResultSchema = z.object({
  teams: z.object({
    nodes: z.array(z.object({ id: z.string(), key: z.string(), name: z.string() })),
  }),
  workflowStates: z.object({
    nodes: z.array(LinearWorkflowStateSchema.extend({ team: z.object({ id: z.string() }) })),
  }),
});

const IssuesResultSchema = z.object({ issues: IssueConnectionSchema });
const AssignedIssuesResultSchema = z.object({
  viewer: z.object({ assignedIssues: IssueConnectionSchema }),
});
const CreatedIssuesResultSchema = z.object({
  viewer: z.object({ createdIssues: IssueConnectionSchema }),
});
const SearchIssuesResultSchema = z.object({
  searchIssues: IssueConnectionSchema,
});
const IssueResultSchema = z.object({
  issue: RawIssueSchema.extend({
    children: z.object({ nodes: z.array(LinearIssueChildSchema) }),
    comments: z.object({ nodes: z.array(LinearCommentSchema) }),
  }),
});
const SetStateResultSchema = z.object({
  issueUpdate: z.object({ success: z.boolean(), issue: RawIssueSchema }),
});

type RawIssue = z.infer<typeof RawIssueSchema>;
type IssueConnection = z.infer<typeof IssueConnectionSchema>;

function toIssue(raw: RawIssue): LinearIssue {
  const { labels, ...rest } = raw;
  return { ...rest, labels: labels.nodes };
}

const OPEN_STATE_FILTER = { state: { type: { nin: ["completed", "canceled"] } } };
const CLOSED_STATE_FILTER = { state: { type: { in: ["completed", "canceled"] } } };

function buildIssueFilter(input: ListLinearIssuesInput): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (input.teamId) {
    filter.team = { id: { eq: input.teamId } };
  }
  if (input.filter === "completed") {
    Object.assign(filter, CLOSED_STATE_FILTER);
  } else if (input.filter !== "all") {
    Object.assign(filter, OPEN_STATE_FILTER);
  }
  return filter;
}

/**
 * Linear access for one daemon: a single API key, the identity it resolved to,
 * and the issue reads the app renders. Everything is fetched live; the app owns
 * caching through React Query.
 */
export class LinearService {
  private readonly store: LinearConnectionStore;
  private readonly logger: pino.Logger;
  private readonly fetchImpl: LinearFetch;
  private connection: StoredLinearConnection | null | undefined;

  constructor(options: LinearServiceOptions) {
    this.store = new LinearConnectionStore(options.gravityHome);
    this.logger = options.logger.child({ component: "linear" });
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getStatus(): Promise<LinearStatus> {
    const connection = await this.loadConnection();
    if (!connection) return { kind: "disconnected" };
    return { kind: "connected", viewer: connection.viewer, organization: connection.organization };
  }

  async connect(apiKey: string): Promise<LinearStatus> {
    const trimmed = apiKey.trim();
    if (!trimmed) throw new LinearError("request", "API key is required");
    const client = new LinearGraphqlClient(trimmed, this.fetchImpl);
    const { viewer } = await client.query(VIEWER_QUERY, {}, ViewerResultSchema);
    const { organization, ...identity } = viewer;
    const connection: StoredLinearConnection = {
      version: 1,
      apiKey: trimmed,
      viewer: identity,
      organization,
      connectedAt: new Date().toISOString(),
    };
    await this.store.write(connection);
    this.connection = connection;
    this.logger.info({ organization: organization.urlKey }, "Linear connected");
    return { kind: "connected", viewer: identity, organization };
  }

  async disconnect(): Promise<void> {
    await this.store.clear();
    this.connection = null;
    this.logger.info("Linear disconnected");
  }

  async listTeams(): Promise<LinearTeam[]> {
    const client = await this.requireClient();
    const result = await client.query(TEAMS_QUERY, {}, TeamsResultSchema);
    const statesByTeam = new Map<string, LinearTeam["states"]>();
    for (const { team, ...state } of result.workflowStates.nodes) {
      const states = statesByTeam.get(team.id) ?? [];
      states.push(state);
      statesByTeam.set(team.id, states);
    }
    const teams: LinearTeam[] = result.teams.nodes.map((team) => ({
      id: team.id,
      key: team.key,
      name: team.name,
      states: (statesByTeam.get(team.id) ?? []).sort((a, b) => a.position - b.position),
    }));
    return teams.sort((a, b) => a.name.localeCompare(b.name));
  }

  async listIssues(input: ListLinearIssuesInput): Promise<ListLinearIssuesResult> {
    const client = await this.requireClient();
    const filter = buildIssueFilter(input);
    const search = input.search?.trim() ?? "";
    if (search) {
      const result = await client.query(
        SEARCH_ISSUES_QUERY,
        {
          term: search,
          first: Math.min(input.limit ?? SEARCH_LIMIT, SEARCH_LIMIT),
          after: input.after ?? null,
          filter,
        },
        SearchIssuesResultSchema,
      );
      return {
        issues: result.searchIssues.nodes.map(toIssue),
        hasMore: result.searchIssues.pageInfo.hasNextPage,
        endCursor: result.searchIssues.pageInfo.endCursor,
      };
    }

    const limit = input.limit ?? DEFAULT_LIST_LIMIT;
    const issues: LinearIssue[] = [];
    let after: string | null = input.after ?? null;
    let hasMore = false;
    while (issues.length < limit) {
      const first = Math.min(PAGE_SIZE, limit - issues.length);
      const page: IssueConnection = await this.readIssuePage(client, input.filter, {
        first,
        after,
        filter,
      });
      issues.push(...page.nodes.map(toIssue));
      hasMore = page.pageInfo.hasNextPage;
      after = page.pageInfo.endCursor;
      if (!hasMore || !after) break;
    }
    return { issues, hasMore, endCursor: after };
  }

  async getIssue(issueId: string): Promise<LinearIssueDetail> {
    const client = await this.requireClient();
    const { issue } = await client.query(ISSUE_QUERY, { id: issueId }, IssueResultSchema);
    const { children, comments, ...raw } = issue;
    return {
      ...toIssue(raw),
      children: children.nodes,
      comments: [...comments.nodes].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    };
  }

  async setIssueState(issueId: string, stateId: string): Promise<LinearIssue> {
    const client = await this.requireClient();
    const { issueUpdate } = await client.query(
      SET_STATE_MUTATION,
      { id: issueId, stateId },
      SetStateResultSchema,
    );
    if (!issueUpdate.success) {
      throw new LinearError("request", "Linear did not apply the state change");
    }
    return toIssue(issueUpdate.issue);
  }

  private async readIssuePage(
    client: LinearGraphqlClient,
    listFilter: LinearIssueListFilter,
    variables: { first: number; after: string | null; filter: Record<string, unknown> },
  ): Promise<IssueConnection> {
    switch (listFilter) {
      case "assigned":
      case "completed": {
        const result = await client.query(
          ASSIGNED_ISSUES_QUERY,
          variables,
          AssignedIssuesResultSchema,
        );
        return result.viewer.assignedIssues;
      }
      case "created": {
        const result = await client.query(
          CREATED_ISSUES_QUERY,
          variables,
          CreatedIssuesResultSchema,
        );
        return result.viewer.createdIssues;
      }
      case "all": {
        const result = await client.query(ISSUES_QUERY, variables, IssuesResultSchema);
        return result.issues;
      }
    }
  }

  private async requireClient(): Promise<LinearGraphqlClient> {
    const connection = await this.loadConnection();
    if (!connection) {
      throw new LinearError("not_connected", "Linear is not connected on this host");
    }
    return new LinearGraphqlClient(connection.apiKey, this.fetchImpl);
  }

  private async loadConnection(): Promise<StoredLinearConnection | null> {
    if (this.connection === undefined) {
      this.connection = await this.store.read();
    }
    return this.connection;
  }
}
