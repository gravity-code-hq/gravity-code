import type { Logger } from "pino";
import type {
  ProviderAccount,
  ProviderAccountsProvider,
  ProviderUsage,
} from "../../server/messages.js";
import { unavailableUsage } from "../quota-fetcher/usage.js";
import { isSameAccount, type ProviderAccountAdapter, type ProviderLiveLogin } from "./adapter.js";
import {
  createProviderAccountId,
  type ProviderAccountStore,
  type StoredProviderAccount,
} from "./store.js";

export type ProviderAccountErrorCode =
  | "provider_not_found"
  | "account_not_found"
  | "account_active"
  | "no_live_login"
  | "live_login_unusable"
  | "relogin_required";

export class ProviderAccountError extends Error {
  constructor(
    readonly code: ProviderAccountErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProviderAccountError";
  }
}

export interface ProviderAccountsListResult {
  fetchedAt: string;
  providers: ProviderAccountsProvider[];
}

export interface ProviderAccountsServiceOptions {
  logger: Logger;
  store: ProviderAccountStore;
  adapters: ProviderAccountAdapter[];
  now?: () => number;
  usageCacheTtlMs?: number;
}

const DEFAULT_USAGE_CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedUsage {
  fetchedAtMs: number;
  usage: ProviderUsage | null;
}

/**
 * Saved provider logins and the switch between them.
 *
 * The provider CLI owns the active login: Gravity reads it, snapshots it before a switch
 * so a rotated refresh token is not lost, and never refreshes it. Saved logins that are
 * not active exist only in Gravity's store, so their refresh tokens are Gravity's to
 * redeem when usage lookup needs a live access token.
 */
export class ProviderAccountsService {
  private readonly logger: Logger;
  private readonly store: ProviderAccountStore;
  private readonly adapters: Map<string, ProviderAccountAdapter>;
  private readonly now: () => number;
  private readonly usageCacheTtlMs: number;
  private readonly usageCache = new Map<string, CachedUsage>();
  private readonly usageInFlight = new Map<string, Promise<ProviderUsage | null>>();
  private mutation: Promise<unknown> = Promise.resolve();

  constructor(options: ProviderAccountsServiceOptions) {
    this.logger = options.logger.child({ module: "provider-accounts-service" });
    this.store = options.store;
    this.adapters = new Map(options.adapters.map((adapter) => [adapter.providerId, adapter]));
    this.now = options.now ?? Date.now;
    this.usageCacheTtlMs = options.usageCacheTtlMs ?? DEFAULT_USAGE_CACHE_TTL_MS;
  }

  async list(options: { refresh?: boolean } = {}): Promise<ProviderAccountsListResult> {
    const providers = await Promise.all(
      [...this.adapters.values()].map((adapter) => this.listProvider(adapter, options)),
    );
    return { fetchedAt: new Date(this.now()).toISOString(), providers };
  }

  /** Saves the login the provider CLI is using now, updating it when already saved. */
  addCurrent(providerId: string): Promise<ProviderAccount> {
    return this.serialize(async () => {
      const adapter = this.adapter(providerId);
      const live = await adapter.readLiveLogin();
      if (!live) {
        throw new ProviderAccountError(
          "no_live_login",
          `${adapter.displayName} has no active login to save`,
        );
      }
      if (!live.isUsable) {
        throw new ProviderAccountError(
          "live_login_unusable",
          `The active ${adapter.displayName} login has expired; log in again before saving it`,
        );
      }
      const record = await this.saveLiveLogin(adapter, live);
      this.forgetUsage(providerId, record.id);
      return this.summarize(adapter, record, true, null);
    });
  }

  /** Makes a saved login the provider CLI's active one. */
  activate(providerId: string, accountId: string): Promise<void> {
    return this.serialize(async () => {
      const adapter = this.adapter(providerId);
      const target = await this.requireAccount(providerId, accountId);
      if (target.reloginRequired) {
        throw new ProviderAccountError(
          "relogin_required",
          `${target.identity.email} needs a new login before it can be activated`,
        );
      }

      const live = await adapter.readLiveLogin();
      if (live && isSameAccount(live.identity, target.identity)) return;
      // Whatever is active gets saved first, so a switch never loses a login.
      if (live?.isUsable) {
        await this.saveLiveLogin(adapter, live);
      }

      const login = await this.freshLogin(adapter, target);
      await adapter.writeLiveLogin({ login, live });
      this.forgetUsage(providerId, target.id);
      this.logger.info({ providerId, email: target.identity.email }, "Activated saved login");
    });
  }

