import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LinearError, type LinearFetch } from "./client.js";
import { LinearService } from "./service.js";
import { LINEAR_CONNECTION_FILENAME } from "./store.js";

interface RecordedRequest {
  authorization: string | null;
  operation: string;
  variables: Record<string, unknown>;
}

interface GraphqlReply {
  status?: number;
  body: unknown;
}

/**
 * An in-memory Linear: replies are keyed by GraphQL operation name so a test
 * states exactly what the API returns, and every request is recorded so the
 * test can assert what the daemon asked for.
 */
function createFakeLinear(replies: Record<string, GraphqlReply | GraphqlReply[]>) {
  const requests: RecordedRequest[] = [];
  const queues = new Map<string, GraphqlReply[]>();
  for (const [operation, reply] of Object.entries(replies)) {
    queues.set(operation, Array.isArray(reply) ? [...reply] : [reply]);
  }
  const fetchImpl: LinearFetch = async (_url, init) => {
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body)) as {
      query: string;
      variables: Record<string, unknown>;
    };
    const operation = /^(?:query|mutation)\s+(\w+)/.exec(body.query)?.[1] ?? "unknown";
    requests.push({
      authorization: headers.get("authorization"),
      operation,
      variables: body.variables,
    });
    const queue = queues.get(operation);
    const reply = queue?.length === 1 ? queue[0] : queue?.shift();
    if (!reply) {
      throw new Error(`No reply configured for ${operation}`);
    }
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetchImpl, requests };
}

const viewerReply: GraphqlReply = {
  body: {
    data: {
      viewer: {
        id: "user-1",
        name: "Ada",
        displayName: "ada",
        email: "ada@example.com",
        avatarUrl: null,
        organization: { id: "org-1", name: "Example", urlKey: "example" },
      },
    },
  },
};

function rawIssue(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Fix login",
    description: "Steps",
    url: "https://linear.app/example/issue/ENG-1",
    branchName: "ada/eng-1-fix-login",
    priority: 2,
    priorityLabel: "High",
    estimate: null,
    dueDate: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    state: { id: "state-1", name: "In Progress", type: "started", color: "#f2c94c" },
    team: { id: "team-1", key: "ENG", name: "Engineering" },
    project: null,
    assignee: { id: "user-1", name: "Ada", displayName: "ada", avatarUrl: null },
    labels: { nodes: [{ id: "label-1", name: "bug", color: "#ff0000" }] },
    ...overrides,
  };
}

