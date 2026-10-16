import { existsSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Logger } from "pino";
import { z } from "zod";
import { writeFileAtomic } from "../../../server/atomic-file.js";
import type { ProviderUsage } from "../../../server/messages.js";
import { writePrivateFileAtomicSync } from "../../../server/private-files.js";
import type { ProviderApiFetch } from "../../quota-fetcher/provider.js";
import { buildClaudePlan, type ClaudeQuotaProvider } from "../../quota-fetcher/providers/claude.js";
import type {
  ProviderAccountAdapter,
  ProviderAccountIdentity,
  ProviderAccountRefreshOutcome,
  ProviderAccountUsageOutcome,
  ProviderLiveLogin,
  WriteLiveLoginInput,
} from "../adapter.js";
import {
  ClaudeCredentialSchema,
  ClaudeOauthAccountSchema,
  type ClaudeCredential,
  type ClaudeOauthAccount,
  isClaudeAccessTokenExpired,
  isClaudeCredentialUsable,
  mergeSharedCredentialState,
  refreshClaudeCredential,
} from "./credential.js";
import {
  ClaudeKeychain,
  KeychainError,
  claudeKeychainServices,
  readClaudeKeychainCredentials,
} from "./keychain.js";
import { claudeLockPaths, withClaudeLocks } from "./locks.js";

/**
 * Everything a Claude Code login consists of: the OAuth credential and the account
 * record Claude Code keeps beside it in `~/.claude.json`. Both travel together because
 * Claude Code reads the email and organization from the config, not from the token.
 */
export const ClaudeLoginSchema = z.object({
  credential: ClaudeCredentialSchema,
  oauthAccount: ClaudeOauthAccountSchema,
});

export type ClaudeLogin = z.infer<typeof ClaudeLoginSchema>;

const GlobalConfigSchema = z.object({ oauthAccount: z.unknown().optional() }).passthrough();

export class ClaudeGlobalConfigUnreadableError extends Error {
  constructor(readonly path: string) {
    super(`Claude Code config at ${path} is missing or not valid JSON`);
    this.name = "ClaudeGlobalConfigUnreadableError";
  }
}

export interface ClaudeAccountAdapterOptions {
  logger: Logger;
  usage: Pick<ClaudeQuotaProvider, "fetchUsageForOauth">;
  fetch?: ProviderApiFetch;
  /** Claude Code's config directory; `CLAUDE_CONFIG_DIR`, else `~/.claude`. */
  configDir?: string;
  /** Claude Code's global config; `~/.claude.json` by default. */
  globalConfigPath?: string;
  platform?: NodeJS.Platform;
  keychain?: ClaudeKeychain;
  keychainServices?: string[];
  now?: () => number;
}

export function resolveClaudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return env["CLAUDE_CONFIG_DIR"] || join(homedir(), ".claude");
}

export class ClaudeAccountAdapter implements ProviderAccountAdapter<ClaudeLogin> {
  readonly providerId = "claude";
  readonly displayName = "Claude Code";

  private readonly logger: Logger;
  private readonly usage: Pick<ClaudeQuotaProvider, "fetchUsageForOauth">;
  private readonly fetchApi: ProviderApiFetch;
  private readonly configDir: string;
  private readonly globalConfigPath: string;
  private readonly credentialsPath: string;
  private readonly keychain: ClaudeKeychain | null;
  private readonly keychainServices: string[];
  private readonly now: () => number;

  constructor(options: ClaudeAccountAdapterOptions) {
    this.logger = options.logger.child({ module: "claude-account-adapter" });
    this.usage = options.usage;
    this.fetchApi = options.fetch ?? fetch;
    this.configDir = options.configDir ?? resolveClaudeConfigDir();
    this.globalConfigPath = options.globalConfigPath ?? join(homedir(), ".claude.json");
    this.credentialsPath = join(this.configDir, ".credentials.json");
    const platform = options.platform ?? process.platform;
    this.keychain = platform === "darwin" ? (options.keychain ?? new ClaudeKeychain()) : null;
    this.keychainServices =
      options.keychainServices ?? claudeKeychainServices(process.env["CLAUDE_CONFIG_DIR"]);
    this.now = options.now ?? Date.now;
  }

  parseLogin(value: unknown): ClaudeLogin {
    return ClaudeLoginSchema.parse(value);
  }

  planLabel(login: ClaudeLogin, usage: ProviderUsage | null = null): string | null {
    if (usage) return usage.planLabel;
    const { subscriptionType, rateLimitTier } = login.credential.claudeAiOauth;
    return buildClaudePlan(subscriptionType ?? undefined, rateLimitTier ?? undefined);
  }

  isAccessTokenExpired(login: ClaudeLogin, nowMs: number): boolean {
    return isClaudeAccessTokenExpired(login.credential, nowMs);
  }

