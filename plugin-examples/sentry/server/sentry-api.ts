import { z } from "zod";
import { SENTRY_PERMISSION_MISSING, SENTRY_TOKEN_REJECTED } from "../shared/onboarding";
import type {
  SentryBreadcrumb,
  SentryEvent,
  SentryException,
  SentryFrame,
  SentryIssueDetail,
  SentryIssueListInput,
  SentryIssueSummary,
  SentryOrganization,
  SentryProject,
} from "../shared/contracts";

const ISSUE_PAGE_SIZE = 25;
const PROJECT_PAGE_LIMIT = 10;
const CONTEXT_LINE_MAX_CHARS = 300;

const ProjectSchema = z.object({
  id: z.coerce.string(),
  slug: z.string(),
  name: z.string().nullish(),
  platform: z.string().nullish(),
});

const OrganizationSchema = z.object({ slug: z.string(), name: z.string().nullish() });
const RegionsSchema = z.object({ regions: z.array(z.object({ url: z.string() })) });

// Sentry sends `count` as a string and `userCount` as a number.
const IssueSchema = z.object({
  id: z.coerce.string(),
  shortId: z.string(),
  title: z.string(),
  culprit: z.string().nullish(),
  permalink: z.string(),
  level: z.string().nullish(),
  status: z.string(),
  isUnhandled: z.boolean().nullish(),
  count: z.coerce.number().nullish(),
  userCount: z.coerce.number().nullish(),
  firstSeen: z.string().nullish(),
  lastSeen: z.string().nullish(),
  project: ProjectSchema,
});

const FrameSchema = z.object({
  filename: z.string().nullish(),
  absPath: z.string().nullish(),
  function: z.string().nullish(),
  module: z.string().nullish(),
  lineNo: z.number().nullish(),
  colNo: z.number().nullish(),
  inApp: z.boolean().nullish(),
  context: z.array(z.tuple([z.number(), z.string().nullable()])).nullish(),
});

const ExceptionValueSchema = z.object({
  type: z.string().nullish(),
  value: z.string().nullish(),
  module: z.string().nullish(),
  mechanism: z.object({ handled: z.boolean().nullish() }).nullish(),
  stacktrace: z
    .object({
      frames: z.array(FrameSchema).nullish(),
      framesOmitted: z.tuple([z.number(), z.number()]).nullish(),
    })
    .nullish(),
});

const ExceptionEntrySchema = z.object({ values: z.array(ExceptionValueSchema).nullish() });
const BreadcrumbsEntrySchema = z.object({
  values: z
    .array(
      z.object({
        timestamp: z.string().nullish(),
        category: z.string().nullish(),
        level: z.string().nullish(),
        message: z.string().nullish(),
      }),
    )
    .nullish(),
});
const RequestEntrySchema = z.object({ method: z.string().nullish(), url: z.string().nullish() });
const MessageEntrySchema = z.object({
  formatted: z.string().nullish(),
  message: z.string().nullish(),
});

// Entry `data` is parsed per type; threads, spans, debug meta, and the rest are ignored.
const EntrySchema = z.object({ type: z.string(), data: z.unknown() });

const EventSchema = z.object({
  eventID: z.string().nullish(),
  id: z.coerce.string(),
  dateCreated: z.string().nullish(),
  platform: z.string().nullish(),
  message: z.string().nullish(),
  release: z.object({ version: z.string() }).nullish(),
  tags: z.array(z.object({ key: z.string(), value: z.coerce.string() })).nullish(),
  entries: z.array(EntrySchema).nullish(),
});

export class SentryApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "SentryApiError";
  }
}

export interface SentryApiOptions {
  token: string;
  baseUrl: string;
  request?: typeof fetch;
  signal?: AbortSignal;
}

export interface SentryApi {
  /** Region API URLs for the token's user, or `null` on a Sentry without regions. */
  listRegions(): Promise<string[] | null>;
  listOrganizations(): Promise<SentryOrganization[]>;
  /** Reads one issue page entry to prove the token can read issues. */
  probeIssues(organization: string): Promise<void>;
  listProjects(organization: string): Promise<SentryProject[]>;
  listIssues(
    input: SentryIssueListInput,
  ): Promise<{ issues: SentryIssueSummary[]; nextCursor: string | null }>;
  getIssue(organization: string, issueId: string): Promise<SentryIssueDetail>;
}

