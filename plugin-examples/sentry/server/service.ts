import type { RpcInput, RpcOutput } from "@gravity/plugin";
import type {
  connectRpc,
  getIssueRpc,
  listIssuesRpc,
  listProjectsRpc,
  SentryOrganization,
  SentryStatus,
} from "../shared/contracts";
import { isOrganizationToken, missingPermissionMessage } from "../shared/onboarding";
import { normalizeSentryUrl, type SentryCredentialStore } from "./credentials";
import { createSentryApi, SentryApiError, type SentryApi } from "./sentry-api";

interface Credentials {
  token: string;
  baseUrl: string;
}

interface ActiveCredentials extends Credentials {
  source: "saved" | "environment";
}

interface Discovery {
  organizations: SentryOrganization[];
  regions: Record<string, string>;
}

export interface SentryServiceOptions {
  store: SentryCredentialStore;
  env?: NodeJS.ProcessEnv;
  request?: typeof fetch;
}

export interface SentryService {
  status(): Promise<SentryStatus>;
  connect(input: RpcInput<typeof connectRpc>): Promise<SentryStatus>;
  disconnect(): Promise<SentryStatus>;
  listProjects(input: RpcInput<typeof listProjectsRpc>): Promise<RpcOutput<typeof listProjectsRpc>>;
  listIssues(input: RpcInput<typeof listIssuesRpc>): Promise<RpcOutput<typeof listIssuesRpc>>;
  getIssue(input: RpcInput<typeof getIssueRpc>): Promise<RpcOutput<typeof getIssueRpc>>;
}

const ORGANIZATION_TOKEN_MESSAGE =
  "This is an organization token. Organization tokens only carry CI permissions and cannot read issues. Create a personal token instead";

/**
 * The token is sent to a region URL that Sentry returns, so only accept hosts
 * under the URL the user connected to, such as de.sentry.io under sentry.io.
 */
export function isTrustedRegion(regionUrl: string, baseUrl: string): boolean {
  try {
    const region = new URL(regionUrl);
    const base = new URL(baseUrl);
    return (
      region.protocol === base.protocol &&
      (region.hostname === base.hostname || region.hostname.endsWith(`.${base.hostname}`))
    );
  } catch {
    return false;
  }
}

/**
 * Owns the token and every Sentry call. A token saved from the app wins over
 * SENTRY_AUTH_TOKEN in the daemon environment, so disconnecting a saved token
 * falls back to the environment one when it is set.
 */
export function createSentryService(options: SentryServiceOptions): SentryService {
  const env = options.env ?? process.env;
  let environmentDiscovery: Promise<Discovery> | null = null;

  function apiFor(credentials: Credentials): SentryApi {
    return createSentryApi({
      ...credentials,
      ...(options.request ? { request: options.request } : {}),
    });
  }

  function apiForOrganization(
    credentials: Credentials,
    regions: Record<string, string>,
    organization: string,
  ): SentryApi {
    return apiFor({ ...credentials, baseUrl: regions[organization] ?? credentials.baseUrl });
  }

  /** Sentry.io keeps EU and US organizations on separate region hosts; list each one. */
  async function discover(credentials: Credentials): Promise<Discovery> {
    const api = apiFor(credentials);
    const regionUrls = (await api.listRegions())?.filter((url) =>
      isTrustedRegion(url, credentials.baseUrl),
    );
    if (!regionUrls || regionUrls.length === 0) {
      return { organizations: await api.listOrganizations(), regions: {} };
    }
    const organizations: SentryOrganization[] = [];
    const regions: Record<string, string> = {};
    for (const regionUrl of regionUrls) {
      for (const organization of await apiFor({
        ...credentials,
        baseUrl: regionUrl,
      }).listOrganizations()) {
        if (regions[organization.slug]) continue;
        organizations.push(organization);
        regions[organization.slug] = regionUrl;
      }
    }
    return { organizations, regions };
  }

  async function activeCredentials(): Promise<ActiveCredentials | null> {
    const saved = await options.store.read();
    if (saved) return { token: saved.token, baseUrl: saved.baseUrl, source: "saved" };
    const token = env.SENTRY_AUTH_TOKEN?.trim();
    if (!token) return null;
    return { token, baseUrl: normalizeSentryUrl(env.SENTRY_URL ?? ""), source: "environment" };
  }

  async function activeDiscovery(credentials: ActiveCredentials): Promise<Discovery> {
    if (credentials.source === "saved") {
      const saved = await options.store.read();
      if (saved) return { organizations: saved.organizations, regions: saved.regions };
    }
    environmentDiscovery ??= discover(credentials);
    try {
      return await environmentDiscovery;
    } catch (error) {
      environmentDiscovery = null;
      throw error;
    }
  }

  async function requireApi(organization: string): Promise<SentryApi> {
    const credentials = await activeCredentials();
    if (!credentials) throw new SentryApiError("Connect Sentry first");
    const { regions } = await activeDiscovery(credentials);
    return apiForOrganization(credentials, regions, organization);
  }

  async function status(): Promise<SentryStatus> {
    const credentials = await activeCredentials();
    if (!credentials) return { state: "disconnected" };
    const { organizations } = await activeDiscovery(credentials);
    return {
      state: "connected",
      source: credentials.source,
      baseUrl: credentials.baseUrl,
      organizations,
    };
  }

  /** Turns a 403 from one check into the name of the permission that check needs. */
  async function requirePermission<Result>(
    token: string,
    check: Promise<Result>,
    permission: { area: string; level: string },
  ): Promise<Result> {
    try {
      return await check;
    } catch (error) {
      if (!(error instanceof SentryApiError) || error.status !== 403) throw error;
      if (isOrganizationToken(token)) throw new SentryApiError(ORGANIZATION_TOKEN_MESSAGE, 403);
      throw new SentryApiError(missingPermissionMessage(permission.area, permission.level), 403);
    }
  }

  return {
    status,

    async connect({ token, baseUrl }) {
      const credentials = { token: token.trim(), baseUrl: normalizeSentryUrl(baseUrl) };
      const discovery = await requirePermission(credentials.token, discover(credentials), {
        area: "Organization",
        level: "Read",
      });
      const first = discovery.organizations[0];
      if (!first) {
        throw new SentryApiError(
          "This token cannot see any Sentry organization. Create it while signed in to the account that belongs to your organization",
        );
      }
      // Prove the token can do what the issues screen needs before saving it.
      const api = apiForOrganization(credentials, discovery.regions, first.slug);
      await requirePermission(credentials.token, api.listProjects(first.slug), {
        area: "Project",
        level: "Read",
      });
      await requirePermission(credentials.token, api.probeIssues(first.slug), {
        area: "Issue & Event",
        level: "Read",
      });
      await options.store.write({ ...credentials, ...discovery });
      return status();
    },

    async disconnect() {
      await options.store.clear();
      return status();
    },

    async listProjects({ organization }) {
      const api = await requireApi(organization);
      return { projects: await api.listProjects(organization) };
    },

    async listIssues(input) {
      const api = await requireApi(input.organization);
      return api.listIssues(input);
    },

    async getIssue({ organization, issueId }) {
      const api = await requireApi(organization);
      return api.getIssue(organization, issueId);
    },
  };
}
