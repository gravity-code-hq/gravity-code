import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderUsage } from "../../../server/messages.js";
import { PRIVATE_FILE_MODE } from "../../../server/private-files.js";
import { ClaudeAccountAdapter, type ClaudeLogin } from "./adapter.js";
import { ClaudeKeychain, type KeychainCommandResult } from "./keychain.js";

let root: string;
let configDir: string;
let globalConfigPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "claude-account-adapter-"));
  configDir = join(root, ".claude");
  globalConfigPath = join(root, ".claude.json");
  mkdirSync(configDir);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const usage: ProviderUsage = {
  providerId: "claude",
  displayName: "Claude",
  status: "available",
  planLabel: "Max",
  windows: [],
  balances: [],
  details: [],
  error: null,
};

function login(email: string, accessToken = `at_${email}`): ClaudeLogin {
  return {
    credential: {
      claudeAiOauth: {
        accessToken,
        refreshToken: `rt_${email}`,
        expiresAt: 4_000_000_000_000,
        subscriptionType: "max",
        rateLimitTier: "default_5x",
      },
    },
    oauthAccount: {
      emailAddress: email,
      accountUuid: `uuid-${email}`,
      organizationUuid: `org-${email}`,
      organizationName: `Org ${email}`,
      displayName: email.split("@")[0]!,
    },
  };
}

function writeLive(entry: ClaudeLogin, extraConfig: Record<string, unknown> = {}) {
  writeFileSync(join(configDir, ".credentials.json"), JSON.stringify(entry.credential));
  writeFileSync(
    globalConfigPath,
    JSON.stringify({
      theme: "dark",
      projects: { "/x": {} },
      oauthAccount: entry.oauthAccount,
      ...extraConfig,
    }),
  );
}

function fileAdapter(options: { fetch?: typeof fetch } = {}) {
  return new ClaudeAccountAdapter({
    logger: pino({ level: "silent" }),
    usage: { fetchUsageForOauth: async () => usage },
    configDir,
    globalConfigPath,
    platform: "linux",
    fetch: options.fetch,
  });
}