function describeHttpFailure(status: number, detail: string | null): string {
  if (status === 401) {
    return `${SENTRY_TOKEN_REJECTED}. It may be mistyped, revoked, or expired; connect again with a new personal token`;
  }
  if (status === 403) {
    return `${SENTRY_PERMISSION_MISSING} a permission for this action. It needs Organization: Read, Project: Read, and Issue & Event: Read`;
  }
  if (status === 404) return detail ?? "Sentry could not find that resource";
  if (status === 429) return "Sentry rate limit reached. Try again shortly";
  return detail
    ? `Sentry request failed (HTTP ${status}): ${detail}`
    : `Sentry request failed with HTTP ${status}`;
}

async function readErrorDetail(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    return typeof body.detail === "string" ? body.detail : null;
  } catch {
    return null;
  }
}

/** Reads the cursor of a `rel="next"` link that still has results. */
export function parseNextCursor(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(/,\s*(?=<)/)) {
    if (!/rel="next"/.test(part)) continue;
    if (!/results="true"/.test(part)) return null;
    return /cursor="([^"]+)"/.exec(part)?.[1] ?? null;
  }
  return null;
}

export function buildIssueQuery(input: Pick<SentryIssueListInput, "filter" | "search">): string {
  const scope = {
    unresolved: "is:unresolved",
    assigned: "is:unresolved assigned:me",
    resolved: "is:resolved",
    all: "",
  }[input.filter];
  return [scope, input.search.trim()].filter(Boolean).join(" ");
}

function toProject(project: z.infer<typeof ProjectSchema>): SentryProject {
  return {
    id: project.id,
    slug: project.slug,
    name: project.name || project.slug,
    platform: project.platform ?? null,
  };
}

function toIssue(issue: z.infer<typeof IssueSchema>): SentryIssueSummary {
  return {
    id: issue.id,
    shortId: issue.shortId,
    title: issue.title,
    culprit: issue.culprit ?? "",
    permalink: issue.permalink,
    level: issue.level ?? "error",
    status: issue.status,
    isUnhandled: issue.isUnhandled ?? false,
    count: issue.count ?? 0,
    userCount: issue.userCount ?? 0,
    firstSeen: issue.firstSeen ?? null,
    lastSeen: issue.lastSeen ?? null,
    project: toProject(issue.project),
  };
}

function toFrame(frame: z.infer<typeof FrameSchema>): SentryFrame {
  return {
    filename: frame.filename ?? frame.absPath ?? null,
    function: frame.function ?? null,
    module: frame.module ?? null,
    lineNo: frame.lineNo ?? null,
    colNo: frame.colNo ?? null,
    inApp: frame.inApp ?? false,
    // Context lines are only kept for app frames; library source is noise for the agent.
    context: frame.inApp
      ? (frame.context ?? []).map(([line, code]) => ({
          line,
          code: (code ?? "").slice(0, CONTEXT_LINE_MAX_CHARS),
        }))
      : [],
  };
}

function toException(value: z.infer<typeof ExceptionValueSchema>): SentryException {
  const omitted = value.stacktrace?.framesOmitted;
  return {
    type: value.type ?? null,
    value: value.value ?? null,
    module: value.module ?? null,
    handled: value.mechanism?.handled ?? null,
    frames: (value.stacktrace?.frames ?? []).map(toFrame),
    omittedFrames: omitted ? Math.max(0, omitted[1] - omitted[0]) : 0,
  };
}

function readExceptions(data: unknown): SentryException[] {
  const parsed = ExceptionEntrySchema.safeParse(data);
  return parsed.success ? (parsed.data.values ?? []).map(toException) : [];
}

function readBreadcrumbs(data: unknown): SentryBreadcrumb[] {
  const parsed = BreadcrumbsEntrySchema.safeParse(data);
  if (!parsed.success) return [];
  return (parsed.data.values ?? []).map((crumb) => ({
    timestamp: crumb.timestamp ?? null,
    category: crumb.category ?? null,
    level: crumb.level ?? null,
    message: crumb.message ?? null,
  }));
}

function readRequest(data: unknown): SentryEvent["request"] {
  const parsed = RequestEntrySchema.safeParse(data);
  if (!parsed.success || !parsed.data.url) return null;
  return { method: parsed.data.method ?? null, url: parsed.data.url };
}

function readMessage(data: unknown): string | null {
  const parsed = MessageEntrySchema.safeParse(data);
  return parsed.success ? parsed.data.formatted || parsed.data.message || null : null;
}