  async readLiveLogin(): Promise<ProviderLiveLogin<ClaudeLogin> | null> {
    const oauthAccount = await this.readOauthAccount();
    if (!oauthAccount) return null;
    const credential = await this.readLiveCredential();
    if (!credential) return null;
    return {
      identity: identityOf(oauthAccount),
      login: { credential, oauthAccount },
      isUsable: isClaudeCredentialUsable(credential),
    };
  }

  async writeLiveLogin(input: WriteLiveLoginInput<ClaudeLogin>): Promise<void> {
    const credential = mergeSharedCredentialState(
      input.login.credential,
      input.live?.login.credential ?? null,
    );
    const paths = claudeLockPaths(this.configDir, this.globalConfigPath);
    await withClaudeLocks(paths, async () => {
      await this.writeLiveCredential(JSON.stringify(credential));
      await this.writeOauthAccount(input.login.oauthAccount);
    });
  }

  async fetchUsage(login: ClaudeLogin): Promise<ProviderAccountUsageOutcome> {
    const usage = await this.usage.fetchUsageForOauth(login.credential.claudeAiOauth);
    return usage === "NEEDS_AUTH" ? { kind: "needs_auth" } : { kind: "usage", usage };
  }

  async refreshLogin(login: ClaudeLogin): Promise<ProviderAccountRefreshOutcome<ClaudeLogin>> {
    const outcome = await refreshClaudeCredential(this.fetchApi, login.credential, this.now());
    if (outcome.kind === "rejected") {
      this.logger.warn(
        { email: login.oauthAccount.emailAddress, reason: outcome.reason },
        "Claude token refresh rejected; account needs a new login",
      );
      return { kind: "relogin_required" };
    }
    return { kind: "refreshed", login: { ...login, credential: outcome.credential } };
  }

  private async readOauthAccount(): Promise<ClaudeOauthAccount | null> {
    const config = await this.readGlobalConfig();
    if (!config) return null;
    const parsed = ClaudeOauthAccountSchema.safeParse(config.oauthAccount);
    if (!parsed.success || parsed.data.emailAddress.length === 0) return null;
    return parsed.data;
  }

  private async readGlobalConfig(): Promise<z.infer<typeof GlobalConfigSchema> | null> {
    if (!existsSync(this.globalConfigPath)) return null;
    const raw = await fs.readFile(this.globalConfigPath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ClaudeGlobalConfigUnreadableError(this.globalConfigPath);
    }
    return GlobalConfigSchema.parse(parsed);
  }

  /**
   * On macOS Claude Code rotates only the Keychain item, so the file beside it can hold
   * a spent token. The Keychain wins whenever it answers; a Keychain failure is an
   * error rather than a reason to trust the file.
   */
  private async readLiveCredential(): Promise<ClaudeCredential | null> {
    const raw = this.keychain
      ? await readClaudeKeychainCredentials(this.keychain, this.keychainServices)
      : null;
    const text = raw ?? (await this.readCredentialFile());
    if (!text) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    const credential = ClaudeCredentialSchema.safeParse(parsed);
    return credential.success ? credential.data : null;
  }

  private async readCredentialFile(): Promise<string | null> {
    if (!existsSync(this.credentialsPath)) return null;
    return fs.readFile(this.credentialsPath, "utf8");
  }

  private async writeLiveCredential(text: string): Promise<void> {
    if (this.keychain) {
      try {
        await this.keychain.write(this.keychainServices[0] ?? "", text);
        // A running Claude Code reloads the file when its mtime changes, and reads
        // the Keychain on a ~30s cache otherwise. Mirror into an existing file so the
        // switch lands on the next request; never create the file, or Claude Code
        // starts preferring it over the Keychain.
        if (existsSync(this.credentialsPath)) {
          writePrivateFileAtomicSync(this.credentialsPath, text);
        }
        return;
      } catch (error) {
        if (!(error instanceof KeychainError)) throw error;
        this.logger.warn({ err: error }, "Keychain write failed; storing the login in a file");
        // Claude Code reads the Keychain first, so a leftover item would shadow the file.
        await this.keychain.delete(this.keychainServices[0] ?? "").catch(() => undefined);
      }
    }
    writePrivateFileAtomicSync(this.credentialsPath, text);
  }

  private async writeOauthAccount(oauthAccount: ClaudeOauthAccount): Promise<void> {
    const config = await this.readGlobalConfig();
    if (!config) throw new ClaudeGlobalConfigUnreadableError(this.globalConfigPath);
    const next: Record<string, unknown> = { ...config, oauthAccount };
    // An API-key login would take precedence over the OAuth token we just wrote.
    delete next["primaryApiKey"];
    await writeFileAtomic(this.globalConfigPath, JSON.stringify(next, null, 2));
  }
}

function identityOf(account: ClaudeOauthAccount): ProviderAccountIdentity {
  return {
    email: account.emailAddress,
    accountUuid: account.accountUuid ?? null,
    organizationUuid: account.organizationUuid ?? null,
    organizationName: account.organizationName ?? null,
    displayName: account.displayName ?? null,
  };
}
