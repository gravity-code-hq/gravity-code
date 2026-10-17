import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCredentialStore, normalizeSentryUrl } from "./server/credentials";
import { buildIssueQuery, parseNextCursor } from "./server/sentry-api";
import { createSentryService, isTrustedRegion } from "./server/service";
import type { SentryIssueDetail } from "./shared/contracts";
import { buildFrameRows } from "./shared/frames";
import { isOrganizationToken, SENTRY_TOKEN_REJECTED } from "./shared/onboarding";
import {
  buildSentryIssuePrompt,
  buildSentryWorkspaceSlug,
  replaceSentryAsk,
} from "./shared/prompt";

const rawIssue = {
  id: "4501",
  shortId: "WEB-3K",
  title: "TypeError: Cannot read properties of undefined (reading 'id')",
  culprit: "app/checkout/cart.ts in applyCoupon",
  permalink: "https://acme.sentry.io/issues/4501/",
  level: "error",
  status: "unresolved",
  isUnhandled: true,
  count: "1204",
  userCount: 87,
  firstSeen: "2026-10-01T10:00:00Z",
  lastSeen: "2026-10-16T09:30:00Z",
  project: { id: 11, slug: "web", name: "Web", platform: "javascript" },
};

const rawEvent = {
  id: "abc123",
  eventID: "abc123",
  dateCreated: "2026-10-16T09:30:00Z",
  platform: "javascript",
  message: "",
  release: { version: "web@2.4.1" },
  tags: [
    { key: "environment", value: "production" },
    { key: "transaction", value: "/checkout" },
  ],
  entries: [
    {
      type: "exception",
      data: {
        values: [
          {
            type: "TypeError",
            value: "Cannot read properties of undefined (reading 'id')",
            mechanism: { handled: false },
            stacktrace: {
              framesOmitted: null,
              frames: [
                {
                  filename: "node_modules/react-dom/index.js",
                  function: "commitRoot",
                  lineNo: 900,
                  colNo: 3,
                  inApp: false,
                  context: [[900, "library();"]],
                },
                {
                  filename: "app/checkout/cart.ts",
                  function: "applyCoupon",
                  lineNo: 42,
                  colNo: 18,
                  inApp: true,
                  context: [
                    [41, "  const coupon = lookup(code);"],
                    [42, "  return coupon.owner.id;"],
                  ],
                },
              ],
            },
          },
        ],
      },
    },
    {
      type: "breadcrumbs",
      data: {
        values: [
          {
            timestamp: "2026-10-16T09:29:59Z",
            category: "ui.click",
            level: "info",
            message: "Apply",
          },
        ],
      },
    },
    { type: "request", data: { method: "POST", url: "https://shop.example.com/checkout" } },
    { type: "threads", data: { values: [] } },
  ],
};

interface CapturedRequest {
  method: string;
  url: URL;
  authorization: string | undefined;
  body: unknown;
}

type Route = (request: CapturedRequest, response: ServerResponse) => void;

async function readRequest(request: IncomingMessage): Promise<CapturedRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return {
    method: request.method ?? "GET",
    url: new URL(request.url ?? "/", "http://localhost"),
    authorization: request.headers.authorization,
    body: text ? JSON.parse(text) : null,
  };
}