export function toEvent(raw: unknown): SentryEvent {
  const event = EventSchema.parse(raw);
  const tags = event.tags ?? [];
  const tag = (key: string) => tags.find((entry) => entry.key === key)?.value ?? null;
  const entries = event.entries ?? [];
  const entryData = (type: string) =>
    entries.filter((entry) => entry.type === type).map((entry) => entry.data);
  return {
    id: event.eventID ?? event.id,
    dateCreated: event.dateCreated ?? null,
    platform: event.platform ?? null,
    message: entryData("message").map(readMessage).find(Boolean) ?? (event.message || null),
    environment: tag("environment"),
    release: event.release?.version ?? tag("release"),
    transaction: tag("transaction"),
    exceptions: entryData("exception").flatMap(readExceptions),
    breadcrumbs: entryData("breadcrumbs").flatMap(readBreadcrumbs),
    request: entryData("request").map(readRequest).find(Boolean) ?? null,
    tags: tags.map(({ key, value }) => ({ key, value })),
  };
}

export function createSentryApi(options: SentryApiOptions): SentryApi {
  const request = options.request ?? fetch;
  const apiRoot = `${options.baseUrl}/api/0`;

  async function call(
    pathname: string,
    init: { query?: Record<string, string | null> } = {},
  ): Promise<{ body: unknown; link: string | null }> {
    const url = new URL(`${apiRoot}${pathname}`);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== null && value !== "") url.searchParams.set(key, value);
    }
    let response: Response;
    try {
      response = await request(url, {
        headers: { Authorization: `Bearer ${options.token}`, Accept: "application/json" },
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new SentryApiError(`Could not reach Sentry at ${options.baseUrl}: ${reason}`);
    }
    if (!response.ok) {
      throw new SentryApiError(
        describeHttpFailure(response.status, await readErrorDetail(response)),
        response.status,
      );
    }
    return { body: await response.json(), link: response.headers.get("link") };
  }

  const org = (slug: string) => `/organizations/${encodeURIComponent(slug)}`;

  return {
    async listRegions() {
      let body: unknown;
      try {
        ({ body } = await call("/users/me/regions/"));
      } catch (error) {
        // Self-hosted Sentry has no region endpoint, and some tokens cannot read it.
        if (error instanceof SentryApiError && (error.status === 404 || error.status === 403)) {
          return null;
        }
        throw error;
      }
      const parsed = RegionsSchema.safeParse(body);
      if (!parsed.success || parsed.data.regions.length === 0) return null;
      return parsed.data.regions.map((region) => region.url.replace(/\/+$/, ""));
    },

    async listOrganizations() {
      const { body } = await call("/organizations/", { query: { member: "1" } });
      return OrganizationSchema.array()
        .parse(body)
        .map((organization) => ({
          slug: organization.slug,
          name: organization.name || organization.slug,
        }));
    },

    async probeIssues(organization) {
      await call(`${org(organization)}/issues/`, { query: { limit: "1" } });
    },

    async listProjects(organization) {
      const projects: SentryProject[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < PROJECT_PAGE_LIMIT; page += 1) {
        const { body, link } = await call(`${org(organization)}/projects/`, {
          query: { cursor },
        });
        projects.push(...ProjectSchema.array().parse(body).map(toProject));
        cursor = parseNextCursor(link);
        if (!cursor) break;
      }
      return projects.sort((a, b) => a.slug.localeCompare(b.slug));
    },

    async listIssues(input) {
      const { body, link } = await call(`${org(input.organization)}/issues/`, {
        query: {
          query: buildIssueQuery(input),
          sort: input.sort,
          statsPeriod: input.period,
          project: input.projectId,
          cursor: input.cursor,
          limit: String(ISSUE_PAGE_SIZE),
          // Lets a search for "WEB-3K" find the issue by short ID.
          shortIdLookup: "1",
        },
      });
      return {
        issues: IssueSchema.array().parse(body).map(toIssue),
        nextCursor: parseNextCursor(link),
      };
    },

    async getIssue(organization, issueId) {
      const issuePath = `${org(organization)}/issues/${encodeURIComponent(issueId)}`;
      const [issue, event] = await Promise.all([
        call(`${issuePath}/`),
        call(`${issuePath}/events/latest/`).catch((error: unknown) => {
          // An issue whose events aged out of retention still has a summary.
          if (error instanceof SentryApiError && error.status === 404) return null;
          throw error;
        }),
      ]);
      return {
        ...toIssue(IssueSchema.parse(issue.body)),
        event: event ? toEvent(event.body) : null,
      };
    },
  };
}
