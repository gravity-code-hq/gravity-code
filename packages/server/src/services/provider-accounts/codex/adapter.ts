import { existsSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Logger } from "pino";
import { z } from "zod";
import { writePrivateFileAtomicSync } from "../../../server/private-files.js";
import type { ProviderApiFetch } from "../../quota-fetcher/provider.js";
import type { CodexQuotaProvider } from "../../quota-fetcher/providers/codex.js";
import { fetchProviderApi } from "../../quota-fetcher/usage.js";
import type {
  ProviderAccountAdapter,
  ProviderAccountIdentity,
  ProviderAccountRefreshOutcome,
  ProviderAccountUsageOutcome,
  ProviderLiveLogin,
  WriteLiveLoginInput,
} from "../adapter.js";

// The OAuth client the Codex CLI registers itself as; refresh is rejected for any other.
const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/** `~/.codex/auth.json` as the Codex CLI writes it for a ChatGPT login. */
export const CodexLoginSchema = z
  .object({
    auth_mode: z.string().optional(),
    tokens: z
      .object({
        id_token: z.string(),
        access_token: z.string(),
        refresh_token: z.string(),
        account_id: z.string().optional(),
      })
      .passthrough(),
    last_refresh: z.string().optional(),
  })
  .passthrough();

export type CodexLogin = z.infer<typeof CodexLoginSchema>;

const IdTokenClaimsSchema = z
  .object({
    email: z.string(),
    name: z.string().optional(),
    exp: z.number().optional(),
    "https://api.openai.com/auth": z
      .object({
        chatgpt_account_id: z.string().optional(),
        chatgpt_user_id: z.string().optional(),
        chatgpt_plan_type: z.string().optional(),
        organizations: z
          .array(
            z.object({
              id: z.string().optional(),
              title: z.string().optional(),
              is_default: z.boolean().optional(),
            }),
          )
          .optional(),
      })
      .optional(),
  })
  .passthrough();

type IdTokenClaims = z.infer<typeof IdTokenClaimsSchema>;

const AccessTokenClaimsSchema = z.object({ exp: z.number().optional() }).passthrough();

const RefreshResponseSchema = z.object({
  id_token: z.string(),
  access_token: z.string(),
  refresh_token: z.string(),
});

function decodeJwtPayload(token: string): unknown {
  const segment = token.split(".")[1];
  if (!segment) return null;
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function codexIdTokenClaims(login: CodexLogin): IdTokenClaims | null {
  const parsed = IdTokenClaimsSchema.safeParse(decodeJwtPayload(login.tokens.id_token));
  return parsed.success ? parsed.data : null;
}

export function codexIdentity(claims: IdTokenClaims): ProviderAccountIdentity {
  const auth = claims["https://api.openai.com/auth"];
  const defaultOrganization = auth?.organizations?.find((org) => org.is_default === true);
  return {
    email: claims.email,
    accountUuid: auth?.chatgpt_user_id ?? null,
    organizationUuid: auth?.chatgpt_account_id ?? null,
    organizationName: defaultOrganization?.title ?? null,
    displayName: claims.name ?? null,
  };
}

export function resolveCodexHome(env: NodeJS.ProcessEnv = process.env): string {
  return env["CODEX_HOME"] || join(homedir(), ".codex");
}

export interface CodexAccountAdapterOptions {
  logger: Logger;
  usage: Pick<CodexQuotaProvider, "fetchUsageForTokens">;
  fetch?: ProviderApiFetch;
  codexHome?: string;
}

export class CodexAccountAdapter implements ProviderAccountAdapter<CodexLogin> {
  readonly providerId = "codex";
  readonly displayName = "Codex";

  private readonly logger: Logger;
  private readonly usage: Pick<CodexQuotaProvider, "fetchUsageForTokens">;
  private readonly fetchApi: ProviderApiFetch;
  private readonly authPath: string;

  constructor(options: CodexAccountAdapterOptions) {
    this.logger = options.logger.child({ module: "codex-account-adapter" });
    this.usage = options.usage;
    this.fetchApi = options.fetch ?? fetch;
    this.authPath = join(options.codexHome ?? resolveCodexHome(), "auth.json");
  }

  parseLogin(value: unknown): CodexLogin {
    return CodexLoginSchema.parse(value);
  }

  planLabel(login: CodexLogin): string | null {
    const plan = codexIdTokenClaims(login)?.["https://api.openai.com/auth"]?.chatgpt_plan_type;
    if (!plan) return null;
    return plan.charAt(0).toUpperCase() + plan.slice(1);
  }

  isAccessTokenExpired(login: CodexLogin, nowMs: number): boolean {
    const claims = AccessTokenClaimsSchema.safeParse(decodeJwtPayload(login.tokens.access_token));
    if (!claims.success || typeof claims.data.exp !== "number") return false;
    return nowMs + EXPIRY_BUFFER_MS >= claims.data.exp * 1000;
  }

  async readLiveLogin(): Promise<ProviderLiveLogin<CodexLogin> | null> {
    if (!existsSync(this.authPath)) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(this.authPath, "utf8"));
    } catch {
      return null;
    }
    const login = CodexLoginSchema.safeParse(parsed);
    if (!login.success) return null;
    const claims = codexIdTokenClaims(login.data);
    if (!claims) return null;
    return {
      identity: codexIdentity(claims),
      login: login.data,
      isUsable: login.data.tokens.access_token.length > 0,
    };
  }

  async writeLiveLogin(input: WriteLiveLoginInput<CodexLogin>): Promise<void> {
    writePrivateFileAtomicSync(this.authPath, JSON.stringify(input.login, null, 2));
  }

  async fetchUsage(login: CodexLogin): Promise<ProviderAccountUsageOutcome> {
    const usage = await this.usage.fetchUsageForTokens(
      login.tokens.access_token,
      login.tokens.account_id,
    );
    return usage === "NEEDS_AUTH" ? { kind: "needs_auth" } : { kind: "usage", usage };
  }

  async refreshLogin(login: CodexLogin): Promise<ProviderAccountRefreshOutcome<CodexLogin>> {
    const res = await fetchProviderApi(this.fetchApi, CODEX_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: CODEX_OAUTH_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: login.tokens.refresh_token,
        scope: "openid profile email",
      }),
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      this.logger.warn(
        { status: res.status },
        "Codex token refresh rejected; account needs a new login",
      );
      return { kind: "relogin_required" };
    }
    if (!res.ok) throw new Error(`Codex token refresh returned ${res.status}`);
    const body = RefreshResponseSchema.parse(await res.json());
    return {
      kind: "refreshed",
      login: {
        ...login,
        tokens: {
          ...login.tokens,
          id_token: body.id_token,
          access_token: body.access_token,
          refresh_token: body.refresh_token,
        },
        last_refresh: new Date().toISOString(),
      },
    };
  }
}