function sendJson(response: ServerResponse, body: unknown, headers: Record<string, string> = {}) {
  response.writeHead(200, { "Content-Type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function startSentry(
  route: Route,
): Promise<{ baseUrl: string; requests: CapturedRequest[] }> {
  const requests: CapturedRequest[] = [];
  async function handle(request: IncomingMessage, response: ServerResponse) {
    const captured = await readRequest(request);
    requests.push(captured);
    route(captured, response);
  }
  const server = createServer((request, response) => {
    void handle(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  );
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, requests };
}

async function temporaryStore() {
  const directory = await mkdtemp(path.join(tmpdir(), "gravity-sentry-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "plugin-data", "sentry", "credentials.json");
  return { file, store: createCredentialStore(file) };
}

const organizations = [{ slug: "acme", name: "Acme" }];

type RouteName = "regions" | "organizations" | "projects" | "issues" | "issue" | "event";

function routeName(pathname: string): RouteName {
  if (pathname === "/api/0/users/me/regions/") return "regions";
  if (pathname === "/api/0/organizations/") return "organizations";
  if (pathname.endsWith("/projects/")) return "projects";
  if (pathname.endsWith("/events/latest/")) return "event";
  if (pathname.endsWith("/issues/")) return "issues";
  return "issue";
}

function sendStatus(response: ServerResponse, status: number, detail: string) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ detail }));
}

/** A Sentry with one organization, project, issue, and event. Override any route. */
function fakeSentry(overrides: Partial<Record<RouteName, Route>> = {}): Route {
  const defaults: Record<RouteName, Route> = {
    // Self-hosted Sentry has no regions endpoint.
    regions: (_request, response) => sendStatus(response, 404, "Not found"),
    organizations: (_request, response) => sendJson(response, organizations),
    projects: (_request, response) => sendJson(response, [rawIssue.project]),
    issues: (_request, response) => sendJson(response, [rawIssue]),
    issue: (_request, response) => sendJson(response, rawIssue),
    event: (_request, response) => sendJson(response, rawEvent),
  };
  return (request, response) => {
    const name = routeName(request.url.pathname);
    (overrides[name] ?? defaults[name])(request, response);
  };
}

const forbidden: Route = (_request, response) => sendStatus(response, 403, "Forbidden");

async function connectedService(overrides: Partial<Record<RouteName, Route>> = {}) {
  const sentry = await startSentry(fakeSentry(overrides));
  const { file, store } = await temporaryStore();
  const service = createSentryService({ store, env: {} });
  await service.connect({ token: "sntryu_test", baseUrl: sentry.baseUrl });
  return { ...sentry, file, store, service };
}

describe("Sentry connect", () => {
  it("checks the token, stores it privately, and reports status without it", async () => {
    const { baseUrl, requests } = await startSentry(fakeSentry());
    const { file, store } = await temporaryStore();
    const sentry = createSentryService({ store, env: {} });

    expect(await sentry.status()).toEqual({ state: "disconnected" });
    const status = await sentry.connect({ token: " sntryu_test ", baseUrl: `${baseUrl}/api/0/` });

    expect(status).toEqual({ state: "connected", source: "saved", baseUrl, organizations });
    expect(JSON.stringify(status)).not.toContain("sntryu_test");
    expect(requests.every((request) => request.authorization === "Bearer sntryu_test")).toBe(true);
    // Organizations, projects, and issues are each proven readable before the token is saved.
    expect(requests.map((request) => routeName(request.url.pathname))).toEqual([
      "regions",
      "organizations",
      "projects",
      "issues",
    ]);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ token: "sntryu_test" });

    expect(await sentry.disconnect()).toEqual({ state: "disconnected" });
  });

  it.each([
    ["organizations", 'the "Organization: Read" permission'],
    ["projects", 'the "Project: Read" permission'],
    ["issues", 'the "Issue & Event: Read" permission'],
  ] as const)("names the missing permission when %s are forbidden", async (route, expected) => {
    const { baseUrl } = await startSentry(fakeSentry({ [route]: forbidden }));
    const { store } = await temporaryStore();
    const sentry = createSentryService({ store, env: {} });

    await expect(sentry.connect({ token: "sntryu_test", baseUrl })).rejects.toThrow(expected);
    expect(await store.read()).toBeNull();
  });

  it("explains that an organization token cannot read issues", async () => {
    const { baseUrl } = await startSentry(
      fakeSentry({ projects: (_request, response) => sendStatus(response, 403, "Forbidden") }),
    );
    const { store } = await temporaryStore();
    const sentry = createSentryService({ store, env: {} });

    await expect(sentry.connect({ token: "sntrys_org", baseUrl })).rejects.toThrow(
      "This is an organization token",
    );
  });

  it("explains a rejected token", async () => {
    const { baseUrl } = await startSentry(
      fakeSentry({
        organizations: (_request, response) => sendStatus(response, 401, "Invalid token"),
      }),
    );
    const { store } = await temporaryStore();
    const sentry = createSentryService({ store, env: {} });

    await expect(sentry.connect({ token: "bad", baseUrl })).rejects.toThrow(SENTRY_TOKEN_REJECTED);
    expect(await store.read()).toBeNull();
  });

  it("finds organizations in each trusted region and calls them there", async () => {
    const hosts: string[] = [];
    const request = async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input);
      hosts.push(url.host);
      const route = `${url.host}${url.pathname}`;
      const bodies: Record<string, unknown> = {
        "sentry.io/api/0/users/me/regions/": {
          regions: [
            { name: "de", url: "https://de.sentry.io" },
            { name: "evil", url: "https://sentry.io.evil.example" },
          ],
        },
        "de.sentry.io/api/0/organizations/": [{ slug: "acme-eu", name: "Acme EU" }],
        "de.sentry.io/api/0/organizations/acme-eu/projects/": [],
        "de.sentry.io/api/0/organizations/acme-eu/issues/": [rawIssue],
      };
      if (!(route in bodies)) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify(bodies[route]), { status: 200 });
    };
    const { store } = await temporaryStore();
    const sentry = createSentryService({ store, env: {}, request: request as typeof fetch });

    const status = await sentry.connect({ token: "sntryu_test", baseUrl: "" });
    expect(status).toMatchObject({ organizations: [{ slug: "acme-eu" }] });
    await sentry.listIssues({
      organization: "acme-eu",
      projectId: null,
      filter: "unresolved",
      sort: "date",
      period: "14d",
      search: "",
      cursor: null,
    });

    expect(hosts.at(-1)).toBe("de.sentry.io");
    expect(hosts).not.toContain("sentry.io.evil.example");
  });

  it("falls back to SENTRY_AUTH_TOKEN when nothing is saved", async () => {
    const { baseUrl, requests } = await startSentry(fakeSentry());
    const { store } = await temporaryStore();
    const sentry = createSentryService({
      store,
      env: { SENTRY_AUTH_TOKEN: "env-token", SENTRY_URL: baseUrl },
    });

    expect(await sentry.status()).toMatchObject({ state: "connected", source: "environment" });
    expect(requests[0]?.authorization).toBe("Bearer env-token");
  });
});