describe("ClaudeAccountAdapter (file credentials)", () => {
  it("reads the live login from the credentials file and the global config", async () => {
    const entry = login("a@example.com");
    writeLive(entry);

    const live = await fileAdapter().readLiveLogin();

    expect(live).toEqual({
      identity: {
        email: "a@example.com",
        accountUuid: "uuid-a@example.com",
        organizationUuid: "org-a@example.com",
        organizationName: "Org a@example.com",
        displayName: "a",
      },
      login: entry,
      isUsable: true,
    });
  });

  it("has no live login without an account record or without a credential", async () => {
    writeFileSync(globalConfigPath, JSON.stringify({ theme: "dark" }));
    writeFileSync(join(configDir, ".credentials.json"), JSON.stringify(login("a@x").credential));
    expect(await fileAdapter().readLiveLogin()).toBeNull();

    writeLive(login("a@x"));
    rmSync(join(configDir, ".credentials.json"));
    expect(await fileAdapter().readLiveLogin()).toBeNull();
  });

  it("flags a login whose tokens Claude Code blanked as unusable", async () => {
    const entry = login("a@x");
    entry.credential.claudeAiOauth = { accessToken: "", refreshToken: "" };
    writeLive(entry);

    expect((await fileAdapter().readLiveLogin())?.isUsable).toBe(false);
  });

  it("writes the target credential privately and splices only oauthAccount into the config", async () => {
    const outgoing = login("a@x");
    outgoing.credential.mcpOAuth = { server: "live-token" };
    writeLive(outgoing, { primaryApiKey: "sk-ant-api03-old" });
    const adapter = fileAdapter();
    const live = await adapter.readLiveLogin();
    const target = login("b@x");
    target.credential.mcpOAuth = { server: "stale-token" };

    await adapter.writeLiveLogin({ login: target, live });

    const credentialPath = join(configDir, ".credentials.json");
    expect(JSON.parse(readFileSync(credentialPath, "utf8"))).toEqual({
      claudeAiOauth: target.credential.claudeAiOauth,
      mcpOAuth: { server: "live-token" },
    });
    expect(statSync(credentialPath).mode & 0o777).toBe(PRIVATE_FILE_MODE);
    expect(JSON.parse(readFileSync(globalConfigPath, "utf8"))).toEqual({
      theme: "dark",
      projects: { "/x": {} },
      oauthAccount: target.oauthAccount,
    });
    expect(existsSync(join(configDir, ".oauth_refresh.lock"))).toBe(false);
    expect(existsSync(`${configDir}.lock`)).toBe(false);
    expect(existsSync(`${globalConfigPath}.lock`)).toBe(false);
  });

  it("refuses to activate when the global config cannot be read back", async () => {
    writeFileSync(globalConfigPath, "{not json");

    await expect(fileAdapter().writeLiveLogin({ login: login("b@x"), live: null })).rejects.toThrow(
      "not valid JSON",
    );
    expect(readFileSync(globalConfigPath, "utf8")).toBe("{not json");
  });

  it("builds the plan label and reports usage through the shared fetcher", async () => {
    const adapter = fileAdapter();
    expect(adapter.planLabel(login("a@x"))).toBe("Max 5x");
    expect(await adapter.fetchUsage(login("a@x"))).toEqual({ kind: "usage", usage });
  });

  it("refreshes a login and reports a dead refresh token as needing a new login", async () => {
    const refreshed = fileAdapter({
      fetch: (async () =>
        new Response(JSON.stringify({ access_token: "at_new", expires_in: 60 }), {
          status: 200,
        })) as typeof fetch,
    });
    const outcome = await refreshed.refreshLogin(login("a@x"));
    expect(outcome.kind).toBe("refreshed");
    if (outcome.kind === "refreshed") {
      expect(outcome.login.credential.claudeAiOauth.accessToken).toBe("at_new");
      expect(outcome.login.oauthAccount.emailAddress).toBe("a@x");
    }

    const dead = fileAdapter({
      fetch: (async () =>
        new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as typeof fetch,
    });
    expect(await dead.refreshLogin(login("a@x"))).toEqual({ kind: "relogin_required" });
  });
});

describe("ClaudeAccountAdapter (macOS Keychain)", () => {
  function fakeKeychain(initial: string | null) {
    const state = { secret: initial, writes: 0, deletes: 0, failWrites: false };
    const run = vi.fn(async (args: string[], stdin?: string): Promise<KeychainCommandResult> => {
      if (args[0] === "find-generic-password") {
        return state.secret === null
          ? { exitCode: 44, stdout: "", stderr: "not found" }
          : { exitCode: 0, stdout: `${state.secret}\n`, stderr: "" };
      }
      if (args[0] === "-i" || args[0] === "add-generic-password") {
        if (state.failWrites) return { exitCode: 36, stdout: "", stderr: "no interaction" };
        const hex = /"-X" "([0-9a-f]+)"/.exec(stdin ?? "")?.[1] ?? args[args.length - 1]!;
        state.secret = Buffer.from(hex, "hex").toString("utf8");
        state.writes += 1;
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "delete-generic-password") {
        state.secret = null;
        state.deletes += 1;
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      throw new Error(`unexpected security call ${args.join(" ")}`);
    });
    return { state, keychain: new ClaudeKeychain({ account: "me", run }) };
  }

  function keychainAdapter(keychain: ClaudeKeychain) {
    return new ClaudeAccountAdapter({
      logger: pino({ level: "silent" }),
      usage: { fetchUsageForOauth: async () => usage },
      configDir,
      globalConfigPath,
      platform: "darwin",
      keychain,
      keychainServices: ["Claude Code-credentials"],
    });
  }

  it("prefers the Keychain over a stale credentials file", async () => {
    const stale = login("a@x", "at_stale");
    writeLive(stale);
    const { keychain } = fakeKeychain(JSON.stringify(login("a@x", "at_fresh").credential));

    const live = await keychainAdapter(keychain).readLiveLogin();

    expect(live?.login.credential.claudeAiOauth.accessToken).toBe("at_fresh");
  });

  it("writes to the Keychain and mirrors into an existing credentials file only", async () => {
    writeLive(login("a@x"));
    const { state, keychain } = fakeKeychain(JSON.stringify(login("a@x").credential));
    const adapter = keychainAdapter(keychain);
    const target = login("b@x");

    await adapter.writeLiveLogin({ login: target, live: await adapter.readLiveLogin() });
    expect(JSON.parse(state.secret ?? "")).toEqual(target.credential);
    expect(JSON.parse(readFileSync(join(configDir, ".credentials.json"), "utf8"))).toEqual(
      target.credential,
    );

    rmSync(join(configDir, ".credentials.json"));
    await adapter.writeLiveLogin({ login: login("c@x"), live: await adapter.readLiveLogin() });
    expect(existsSync(join(configDir, ".credentials.json"))).toBe(false);
    expect(state.writes).toBe(2);
  });

  it("falls back to the credentials file and clears the Keychain item when the write fails", async () => {
    writeFileSync(globalConfigPath, JSON.stringify({ oauthAccount: login("a@x").oauthAccount }));
    const { state, keychain } = fakeKeychain(JSON.stringify(login("a@x").credential));
    state.failWrites = true;
    const target = login("b@x");

    await keychainAdapter(keychain).writeLiveLogin({ login: target, live: null });

    expect(state.deletes).toBe(1);
    expect(JSON.parse(readFileSync(join(configDir, ".credentials.json"), "utf8"))).toEqual(
      target.credential,
    );
  });
});
