import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProviderUsage } from "../../../server/messages.js";
import { PRIVATE_FILE_MODE } from "../../../server/private-files.js";
import { CodexAccountAdapter, type CodexLogin } from "./adapter.js";

let codexHome: string;

beforeEach(() => {
  codexHome = mkdtempSync(join(tmpdir(), "codex-account-adapter-"));
});

afterEach(() => {
  rmSync(codexHome, { recursive: true, force: true });
});

const usage: ProviderUsage = {
  providerId: "codex",
  displayName: "Codex",
  status: "available",
  planLabel: "Pro",
  windows: [],
  balances: [],
  details: [],
  error: null,
};

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(claims)}.sig`;
}

function login(email: string, options: { accessExp?: number; plan?: string } = {}): CodexLogin {
  return {
    auth_mode: "chatgpt",
    tokens: {
      id_token: jwt({
        email,
        name: "Person",
        "https://api.openai.com/auth": {
          chatgpt_account_id: `acct-${email}`,
          chatgpt_user_id: `user-${email}`,
          chatgpt_plan_type: options.plan ?? "pro",
          organizations: [
            { id: "org-1", title: "Work", is_default: false },
            { id: "org-2", title: "Personal", is_default: true },
          ],
        },
      }),
      access_token: jwt({ exp: options.accessExp ?? 4_000_000_000 }),
      refresh_token: `rt_${email}`,
      account_id: `acct-${email}`,
    },
    last_refresh: "2026-01-01T00:00:00.000Z",
  };
}

function adapter(fetchApi?: typeof fetch) {
  return new CodexAccountAdapter({
    logger: pino({ level: "silent" }),
    usage: { fetchUsageForTokens: async () => usage },
    codexHome,
    fetch: fetchApi,
  });
}

describe("CodexAccountAdapter", () => {
  it("reads identity and plan from the id token in auth.json", async () => {
    const entry = login("a@example.com");
    writeFileSync(join(codexHome, "auth.json"), JSON.stringify(entry));

    const live = await adapter().readLiveLogin();

    expect(live).toEqual({
      identity: {
        email: "a@example.com",
        accountUuid: "user-a@example.com",
        organizationUuid: "acct-a@example.com",
        organizationName: "Personal",
        displayName: "Person",
      },
      login: entry,
      isUsable: true,
    });
    expect(adapter().planLabel(entry)).toBe("Pro");
  });

  it("has no live login without auth.json or with an API-key login", async () => {
    expect(await adapter().readLiveLogin()).toBeNull();
    writeFileSync(
      join(codexHome, "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-test" }),
    );
    expect(await adapter().readLiveLogin()).toBeNull();
  });

  it("detects access-token expiry from the token's exp claim", () => {
    const entry = login("a@x", { accessExp: 1_000 });
    expect(adapter().isAccessTokenExpired(entry, 1_000 * 1000 - 10 * 60 * 1000)).toBe(false);
    expect(adapter().isAccessTokenExpired(entry, 1_000 * 1000 - 60 * 1000)).toBe(true);
  });

  it("replaces auth.json privately on activation", async () => {
    const target = login("b@x");

    await adapter().writeLiveLogin({ login: target, live: null });

    const path = join(codexHome, "auth.json");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(target);
    expect(statSync(path).mode & 0o777).toBe(PRIVATE_FILE_MODE);
  });

  it("refreshes the token set and reports a rejected refresh as needing a new login", async () => {
    const refreshed = await adapter(
      (async () =>
        new Response(
          JSON.stringify({ id_token: "id2.x.y", access_token: "at2", refresh_token: "rt2" }),
          { status: 200 },
        )) as typeof fetch,
    ).refreshLogin(login("a@x"));
    expect(refreshed.kind).toBe("refreshed");
    if (refreshed.kind === "refreshed") {
      expect(refreshed.login.tokens).toMatchObject({
        id_token: "id2.x.y",
        access_token: "at2",
        refresh_token: "rt2",
        account_id: "acct-a@x",
      });
    }

    const rejected = await adapter(
      (async () => new Response("{}", { status: 401 })) as typeof fetch,
    ).refreshLogin(login("a@x"));
    expect(rejected).toEqual({ kind: "relogin_required" });
  });
});