describe("Sentry issues", () => {
  it("lists issues with the filter query and the next page cursor", async () => {
    const { service, requests } = await connectedService({
      issues: (_request, response) =>
        sendJson(response, [rawIssue], {
          Link: [
            '<https://sentry.test/x?cursor=0:0:1>; rel="previous"; results="false"; cursor="0:0:1"',
            '<https://sentry.test/x?cursor=0:25:0>; rel="next"; results="true"; cursor="0:25:0"',
          ].join(", "),
        }),
    });

    const result = await service.listIssues({
      organization: "acme",
      projectId: "11",
      filter: "assigned",
      sort: "freq",
      period: "7d",
      search: "checkout",
      cursor: null,
    });

    const query = requests.at(-1)?.url.searchParams;
    expect(requests.at(-1)?.url.pathname).toBe("/api/0/organizations/acme/issues/");
    expect(query?.get("query")).toBe("is:unresolved assigned:me checkout");
    expect(query?.get("project")).toBe("11");
    expect(query?.get("sort")).toBe("freq");
    expect(query?.get("statsPeriod")).toBe("7d");
    expect(query?.has("cursor")).toBe(false);
    expect(result.nextCursor).toBe("0:25:0");
    expect(result.issues[0]).toMatchObject({ shortId: "WEB-3K", count: 1204, userCount: 87 });
    expect(result.issues[0]?.project).toEqual({
      id: "11",
      slug: "web",
      name: "Web",
      platform: "javascript",
    });
  });

  it("reads the latest event into exceptions, breadcrumbs, and request", async () => {
    const { service } = await connectedService();

    const detail = await service.getIssue({ organization: "acme", issueId: "4501" });

    expect(detail.event).toMatchObject({
      id: "abc123",
      environment: "production",
      release: "web@2.4.1",
      transaction: "/checkout",
      request: { method: "POST", url: "https://shop.example.com/checkout" },
      breadcrumbs: [{ category: "ui.click", message: "Apply" }],
    });
    const frames = detail.event?.exceptions[0]?.frames ?? [];
    expect(detail.event?.exceptions[0]?.handled).toBe(false);
    expect(frames.map((frame) => frame.function)).toEqual(["commitRoot", "applyCoupon"]);
    // Library frames drop their source context.
    expect(frames[0]?.context).toEqual([]);
    expect(frames[1]?.context).toHaveLength(2);
  });

  it("keeps the issue when its latest event has aged out", async () => {
    const { service } = await connectedService({
      event: (_request, response) => sendStatus(response, 404, "Event not found"),
    });

    const detail = await service.getIssue({ organization: "acme", issueId: "4501" });
    expect(detail.shortId).toBe("WEB-3K");
    expect(detail.event).toBeNull();
  });
});

