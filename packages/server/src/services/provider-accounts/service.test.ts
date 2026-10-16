import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProviderUsage } from "../../server/messages.js";
import { ClaudeQuotaProvider } from "../quota-fetcher/providers/claude.js";
import { ClaudeAccountAdapter } from "./claude/adapter.js";
import type {
  ProviderAccountAdapter,
  ProviderAccountIdentity,
  ProviderAccountRefreshOutcome,
  ProviderAccountUsageOutcome,
  ProviderLiveLogin,
  WriteLiveLoginInput,
} from "./adapter.js";
import { ProviderAccountError, ProviderAccountsService } from "./service.js";
import { ProviderAccountStore } from "./store.js";

interface FakeLogin {
  email: string;
  token: string;
  expiresAt: number;
}

function identity(email: string): ProviderAccountIdentity {
  return {
    email,
    accountUuid: null,
    organizationUuid: "org",
    organizationName: "Org",
    displayName: null,
  };
}

function usageFor(token: string): ProviderUsage {
  return {
    providerId: "fake",
    displayName: "Fake",
    status: "available",
    planLabel: null,
    windows: [{ id: "session", label: "Session", usedPct: 10, remainingPct: 90, resetsAt: null }],
    balances: [],
    details: [{ id: "token", label: "Token", value: token }],
    error: null,
  };
}

/**
 * An in-memory provider: `live` is what its CLI has active, `validTokens` is what the
 * usage API accepts, and `refreshable` is which refresh tokens still work.
 */
class FakeAdapter implements ProviderAccountAdapter<FakeLogin> {
  readonly providerId = "fake";
  readonly displayName = "Fake";
  live: ProviderLiveLogin<FakeLogin> | null = null;
  validTokens = new Set<string>();
  deadRefreshTokens = new Set<string>();
  usageCalls: string[] = [];
  refreshCalls: string[] = [];
  writes: WriteLiveLoginInput<FakeLogin>[] = [];
  refreshCounter = 0;

  setLive(email: string, token: string, options: { usable?: boolean } = {}) {
    this.live = {
      identity: identity(email),
      login: { email, token, expiresAt: Number.MAX_SAFE_INTEGER },
      isUsable: options.usable ?? true,
    };
    this.validTokens.add(token);
  }

  parseLogin(value: unknown): FakeLogin {
    return value as FakeLogin;
  }

  planLabel(): string | null {
    return "Plan";
  }

  isAccessTokenExpired(login: FakeLogin, nowMs: number): boolean {
    return nowMs >= login.expiresAt;
  }

  async readLiveLogin() {
    return this.live;
  }

  async writeLiveLogin(input: WriteLiveLoginInput<FakeLogin>) {
    this.writes.push(input);
    this.live = { identity: identity(input.login.email), login: input.login, isUsable: true };
  }

  async fetchUsage(login: FakeLogin): Promise<ProviderAccountUsageOutcome> {
    this.usageCalls.push(login.token);
    return this.validTokens.has(login.token)
      ? { kind: "usage", usage: usageFor(login.token) }
      : { kind: "needs_auth" };
  }

  async refreshLogin(login: FakeLogin): Promise<ProviderAccountRefreshOutcome<FakeLogin>> {
    this.refreshCalls.push(login.token);
    if (this.deadRefreshTokens.has(login.token)) return { kind: "relogin_required" };
    const token = `${login.email}#${++this.refreshCounter}`;
    this.validTokens.add(token);
    return {
      kind: "refreshed",
      login: { ...login, token, expiresAt: Number.MAX_SAFE_INTEGER },
    };
  }
}

