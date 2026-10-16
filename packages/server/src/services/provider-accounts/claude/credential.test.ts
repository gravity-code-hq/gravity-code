import { describe, expect, it, vi } from "vitest";
import {
  ClaudeCredentialSchema,
  isClaudeAccessTokenExpired,
  isClaudeCredentialUsable,
  mergeSharedCredentialState,
  refreshClaudeCredential,
} from "./credential.js";

function credential(overrides: Record<string, unknown> = {}) {
  return ClaudeCredentialSchema.parse({
    claudeAiOauth: {
      accessToken: "at_1",
      refreshToken: "rt_1",
      expiresAt: 10_000_000,
      scopes: ["user:inference"],
      subscriptionType: "max",
    },
    ...overrides,
  });
}

describe("isClaudeCredentialUsable", () => {
  it("is false once Claude Code has blanked both tokens", () => {
    expect(
      isClaudeCredentialUsable(
        ClaudeCredentialSchema.parse({ claudeAiOauth: { accessToken: "", refreshToken: "" } }),
      ),
    ).toBe(false);
    expect(isClaudeCredentialUsable(credential())).toBe(true);
  });
});

describe("isClaudeAccessTokenExpired", () => {
  it("counts a token as expired five minutes before the server does", () => {
    expect(isClaudeAccessTokenExpired(credential(), 10_000_000 - 6 * 60 * 1000)).toBe(false);
    expect(isClaudeAccessTokenExpired(credential(), 10_000_000 - 4 * 60 * 1000)).toBe(true);
  });

  it("never expires a credential with no expiry", () => {
    expect(
      isClaudeAccessTokenExpired(credential({ claudeAiOauth: { accessToken: "at" } }), 1),
    ).toBe(false);
  });
});

describe("mergeSharedCredentialState", () => {
  it("takes machine-shared OAuth state from the live login and keeps the target's own", () => {
    const target = credential({ mcpOAuth: { old: true }, trustedDeviceToken: "device-b" });
    const live = credential({
      claudeAiOauth: { accessToken: "at_live" },
      mcpOAuth: { fresh: true },
      pluginSecrets: { p: 1 },
    });

    const merged = mergeSharedCredentialState(target, live);

    expect(merged).toEqual({
      claudeAiOauth: target.claudeAiOauth,
      trustedDeviceToken: "device-b",
      mcpOAuth: { fresh: true },
      pluginSecrets: { p: 1 },
    });
  });

  it("drops shared keys the machine no longer has instead of resurrecting them", () => {
    const target = credential({ mcpOAuth: { stale: true } });

    expect(mergeSharedCredentialState(target, credential())).toEqual({
      claudeAiOauth: target.claudeAiOauth,
    });
    expect(mergeSharedCredentialState(target, null)).toEqual({
      claudeAiOauth: target.claudeAiOauth,
    });
  });
});

describe("refreshClaudeCredential", () => {
  it("posts the refresh grant and merges the new tokens over the credential", async () => {
    const fetchApi = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "at_2",
            refresh_token: "rt_2",
            expires_in: 3600,
            scope: "user:inference user:profile",
          }),
          { status: 200 },
        ),
    );

    const outcome = await refreshClaudeCredential(fetchApi as never, credential(), 5_000);

    expect(outcome).toEqual({
      kind: "refreshed",
      credential: {
        claudeAiOauth: {
          accessToken: "at_2",
          refreshToken: "rt_2",
          expiresAt: 5_000 + 3600 * 1000,
          scopes: ["user:inference", "user:profile"],
          subscriptionType: "max",
        },
      },
    });
    const [url, init] = fetchApi.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://platform.claude.com/v1/oauth/token");
    expect(JSON.parse(String(init.body))).toEqual({
      grant_type: "refresh_token",
      refresh_token: "rt_1",
      client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    });
  });

  it("keeps the old refresh token when the server does not rotate it", async () => {
    const fetchApi = async () =>
      new Response(JSON.stringify({ access_token: "at_2", expires_in: 60 }), { status: 200 });

    const outcome = await refreshClaudeCredential(fetchApi as never, credential(), 0);

    expect(outcome.kind).toBe("refreshed");
    if (outcome.kind === "refreshed") {
      expect(outcome.credential.claudeAiOauth.refreshToken).toBe("rt_1");
    }
  });

  it("reports a dead refresh token as rejected", async () => {
    const fetchApi = async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });

    expect(await refreshClaudeCredential(fetchApi as never, credential(), 0)).toEqual({
      kind: "rejected",
      reason: "invalid_grant",
    });
  });

  it("is rejected without a refresh token and throws on transient failures", async () => {
    expect(
      await refreshClaudeCredential(
        (async () => new Response(null, { status: 500 })) as never,
        credential({ claudeAiOauth: { accessToken: "at" } }),
        0,
      ),
    ).toEqual({ kind: "rejected", reason: "no_refresh_token" });

    await expect(
      refreshClaudeCredential(
        (async () => new Response("bad gateway", { status: 502 })) as never,
        credential(),
        0,
      ),
    ).rejects.toThrow("Claude token refresh returned 502");
  });
});