  remove(providerId: string, accountId: string): Promise<void> {
    return this.serialize(async () => {
      const adapter = this.adapter(providerId);
      const account = await this.requireAccount(providerId, accountId);
      const live = await adapter.readLiveLogin();
      if (live && isSameAccount(live.identity, account.identity)) {
        throw new ProviderAccountError(
          "account_active",
          "Switch to another account before removing this login",
        );
      }
      await this.store.remove(providerId, accountId);
      this.forgetUsage(providerId, accountId);
    });
  }

  private async listProvider(
    adapter: ProviderAccountAdapter,
    options: { refresh?: boolean },
  ): Promise<ProviderAccountsProvider> {
    try {
      const { live, records } = await this.serialize(async () => {
        const detected = await adapter.readLiveLogin();
        if (detected?.isUsable) await this.saveLiveLogin(adapter, detected);
        const saved = await this.store.list(adapter.providerId);
        return { live: detected, records: saved };
      });
      const activeRecord = live
        ? (records.find((record) => isSameAccount(record.identity, live.identity)) ?? null)
        : null;
      const usages = await Promise.all(
        records.map((record) =>
          this.usageFor(adapter, record, record.id === activeRecord?.id ? live : null, options),
        ),
      );
      // Usage lookup may have refreshed a login or marked it as needing a new one.
      const latest = new Map((await this.store.list(adapter.providerId)).map((r) => [r.id, r]));
      const accounts = records.map((record, index) =>
        this.summarize(
          adapter,
          latest.get(record.id) ?? record,
          record.id === activeRecord?.id,
          usages[index] ?? null,
        ),
      );
      const activeAccount = accounts.find((account) => account.isActive);
      return {
        providerId: adapter.providerId,
        displayName: adapter.displayName,
        liveLogin: live
          ? {
              email: live.identity.email,
              organizationName: live.identity.organizationName,
              accountId: activeRecord?.id ?? null,
              isUsable: live.isUsable,
              planLabel: activeAccount
                ? activeAccount.planLabel
                : adapter.planLabel(live.login, null),
              usage: activeAccount?.usage ?? null,
            }
          : null,
        accounts,
        error: null,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn({ err, providerId: adapter.providerId }, "Failed to list saved logins");
      return {
        providerId: adapter.providerId,
        displayName: adapter.displayName,
        liveLogin: null,
        accounts: [],
        error: err.message,
      };
    }
  }

  private summarize(
    adapter: ProviderAccountAdapter,
    record: StoredProviderAccount,
    isActive: boolean,
    usage: ProviderUsage | null,
  ): ProviderAccount {
    return {
      id: record.id,
      email: record.identity.email,
      organizationName: record.identity.organizationName,
      displayName: record.identity.displayName,
      planLabel: adapter.planLabel(adapter.parseLogin(record.login), usage),
      isActive,
      reloginRequired: record.reloginRequired,
      addedAt: record.addedAt,
      usage,
    };
  }

  private usageFor(
    adapter: ProviderAccountAdapter,
    record: StoredProviderAccount,
    live: ProviderLiveLogin<unknown> | null,
    options: { refresh?: boolean },
  ): Promise<ProviderUsage | null> {
    const key = usageKey(adapter.providerId, record.id);
    const cached = this.usageCache.get(key);
    if (!options.refresh && cached && this.now() - cached.fetchedAtMs < this.usageCacheTtlMs) {
      return Promise.resolve(cached.usage);
    }
    const inFlight = this.usageInFlight.get(key);
    if (inFlight) return inFlight;

    const request = this.fetchUsage(adapter, record, live)
      .then((usage) => {
        this.usageCache.set(key, { fetchedAtMs: this.now(), usage });
        return usage;
      })
      .finally(() => {
        if (this.usageInFlight.get(key) === request) this.usageInFlight.delete(key);
      });
    this.usageInFlight.set(key, request);
    return request;
  }

  private async fetchLiveUsage(
    adapter: ProviderAccountAdapter,
    live: ProviderLiveLogin<unknown>,
  ): Promise<ProviderUsage> {
    try {
      // The CLI owns this credential, including refreshes of expired access tokens.
      const outcome = await adapter.fetchUsage(live.login);
      return outcome.kind === "usage" ? outcome.usage : unavailableUsage(adapter);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return unavailableUsage({ ...adapter, error: message });
    }
  }

  private async fetchUsage(
    adapter: ProviderAccountAdapter,
    record: StoredProviderAccount,
    live: ProviderLiveLogin<unknown> | null,
  ): Promise<ProviderUsage | null> {
    try {
      if (live) {
        return this.fetchLiveUsage(adapter, live);
      }
      if (record.reloginRequired) return null;

      let login = adapter.parseLogin(record.login);
      if (adapter.isAccessTokenExpired(login, this.now())) {
        const refreshed = await this.refreshStoredLogin(adapter, record.id, login);
        if (!refreshed) return null;
        login = refreshed;
      }
      const outcome = await adapter.fetchUsage(login);
      if (outcome.kind === "usage") return outcome.usage;

      const refreshed = await this.refreshStoredLogin(adapter, record.id, login);
      if (!refreshed) return null;
      const retried = await adapter.fetchUsage(refreshed);
      return retried.kind === "usage" ? retried.usage : unavailableUsage(adapter);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.debug(
        { err, providerId: adapter.providerId, accountId: record.id },
        "Saved login usage fetch failed",
      );
      return unavailableUsage({ ...adapter, error: err.message });
    }
  }

  /**
   * Redeems a saved login's refresh token under the mutation lock, so a usage lookup
   * and an activation can never both redeem the same single-use token. `seen` is the
   * login the caller holds; when the store already has a newer one, that is returned
   * without a network call.
   */
  private refreshStoredLogin<TLogin>(
    adapter: ProviderAccountAdapter<TLogin>,
    accountId: string,
    seen: TLogin,
  ): Promise<TLogin | null> {
    return this.serialize(() => this.refreshRecord(adapter, accountId, seen));
  }

  /** The unlocked body of `refreshStoredLogin`, for callers already holding the lock. */
  private async refreshRecord<TLogin>(
    adapter: ProviderAccountAdapter<TLogin>,
    accountId: string,
    seen: TLogin,
  ): Promise<TLogin | null> {
    const record = await this.store.get(adapter.providerId, accountId);
    if (!record || record.reloginRequired) return null;
    const current = adapter.parseLogin(record.login);
    if (JSON.stringify(current) !== JSON.stringify(seen)) return current;

    const outcome = await adapter.refreshLogin(current);
    const updatedAt = new Date(this.now()).toISOString();
    if (outcome.kind === "relogin_required") {
      // Persisted so no later call burns a request on a token known to be dead.
      await this.store.save({ ...record, reloginRequired: true, updatedAt });
      return null;
    }
    await this.store.save({ ...record, login: outcome.login, updatedAt });
    return outcome.login;
  }

  /** The target's login with a live access token; runs inside the mutation lock. */
  private async freshLogin(
    adapter: ProviderAccountAdapter,
    record: StoredProviderAccount,
  ): Promise<unknown> {
    const login = adapter.parseLogin(record.login);
    if (!adapter.isAccessTokenExpired(login, this.now())) return login;
    const refreshed = await this.refreshRecord(adapter, record.id, login);
    if (refreshed === null) {
      throw new ProviderAccountError(
        "relogin_required",
        `${record.identity.email} needs a new login before it can be activated`,
      );
    }
    return refreshed;
  }

  private async saveLiveLogin(
    adapter: ProviderAccountAdapter,
    live: ProviderLiveLogin<unknown>,
  ): Promise<StoredProviderAccount> {
    const records = await this.store.list(adapter.providerId);
    const existing = records.find((record) => isSameAccount(record.identity, live.identity));
    const unchanged =
      existing &&
      !existing.reloginRequired &&
      JSON.stringify(existing.identity) === JSON.stringify(live.identity) &&
      JSON.stringify(existing.login) === JSON.stringify(live.login);
    if (unchanged) return existing;
    const at = new Date(this.now()).toISOString();
    const record: StoredProviderAccount = existing
      ? {
          ...existing,
          identity: live.identity,
          login: live.login,
          updatedAt: at,
          reloginRequired: false,
        }
      : {
          version: 1,
          id: createProviderAccountId(),
          providerId: adapter.providerId,
          identity: live.identity,
          login: live.login,
          addedAt: at,
          updatedAt: at,
          reloginRequired: false,
        };
    await this.store.save(record);
    this.forgetUsage(adapter.providerId, record.id);
    return record;
  }

  private adapter(providerId: string): ProviderAccountAdapter {
    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      throw new ProviderAccountError(
        "provider_not_found",
        `Provider ${providerId} does not support saved logins`,
      );
    }
    return adapter;
  }

  private async requireAccount(
    providerId: string,
    accountId: string,
  ): Promise<StoredProviderAccount> {
    const record = await this.store.get(providerId, accountId);
    if (!record) {
      throw new ProviderAccountError("account_not_found", `Saved login ${accountId} not found`);
    }
    return record;
  }

  private forgetUsage(providerId: string, accountId: string): void {
    this.usageCache.delete(usageKey(providerId, accountId));
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = this.mutation.then(work, work);
    this.mutation = run.catch(() => undefined);
    return run;
  }
}

function usageKey(providerId: string, accountId: string): string {
  return `${providerId}/${accountId}`;
}