let root: string;
let store: ProviderAccountStore;
let adapter: FakeAdapter;
let clock: number;
let service: ProviderAccountsService;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "provider-accounts-service-"));
  store = new ProviderAccountStore(root);
  adapter = new FakeAdapter();
  clock = 1_000_000;
  service = new ProviderAccountsService({
    logger: pino({ level: "silent" }),
    store,
    adapters: [adapter],
    // Each read of the clock moves it forward a millisecond so records added in
    // sequence sort deterministically.
    now: () => ++clock,
    usageCacheTtlMs: 60_000,
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function fakeProvider(options?: { refresh?: boolean }) {
  const result = await service.list(options);
  return result.providers[0]!;
}

describe("Claude account refresh", () => {
  it("refreshes the live plan and usage despite stale credential metadata and cached usage", async () => {
    const credentialPath = join(root, ".credentials.json");
    const credential = JSON.stringify({
      claudeAiOauth: {
        accessToken: "test-token",
        subscriptionType: "max",
        rateLimitTier: "default_claude_max_5x",
      },
    });
    writeFileSync(credentialPath, credential);
    const globalConfigPath = join(root, ".claude.json");
    writeFileSync(globalConfigPath, JSON.stringify({ oauthAccount: { emailAddress: "a@x" } }));
    let tier = "default_claude_max_5x";
    let percent = 8;
    let profileCalls = 0;
    let profileStatus = 200;
    const fetchApi: typeof fetch = async (url) => {
      if (url.toString() === "https://api.anthropic.com/api/oauth/profile") {
        profileCalls += 1;
        return Response.json(
          { organization: { organization_type: "claude_max", rate_limit_tier: tier } },
          { status: profileStatus },
        );
      }
      if (url.toString() === "https://api.anthropic.com/api/oauth/usage") {
        return Response.json({ seven_day: { utilization: percent } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };
    const logger = pino({ level: "silent" });
    const claude = new ClaudeAccountAdapter({
      logger,
      usage: new ClaudeQuotaProvider({ logger, fetch: fetchApi }),
      configDir: root,
      globalConfigPath,
      platform: "linux",
    });
    const accounts = new ProviderAccountsService({ logger, store, adapters: [claude] });

    const initial = await accounts.list();
    expect(initial.providers[0]?.accounts[0]?.planLabel).toBe("Max 5x");
    tier = "default_claude_max_20x";
    percent = 15;
    const cached = await accounts.list();
    expect(cached.providers[0]?.accounts[0]?.planLabel).toBe("Max 5x");

    const refreshed = await accounts.list({ refresh: true });
    expect(refreshed.providers[0]?.accounts[0]).toMatchObject({
      planLabel: "Max 20x",
      usage: {
        planLabel: "Max 20x",
        windows: [expect.objectContaining({ id: "weekly", usedPct: 15 })],
      },
    });
    expect(refreshed.providers[0]?.liveLogin?.planLabel).toBe("Max 20x");
    expect(profileCalls).toBe(2);
    expect(readFileSync(credentialPath, "utf8")).toBe(credential);

    profileStatus = 503;
    const failed = await accounts.list({ refresh: true });
    expect(failed.providers[0]?.accounts[0]).toMatchObject({
      planLabel: null,
      usage: { status: "error", error: "Claude profile API returned 503" },
    });
    profileStatus = 200;
    const retried = await accounts.list({ refresh: true });
    expect(retried.providers[0]?.accounts[0]).toMatchObject({
      planLabel: "Max 20x",
      usage: { status: "available", error: null },
    });
  });
});

describe("ProviderAccountsService.addCurrent", () => {
  it("saves the live login and reports it as the active account", async () => {
    adapter.setLive("a@x", "tok-a");

    const account = await service.addCurrent("fake");

    expect(account).toMatchObject({
      email: "a@x",
      organizationName: "Org",
      planLabel: "Plan",
      isActive: true,
      reloginRequired: false,
      usage: null,
    });
    expect(await store.list("fake")).toHaveLength(1);
  });

  it("updates an already saved account instead of duplicating it", async () => {
    adapter.setLive("a@x", "tok-old");
    const first = await service.addCurrent("fake");
    adapter.setLive("a@x", "tok-new");

    const second = await service.addCurrent("fake");

    expect(second.id).toBe(first.id);
    const [record] = await store.list("fake");
    expect(adapter.parseLogin(record!.login).token).toBe("tok-new");
  });

  it("refuses when there is no live login or its tokens are gone", async () => {
    await expect(service.addCurrent("fake")).rejects.toMatchObject({ code: "no_live_login" });
    adapter.setLive("a@x", "", { usable: false });
    await expect(service.addCurrent("fake")).rejects.toMatchObject({
      code: "live_login_unusable",
    });
    await expect(service.addCurrent("nope")).rejects.toBeInstanceOf(ProviderAccountError);
  });
});

describe("ProviderAccountsService.list", () => {
  it("marks the saved account matching the live login active and reads usage for each", async () => {
    adapter.setLive("a@x", "tok-a");
    await service.addCurrent("fake");
    adapter.setLive("b@x", "tok-b");
    await service.addCurrent("fake");

    const provider = await fakeProvider();

    expect(provider.liveLogin).toEqual({
      email: "b@x",
      organizationName: "Org",
      accountId: provider.accounts[1]!.id,
      isUsable: true,
      planLabel: "Plan",
      usage: usageFor("tok-b"),
    });
    expect(provider.accounts.map((a) => [a.email, a.isActive])).toEqual([
      ["a@x", false],
      ["b@x", true],
    ]);
    expect(provider.accounts.map((a) => a.usage?.details?.[0]?.value)).toEqual(["tok-a", "tok-b"]);
  });

  it("automatically saves a detected login and reports it active with usage", async () => {
    adapter.setLive("a@x", "tok-a");

    const provider = await fakeProvider();

    expect(provider.accounts).toHaveLength(1);
    expect(provider.liveLogin).toEqual({
      email: "a@x",
      organizationName: "Org",
      accountId: provider.accounts[0]!.id,
      isUsable: true,
      planLabel: "Plan",
      usage: usageFor("tok-a"),
    });
    expect(await store.list("fake")).toHaveLength(1);
    expect(adapter.refreshCalls).toEqual([]);
    expect(adapter.writes).toEqual([]);
  });

  it("retains each detected account, caches usage, and supports refresh", async () => {
    adapter.setLive("a@x", "tok-a");
    await fakeProvider();
    await fakeProvider();
    expect(adapter.usageCalls).toEqual(["tok-a"]);
    await fakeProvider({ refresh: true });
    expect(adapter.usageCalls).toEqual(["tok-a", "tok-a"]);
    adapter.setLive("b@x", "tok-b");
    const provider = await fakeProvider();
    expect(provider.liveLogin?.usage).toEqual(usageFor("tok-b"));
    expect(provider.accounts.map((account) => [account.email, account.isActive])).toEqual([
      ["a@x", false],
      ["b@x", true],
    ]);
    expect(await store.list("fake")).toHaveLength(2);
  });

  it("never refreshes an unsaved live credential rejected by the usage API", async () => {
    adapter.setLive("a@x", "tok-a");
    adapter.validTokens.clear();
    expect((await fakeProvider()).liveLogin?.usage?.status).toBe("unavailable");
    expect(adapter.refreshCalls).toEqual([]);
    expect(await store.list("fake")).toHaveLength(1);
  });

  it("updates rotated credentials without duplicating the saved account", async () => {
    adapter.setLive("a@x", "tok-a");
    const first = await fakeProvider();
    adapter.setLive("a@x", "tok-rotated");
    const second = await fakeProvider();
    expect(second.accounts).toHaveLength(1);
    expect(second.accounts[0]!.id).toBe(first.accounts[0]!.id);
    expect(second.accounts[0]!.usage).toEqual(usageFor("tok-rotated"));
    expect(adapter.parseLogin((await store.list("fake"))[0]!.login).token).toBe("tok-rotated");
  });

  it("does not save unusable credentials", async () => {
    adapter.setLive("a@x", "", { usable: false });
    expect((await fakeProvider()).accounts).toEqual([]);
    expect(await store.list("fake")).toEqual([]);
    expect(adapter.usageCalls).toEqual([]);
  });

  it("serves cached usage until it expires or a refresh is requested", async () => {
    adapter.setLive("a@x", "tok-a");
    await service.addCurrent("fake");

    await fakeProvider();
    await fakeProvider();
    expect(adapter.usageCalls).toHaveLength(1);

    await fakeProvider({ refresh: true });
    expect(adapter.usageCalls).toHaveLength(2);

    clock += 61_000;
    await fakeProvider();
    expect(adapter.usageCalls).toHaveLength(3);
  });

  it("refreshes an inactive login whose token expired and persists the new one", async () => {
    adapter.setLive("a@x", "tok-a");
    await service.addCurrent("fake");
    const [record] = await store.list("fake");
    await store.save({ ...record!, login: { email: "a@x", token: "tok-a", expiresAt: clock } });
    adapter.setLive("b@x", "tok-b");

    const provider = await fakeProvider();

    expect(adapter.refreshCalls).toEqual(["tok-a"]);
    expect(provider.accounts[0]!.usage?.details?.[0]?.value).toBe("a@x#1");
    const [saved] = await store.list("fake");
    expect(adapter.parseLogin(saved!.login).token).toBe("a@x#1");
  });

  it("refreshes once when the usage API rejects an inactive token", async () => {
    adapter.setLive("a@x", "tok-a");
    await service.addCurrent("fake");
    adapter.setLive("b@x", "tok-b");
    adapter.validTokens.delete("tok-a");

    const provider = await fakeProvider();

    expect([...adapter.usageCalls].sort()).toEqual(["a@x#1", "tok-a", "tok-b"]);
    expect(provider.accounts[0]!.usage?.status).toBe("available");
  });

  it("marks an account whose refresh token is dead and stops retrying it", async () => {
    adapter.setLive("a@x", "tok-a");
    await service.addCurrent("fake");
    adapter.setLive("b@x", "tok-b");
    adapter.validTokens.delete("tok-a");
    adapter.deadRefreshTokens.add("tok-a");

    const first = await fakeProvider({ refresh: true });
    const second = await fakeProvider({ refresh: true });

    expect(first.accounts[0]).toMatchObject({ reloginRequired: true, usage: null });
    expect(second.accounts[0]).toMatchObject({ reloginRequired: true, usage: null });
    expect(adapter.refreshCalls).toEqual(["tok-a"]);
    expect((await store.list("fake"))[0]!.reloginRequired).toBe(true);
  });

  it("never refreshes the active login even when the usage API rejects it", async () => {
    adapter.setLive("a@x", "tok-a");
    await service.addCurrent("fake");
    adapter.validTokens.delete("tok-a");

    const provider = await fakeProvider();

    expect(adapter.refreshCalls).toEqual([]);
    expect(provider.accounts[0]!.usage?.status).toBe("unavailable");
  });

  it("saves once and shares one usage fetch between concurrent listings", async () => {
    adapter.setLive("a@x", "tok-a");

    await Promise.all([fakeProvider(), fakeProvider(), fakeProvider()]);

    expect(adapter.usageCalls).toHaveLength(1);
    expect(await store.list("fake")).toHaveLength(1);
  });

  it("reports a provider whose live login cannot be read without dropping the others", async () => {
    adapter.readLiveLogin = async () => {
      throw new Error("Keychain locked");
    };

    const provider = await fakeProvider();

    expect(provider).toEqual({
      providerId: "fake",
      displayName: "Fake",
      liveLogin: null,
      accounts: [],
      error: "Keychain locked",
    });
  });
});

describe("ProviderAccountsService.activate", () => {
  async function saveTwo() {
    adapter.setLive("a@x", "tok-a");
    const a = await service.addCurrent("fake");
    adapter.setLive("b@x", "tok-b");
    const b = await service.addCurrent("fake");
    return { a, b };
  }

  async function stored(email: string) {
    const record = (await store.list("fake")).find((entry) => entry.identity.email === email);
    if (!record) throw new Error(`no saved login for ${email}`);
    return record;
  }

  it("snapshots the outgoing live login and writes the target", async () => {
    const { a } = await saveTwo();
    adapter.setLive("b@x", "tok-b-rotated");

    await service.activate("fake", a.id);

    expect(adapter.writes).toHaveLength(1);
    expect(adapter.writes[0]!.login.token).toBe("tok-a");
    expect(adapter.writes[0]!.live?.login.token).toBe("tok-b-rotated");
    expect(adapter.parseLogin((await stored("b@x")).login).token).toBe("tok-b-rotated");
    expect((await fakeProvider()).accounts.map((acc) => acc.isActive)).toEqual([true, false]);
  });

  it("saves an unsaved live login before switching away from it", async () => {
    adapter.setLive("a@x", "tok-a");
    const a = await service.addCurrent("fake");
    adapter.setLive("c@x", "tok-c");

    await service.activate("fake", a.id);

    expect((await store.list("fake")).map((r) => r.identity.email)).toEqual(["a@x", "c@x"]);
  });

  it("is a no-op when the target is already active", async () => {
    const { b } = await saveTwo();

    await service.activate("fake", b.id);

    expect(adapter.writes).toEqual([]);
  });

  it("refreshes an expired target before handing it to the CLI", async () => {
    const { a } = await saveTwo();
    const record = await stored("a@x");
    await store.save({ ...record, login: { email: "a@x", token: "tok-a", expiresAt: clock } });

    await service.activate("fake", a.id);

    expect(adapter.writes[0]!.login.token).toBe("a@x#1");
  });

  it("refuses accounts that need a new login and unknown accounts", async () => {
    const { a } = await saveTwo();
    await store.save({ ...(await stored("a@x")), reloginRequired: true });

    await expect(service.activate("fake", a.id)).rejects.toMatchObject({
      code: "relogin_required",
    });
    await expect(service.activate("fake", "acc_missing")).rejects.toMatchObject({
      code: "account_not_found",
    });
    expect(adapter.writes).toEqual([]);
  });

  it("refuses when the refresh needed for activation is rejected", async () => {
    const { a } = await saveTwo();
    const record = await stored("a@x");
    await store.save({ ...record, login: { email: "a@x", token: "tok-a", expiresAt: clock } });
    adapter.deadRefreshTokens.add("tok-a");

    await expect(service.activate("fake", a.id)).rejects.toMatchObject({
      code: "relogin_required",
    });
    expect((await stored("a@x")).reloginRequired).toBe(true);
  });
});

describe("ProviderAccountsService concurrency", () => {
  it("never redeems one refresh token twice when usage lookup and activation overlap", async () => {
    adapter.setLive("a@x", "tok-a");
    const a = await service.addCurrent("fake");
    adapter.setLive("b@x", "tok-b");
    await service.addCurrent("fake");
    const record = (await store.list("fake")).find((r) => r.identity.email === "a@x")!;
    await store.save({ ...record, login: { email: "a@x", token: "tok-a", expiresAt: clock } });

    const [listed] = await Promise.all([service.list(), service.activate("fake", a.id)]);

    expect(adapter.refreshCalls).toEqual(["tok-a"]);
    const written = adapter.writes[0]!.login.token;
    const stored = adapter.parseLogin((await store.get("fake", a.id))!.login).token;
    expect(written).toBe("a@x#1");
    expect(stored).toBe("a@x#1");
    const summary = listed.providers[0]!.accounts.find((acc) => acc.email === "a@x")!;
    expect(summary.usage?.details?.[0]?.value).toBe("a@x#1");
  });
});

describe("ProviderAccountsService.remove", () => {
  it("requires switching away before removing an automatically saved active login", async () => {
    adapter.setLive("a@x", "tok-a");
    const provider = await fakeProvider();
    await expect(service.remove("fake", provider.accounts[0]!.id)).rejects.toMatchObject({
      code: "account_active",
    });
    expect(await store.list("fake")).toHaveLength(1);
  });

  it("removes a saved login and leaves the CLI's active login alone", async () => {
    adapter.setLive("a@x", "tok-a");
    const a = await service.addCurrent("fake");
    adapter.setLive("b@x", "tok-b");

    await service.remove("fake", a.id);

    expect(await store.list("fake")).toEqual([]);
    expect(adapter.live?.login.token).toBe("tok-b");
    await expect(service.remove("fake", a.id)).rejects.toMatchObject({
      code: "account_not_found",
    });
  });
});
