import { z } from "zod";
import type { ProviderApiFetch } from "../../quota-fetcher/provider.js";
import { fetchProviderApi } from "../../quota-fetcher/usage.js";

// The OAuth client Claude Code registers itself as. Refreshing with any other client id
// is rejected, so this is not configurable.
const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_OAUTH_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
// Treat a token as expired a little before the server does, so a switch never hands
// Claude Code a token with seconds left on it.
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

// Keys next to `claudeAiOauth` that belong to the machine, not the account: MCP and
// plugin OAuth state. They come from the live login on every activation, so a switch
// never resurrects a stale copy from an older snapshot.
const SHARED_CREDENTIAL_KEYS = [
  "mcpOAuth",
  "mcpOAuthClientConfig",
  "mcpXaaIdp",
  "mcpXaaIdpConfig",
  "pluginSecrets",
] as const;

export const ClaudeOauthSchema = z
  .object({
    accessToken: z.string(),
    refreshToken: z.string().optional(),
    expiresAt: z.number().optional(),
    scopes: z.array(z.string()).optional(),
    subscriptionType: z.string().nullish(),
    rateLimitTier: z.string().nullish(),
  })
  .passthrough();

export const ClaudeCredentialSchema = z.object({ claudeAiOauth: ClaudeOauthSchema }).passthrough();

export type ClaudeOauth = z.infer<typeof ClaudeOauthSchema>;
export type ClaudeCredential = z.infer<typeof ClaudeCredentialSchema>;

export const ClaudeOauthAccountSchema = z
  .object({
    emailAddress: z.string(),
    accountUuid: z.string().nullish(),
    organizationUuid: z.string().nullish(),
    organizationName: z.string().nullish(),
    displayName: z.string().nullish(),
  })
  .passthrough();

export type ClaudeOauthAccount = z.infer<typeof ClaudeOauthAccountSchema>;

/** Whether the credential still carries tokens. Claude Code blanks both on `invalid_grant`. */
export function isClaudeCredentialUsable(credential: ClaudeCredential): boolean {
  const { accessToken, refreshToken } = credential.claudeAiOauth;
  return accessToken.length > 0 || Boolean(refreshToken);
}

export function isClaudeAccessTokenExpired(
  credential: ClaudeCredential,
  nowMs: number = Date.now(),
): boolean {
  const { expiresAt } = credential.claudeAiOauth;
  if (typeof expiresAt !== "number") return false;
  return nowMs + EXPIRY_BUFFER_MS >= expiresAt;
}

/** The target snapshot with the live login's machine-shared OAuth state layered on. */
export function mergeSharedCredentialState(
  target: ClaudeCredential,
  live: ClaudeCredential | null,
): ClaudeCredential {
  const merged: Record<string, unknown> = { ...target };
  for (const key of SHARED_CREDENTIAL_KEYS) {
    delete merged[key];
    if (live && key in live) merged[key] = live[key];
  }
  return ClaudeCredentialSchema.parse(merged);
}

const RefreshResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
});

const RefreshErrorSchema = z.object({ error: z.string() });

export type ClaudeRefreshOutcome =
  | { kind: "refreshed"; credential: ClaudeCredential }
  | { kind: "rejected"; reason: "invalid_grant" | "invalid_client" | "no_refresh_token" };

/**
 * Redeems the refresh token for a fresh access token. Refresh tokens are single use:
 * the caller must persist the returned credential or the account's login is lost.
 */
export async function refreshClaudeCredential(
  fetchApi: ProviderApiFetch,
  credential: ClaudeCredential,
  nowMs: number = Date.now(),
): Promise<ClaudeRefreshOutcome> {
  const { refreshToken } = credential.claudeAiOauth;
  if (!refreshToken) return { kind: "rejected", reason: "no_refresh_token" };

  const res = await fetchProviderApi(fetchApi, CLAUDE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLAUDE_OAUTH_CLIENT_ID,
    }),
  });

  if (!res.ok) {
    const rejection = await readRejection(res);
    if (rejection) return { kind: "rejected", reason: rejection };
    throw new Error(`Claude token refresh returned ${res.status}`);
  }

  const body = RefreshResponseSchema.parse(await res.json());
  const oauth: ClaudeOauth = {
    ...credential.claudeAiOauth,
    accessToken: body.access_token,
    expiresAt: nowMs + body.expires_in * 1000,
    ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
    ...(body.scope ? { scopes: body.scope.split(" ").filter(Boolean) } : {}),
  };
  return { kind: "refreshed", credential: { ...credential, claudeAiOauth: oauth } };
}

async function readRejection(res: Response): Promise<"invalid_grant" | "invalid_client" | null> {
  if (res.status !== 400 && res.status !== 401 && res.status !== 403) return null;
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return null;
  }
  const result = RefreshErrorSchema.safeParse(parsed);
  if (!result.success) return null;
  if (result.data.error === "invalid_grant" || result.data.error === "invalid_client") {
    return result.data.error;
  }
  return null;
}