describe("LinearService", () => {
  let gravityHome: string;
  const logger = pino({ level: "silent" });

  beforeEach(async () => {
    gravityHome = await fs.mkdtemp(path.join(os.tmpdir(), "gravity-linear-"));
  });

  afterEach(async () => {
    await fs.rm(gravityHome, { recursive: true, force: true });
  });

  it("reports disconnected until a key is saved, then persists the key privately", async () => {
    const linear = createFakeLinear({ GravityLinearViewer: viewerReply });
    const service = new LinearService({ gravityHome, logger, fetchImpl: linear.fetchImpl });

    expect(await service.getStatus()).toEqual({ kind: "disconnected" });

    const status = await service.connect("  lin_api_secret  ");
    expect(status).toEqual({
      kind: "connected",
      viewer: {
        id: "user-1",
        name: "Ada",
        displayName: "ada",
        email: "ada@example.com",
        avatarUrl: null,
      },
      organization: { id: "org-1", name: "Example", urlKey: "example" },
    });
    expect(linear.requests[0]?.authorization).toBe("lin_api_secret");

    const filePath = path.join(gravityHome, LINEAR_CONNECTION_FILENAME);
    const stored = JSON.parse(await fs.readFile(filePath, "utf8")) as { apiKey: string };
    expect(stored.apiKey).toBe("lin_api_secret");
    if (process.platform !== "win32") {
      const mode = (await fs.stat(filePath)).mode & 0o777;
      expect(mode).toBe(0o600);
    }

    const reloaded = new LinearService({ gravityHome, logger, fetchImpl: linear.fetchImpl });
    expect((await reloaded.getStatus()).kind).toBe("connected");

    await reloaded.disconnect();
    expect(await reloaded.getStatus()).toEqual({ kind: "disconnected" });
    await expect(fs.access(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a key Linear does not accept and keeps nothing on disk", async () => {
    const linear = createFakeLinear({
      GravityLinearViewer: {
        status: 401,
        body: { errors: [{ message: "Authentication required" }] },
      },
    });
    const service = new LinearService({ gravityHome, logger, fetchImpl: linear.fetchImpl });

    await expect(service.connect("lin_api_bad")).rejects.toMatchObject({ code: "auth" });
    expect(await service.getStatus()).toEqual({ kind: "disconnected" });
    await expect(
      fs.access(path.join(gravityHome, LINEAR_CONNECTION_FILENAME)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses issue reads while disconnected", async () => {
    const linear = createFakeLinear({});
    const service = new LinearService({ gravityHome, logger, fetchImpl: linear.fetchImpl });

    await expect(service.listIssues({ filter: "assigned" })).rejects.toBeInstanceOf(LinearError);
    await expect(service.listIssues({ filter: "assigned" })).rejects.toMatchObject({
      code: "not_connected",
    });
    expect(linear.requests).toEqual([]);
  });

  it("walks assigned issues page by page with the open-state filter and flattens labels", async () => {
    const linear = createFakeLinear({
      GravityLinearViewer: viewerReply,
      GravityLinearAssignedIssues: [
        {
          body: {
            data: {
              viewer: {
                assignedIssues: {
                  pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
                  nodes: [rawIssue()],
                },
              },
            },
          },
        },
        {
          body: {
            data: {
              viewer: {
                assignedIssues: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [rawIssue({ id: "issue-2", identifier: "ENG-2", labels: { nodes: [] } })],
                },
              },
            },
          },
        },
      ],
    });
    const service = new LinearService({ gravityHome, logger, fetchImpl: linear.fetchImpl });
    await service.connect("lin_api_secret");

    const result = await service.listIssues({ filter: "assigned", teamId: "team-1" });

    expect(result.hasMore).toBe(false);
    expect(result.issues.map((issue) => issue.identifier)).toEqual(["ENG-1", "ENG-2"]);
    expect(result.issues[0]?.labels).toEqual([{ id: "label-1", name: "bug", color: "#ff0000" }]);
    const pages = linear.requests.filter((r) => r.operation === "GravityLinearAssignedIssues");
    expect(pages.map((page) => page.variables)).toEqual([
      {
        first: 50,
        after: null,
        filter: {
          team: { id: { eq: "team-1" } },
          state: { type: { nin: ["completed", "canceled"] } },
        },
      },
      {
        first: 50,
        after: "cursor-1",
        filter: {
          team: { id: { eq: "team-1" } },
          state: { type: { nin: ["completed", "canceled"] } },
        },
      },
    ]);
  });

  it("stops at the requested limit and reports that more issues exist", async () => {
    const linear = createFakeLinear({
      GravityLinearViewer: viewerReply,
      GravityLinearIssues: {
        body: {
          data: {
            issues: {
              pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
              nodes: [rawIssue(), rawIssue({ id: "issue-2", identifier: "ENG-2" })],
            },
          },
        },
      },
    });
    const service = new LinearService({ gravityHome, logger, fetchImpl: linear.fetchImpl });
    await service.connect("lin_api_secret");

    const result = await service.listIssues({ filter: "all", limit: 2 });

    expect(result.hasMore).toBe(true);
    expect(result.endCursor).toBe("cursor-1");
    expect(result.issues).toHaveLength(2);
    expect(linear.requests.filter((r) => r.operation === "GravityLinearIssues")).toHaveLength(1);
    expect(linear.requests.at(-1)?.variables).toEqual({ first: 2, after: null, filter: {} });
  });

  it.each([
    ["all", "GravityLinearIssues", {}],
    [
      "assigned",
      "GravityLinearAssignedIssues",
      { state: { type: { nin: ["completed", "canceled"] } } },
    ],
    [
      "created",
      "GravityLinearCreatedIssues",
      { state: { type: { nin: ["completed", "canceled"] } } },
    ],
    [
      "completed",
      "GravityLinearAssignedIssues",
      { state: { type: { in: ["completed", "canceled"] } } },
    ],
  ] as const)(
    "resumes %s issues at the supplied cursor",
    async (filter, operation, stateFilter) => {
      const connection = {
        nodes: [rawIssue({ id: "issue-51", identifier: "ENG-51" })],
        pageInfo: { hasNextPage: false, endCursor: "last-cursor" },
      };
      const data = {
        issues: connection,
        viewer: { assignedIssues: connection, createdIssues: connection },
      };
      const linear = createFakeLinear({
        GravityLinearViewer: viewerReply,
        [operation]: { body: { data } },
      });
      const service = new LinearService({ gravityHome, logger, fetchImpl: linear.fetchImpl });
      await service.connect("lin_api_secret");

      const result = await service.listIssues({
        filter,
        teamId: "team-1",
        after: "first-cursor",
        limit: 50,
      });

      expect(result).toEqual({
        issues: [expect.objectContaining({ identifier: "ENG-51" })],
        hasMore: false,
        endCursor: "last-cursor",
      });
      expect(linear.requests.at(-1)).toMatchObject({
        operation,
        variables: {
          first: 50,
          after: "first-cursor",
          filter: { team: { id: { eq: "team-1" } }, ...stateFilter },
        },
      });
      expect(linear.requests).toHaveLength(2);
    },
  );

  it("lets a failed page be retried at the same cursor", async () => {
    const linear = createFakeLinear({
      GravityLinearViewer: viewerReply,
      GravityLinearIssues: [
        { status: 429, body: { errors: [{ message: "Rate limited" }] } },
        {
          body: {
            data: {
              issues: {
                nodes: [rawIssue()],
                pageInfo: { hasNextPage: false, endCursor: "last" },
              },
            },
          },
        },
      ],
    });
    const service = new LinearService({ gravityHome, logger, fetchImpl: linear.fetchImpl });
    await service.connect("lin_api_secret");
    const input = { filter: "all", after: "cursor-50", limit: 50 } as const;

    await expect(service.listIssues(input)).rejects.toMatchObject({ code: "rate_limited" });
    expect(await service.listIssues(input)).toMatchObject({ hasMore: false, endCursor: "last" });
    expect(linear.requests.slice(1).map((request) => request.variables.after)).toEqual([
      "cursor-50",
      "cursor-50",
    ]);
  });

  it("pages search results with the same term and filters", async () => {
    const linear = createFakeLinear({
      GravityLinearViewer: viewerReply,
      GravityLinearSearchIssues: {
        body: {
          data: {
            searchIssues: {
              nodes: [rawIssue()],
              pageInfo: { hasNextPage: true, endCursor: "search-next" },
            },
          },
        },
      },
    });
    const service = new LinearService({ gravityHome, logger, fetchImpl: linear.fetchImpl });
    await service.connect("lin_api_secret");

    const result = await service.listIssues({
      filter: "completed",
      search: " login ",
      teamId: "team-1",
      after: "search-first",
      limit: 50,
    });

    expect(result).toEqual({
      issues: [expect.objectContaining({ identifier: "ENG-1" })],
      hasMore: true,
      endCursor: "search-next",
    });
    expect(linear.requests.at(-1)?.variables).toEqual({
      term: "login",
      first: 50,
      after: "search-first",
      filter: {
        team: { id: { eq: "team-1" } },
        state: { type: { in: ["completed", "canceled"] } },
      },
    });
  });

  it("returns issue detail with comments oldest first", async () => {
    const linear = createFakeLinear({
      GravityLinearViewer: viewerReply,
      GravityLinearIssue: {
        body: {
          data: {
            issue: {
              ...rawIssue(),
              children: {
                nodes: [
                  {
                    id: "child-1",
                    identifier: "ENG-3",
                    title: "Sub task",
                    priority: 0,
                    state: { id: "state-2", name: "Todo", type: "unstarted", color: "#ccc" },
                    assignee: null,
                  },
                ],
              },
              comments: {
                nodes: [
                  { id: "c-2", body: "later", createdAt: "2026-09-02T00:00:00.000Z", user: null },
                  {
                    id: "c-1",
                    body: "first",
                    createdAt: "2026-09-01T00:00:00.000Z",
                    user: { id: "user-1", name: "Ada", displayName: "ada", avatarUrl: null },
                  },
                ],
              },
            },
          },
        },
      },
    });
    const service = new LinearService({ gravityHome, logger, fetchImpl: linear.fetchImpl });
    await service.connect("lin_api_secret");

    const issue = await service.getIssue("ENG-1");

    expect(issue.comments.map((comment) => comment.id)).toEqual(["c-1", "c-2"]);
    expect(issue.children).toHaveLength(1);
    expect(issue.labels).toEqual([{ id: "label-1", name: "bug", color: "#ff0000" }]);
    expect(linear.requests.at(-1)?.variables).toEqual({ id: "ENG-1" });
  });

  it("groups workflow states under their team in position order", async () => {
    const linear = createFakeLinear({
      GravityLinearViewer: viewerReply,
      GravityLinearTeams: {
        body: {
          data: {
            teams: {
              nodes: [
                { id: "team-2", key: "OPS", name: "Ops" },
                { id: "team-1", key: "ENG", name: "Engineering" },
              ],
            },
            workflowStates: {
              nodes: [
                {
                  id: "s-2",
                  name: "Done",
                  type: "completed",
                  color: "#0f0",
                  position: 3,
                  team: { id: "team-1" },
                },
                {
                  id: "s-1",
                  name: "Todo",
                  type: "unstarted",
                  color: "#ccc",
                  position: 1,
                  team: { id: "team-1" },
                },
                {
                  id: "s-3",
                  name: "Todo",
                  type: "unstarted",
                  color: "#ccc",
                  position: 1,
                  team: { id: "team-2" },
                },
              ],
            },
          },
        },
      },
    });
    const service = new LinearService({ gravityHome, logger, fetchImpl: linear.fetchImpl });
    await service.connect("lin_api_secret");

    const teams = await service.listTeams();

    expect(teams.map((team) => team.key)).toEqual(["ENG", "OPS"]);
    expect(teams[0]?.states.map((state) => state.id)).toEqual(["s-1", "s-2"]);
    expect(teams[1]?.states.map((state) => state.id)).toEqual(["s-3"]);
  });

  it("surfaces a revoked key as an auth error on later reads", async () => {
    const linear = createFakeLinear({
      GravityLinearViewer: viewerReply,
      GravityLinearIssues: {
        body: {
          errors: [
            {
              message: "Authentication required, not authenticated",
              extensions: { code: "AUTHENTICATION_ERROR", type: "authentication error" },
            },
          ],
        },
      },
    });
    const service = new LinearService({ gravityHome, logger, fetchImpl: linear.fetchImpl });
    await service.connect("lin_api_secret");

    await expect(service.listIssues({ filter: "all" })).rejects.toMatchObject({ code: "auth" });
  });
});