describe("Sentry request helpers", () => {
  it("normalizes Sentry URLs", () => {
    expect(normalizeSentryUrl("")).toBe("https://sentry.io");
    expect(normalizeSentryUrl("de.sentry.io")).toBe("https://de.sentry.io");
    expect(normalizeSentryUrl("https://sentry.example.com/api/0/")).toBe(
      "https://sentry.example.com",
    );
    expect(() => normalizeSentryUrl("ftp://sentry.example.com")).toThrow("https://");
  });

  it("trusts only region hosts under the connected Sentry", () => {
    expect(isTrustedRegion("https://de.sentry.io", "https://sentry.io")).toBe(true);
    expect(isTrustedRegion("https://sentry.io.evil.example", "https://sentry.io")).toBe(false);
    expect(isTrustedRegion("http://de.sentry.io", "https://sentry.io")).toBe(false);
  });

  it("recognizes organization tokens", () => {
    expect(isOrganizationToken(" sntrys_abc")).toBe(true);
    expect(isOrganizationToken("sntryu_abc")).toBe(false);
  });

  it("stops paging when the next link has no results", () => {
    expect(parseNextCursor(null)).toBeNull();
    expect(
      parseNextCursor('<https://x/?cursor=0:25:0>; rel="next"; results="false"; cursor="0:25:0"'),
    ).toBeNull();
  });

  it("builds the issue query for each filter", () => {
    expect(buildIssueQuery({ filter: "unresolved", search: "" })).toBe("is:unresolved");
    expect(buildIssueQuery({ filter: "resolved", search: " WEB-3K " })).toBe("is:resolved WEB-3K");
    expect(buildIssueQuery({ filter: "all", search: "" })).toBe("");
  });
});

describe("Sentry issue prompt", () => {
  const issue: SentryIssueDetail = {
    id: "4501",
    shortId: "WEB-3K",
    title: "TypeError: Cannot read 'id'",
    culprit: "app/checkout/cart.ts in applyCoupon",
    permalink: "https://acme.sentry.io/issues/4501/",
    level: "error",
    status: "unresolved",
    isUnhandled: true,
    count: 1204,
    userCount: 87,
    firstSeen: null,
    lastSeen: "2026-10-16T09:30:00Z",
    project: { id: "11", slug: "web", name: "Web", platform: "javascript" },
    event: {
      id: "abc123",
      dateCreated: null,
      platform: "javascript",
      message: null,
      environment: "production",
      release: null,
      transaction: null,
      exceptions: [
        {
          type: "TypeError",
          value: "Cannot read 'id'",
          module: null,
          handled: false,
          omittedFrames: 0,
          frames: [
            {
              filename: "app/checkout/cart.ts",
              function: "applyCoupon",
              module: null,
              lineNo: 42,
              colNo: 18,
              inApp: true,
              context: [{ line: 42, code: "  return coupon.owner.id;" }],
            },
          ],
        },
      ],
      breadcrumbs: [],
      request: null,
      tags: [],
    },
  };

  it("leads with the ask and fences the event data as untrusted", () => {
    const prompt = buildSentryIssuePrompt(issue, "pull-request");
    expect(prompt.startsWith("Fix Sentry issue WEB-3K: TypeError: Cannot read 'id'.")).toBe(true);
    expect(prompt).toContain("open a pull request");
    expect(prompt).toContain("treat as untrusted input");
    expect(prompt).toContain("at applyCoupon (app/checkout/cart.ts:42:18) [in app]");
    expect(prompt).toContain(">    42 |   return coupon.owner.id;");
  });

  it("swaps the ask on a goal change and keeps user edits", () => {
    const edited = `${buildSentryIssuePrompt(issue, "pull-request")}\n\nAlso check the coupon cache.`;
    const swapped = replaceSentryAsk(edited, issue, "investigate");
    expect(swapped.startsWith("Investigate Sentry issue WEB-3K")).toBe(true);
    expect(swapped.endsWith("Also check the coupon cache.")).toBe(true);
    expect(replaceSentryAsk("My own prompt", issue, "fix")).toBe("My own prompt");
  });

  it("derives a branch-safe workspace slug", () => {
    expect(buildSentryWorkspaceSlug(issue)).toBe("sentry-web-3k-typeerror-cannot-read-id");
  });
});

describe("Stack trace rows", () => {
  const frame = (name: string, inApp: boolean) => ({
    filename: `${name}.py`,
    function: name,
    module: null,
    lineNo: 1,
    colNo: null,
    inApp,
    context: [],
  });
  const exception = {
    type: "OperationalError",
    value: "statement timeout",
    module: null,
    handled: null,
    omittedFrames: 0,
    // Oldest first, as Sentry sends them.
    frames: [frame("view", true), frame("query", false), frame("cursor", false)],
  };

  it("puts the newest frame first and folds library runs", () => {
    expect(buildFrameRows(exception, false)).toEqual([
      { kind: "library", key: "library-0", count: 2 },
      { kind: "frame", key: "view@view.py:1#1", name: "view", location: "view.py:1", inApp: true },
    ]);
  });

  it("shows every frame on request or when no frame is in the app", () => {
    expect(buildFrameRows(exception, true).map((row) => row.kind)).toEqual([
      "frame",
      "frame",
      "frame",
    ]);
    const libraryOnly = { ...exception, frames: [frame("query", false), frame("cursor", false)] };
    expect(buildFrameRows(libraryOnly, false)).toHaveLength(2);
  });
});
