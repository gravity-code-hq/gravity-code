import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLAUDE_KEYCHAIN_SERVICE,
  ClaudeKeychain,
  KeychainError,
  claudeKeychainAccount,
  claudeKeychainServices,
  readClaudeKeychainCredentials,
  type KeychainCommandResult,
} from "./keychain.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

function ok(stdout: string): KeychainCommandResult {
  return { exitCode: 0, stdout, stderr: "" };
}

function notFound(): KeychainCommandResult {
  return { exitCode: 44, stdout: "", stderr: "The specified item could not be found" };
}

describe("claudeKeychainAccount", () => {
  it("uses a supported username verbatim", () => {
    expect(claudeKeychainAccount("thomas.benoit")).toBe("thomas.benoit");
  });

  it("falls back to claude-code-user when the username carries a rejected character", () => {
    expect(claudeKeychainAccount("first.last@example.com")).toBe("claude-code-user");
  });

  it("reads the username from $USER when no account is given", () => {
    vi.stubEnv("USER", "ci-runner");
    expect(claudeKeychainAccount()).toBe("ci-runner");
  });
});

describe("claudeKeychainServices", () => {
  it("is the plain service without a config dir override", () => {
    expect(claudeKeychainServices(undefined)).toEqual([CLAUDE_KEYCHAIN_SERVICE]);
  });

  it("hashes a custom config dir into the service name", () => {
    const [service, ...rest] = claudeKeychainServices("/srv/claude-work");
    expect(service).toMatch(/^Claude Code-credentials-[0-9a-f]{8}$/);
    expect(rest).toEqual([]);
  });

  it("keeps the plain service as a fallback when the override is the default dir", () => {
    const services = claudeKeychainServices(join(homedir(), ".claude"));
    expect(services).toHaveLength(2);
    expect(services[1]).toBe(CLAUDE_KEYCHAIN_SERVICE);
  });
});

describe("ClaudeKeychain", () => {
  it("reads the account item and strips the trailing newline security adds", async () => {
    const run = vi.fn(async () => ok('{"claudeAiOauth":{"accessToken":"at"}}\n'));
    const keychain = new ClaudeKeychain({ account: "me", run });

    expect(await keychain.read("svc")).toBe('{"claudeAiOauth":{"accessToken":"at"}}');
    expect(run).toHaveBeenCalledWith(["find-generic-password", "-a", "me", "-w", "-s", "svc"]);
  });

  it("is null when the item does not exist", async () => {
    const keychain = new ClaudeKeychain({ account: "me", run: async () => notFound() });
    expect(await keychain.read("svc")).toBeNull();
  });

  it("throws a KeychainError on any other failure", async () => {
    const keychain = new ClaudeKeychain({
      account: "me",
      run: async () => ({ exitCode: 36, stdout: "", stderr: "User interaction is not allowed" }),
    });
    await expect(keychain.read("svc")).rejects.toBeInstanceOf(KeychainError);
  });

  it("writes through security's stdin so the secret stays out of the process table", async () => {
    const run = vi.fn(async () => ok(""));
    const keychain = new ClaudeKeychain({ account: "me", run });

    await keychain.write("svc", '{"a":1}');

    const hex = Buffer.from('{"a":1}', "utf8").toString("hex");
    expect(run).toHaveBeenCalledWith(
      ["-i"],
      `"add-generic-password" "-U" "-a" "me" "-s" "svc" "-X" "${hex}"\n`,
    );
  });

  it("falls back to argv when the value would overflow security's line buffer", async () => {
    const run = vi.fn(async () => ok(""));
    const keychain = new ClaudeKeychain({ account: "me", run });
    const secret = "x".repeat(3_000);

    await keychain.write("svc", secret);

    const [args, stdin] = run.mock.calls[0]!;
    expect(stdin).toBeUndefined();
    expect(args.slice(0, 7)).toEqual(["add-generic-password", "-U", "-a", "me", "-s", "svc", "-X"]);
  });

  it("treats a missing item as a successful delete", async () => {
    const keychain = new ClaudeKeychain({ account: "me", run: async () => notFound() });
    await expect(keychain.delete("svc")).resolves.toBeUndefined();
  });
});

describe("readClaudeKeychainCredentials", () => {
  const token = JSON.stringify({ claudeAiOauth: { accessToken: "at_fresh" } });

  it("returns the account item under the first service that carries a token", async () => {
    const run = vi.fn(async (args: string[]) => (args.includes("-a") ? ok(token) : notFound()));
    const keychain = new ClaudeKeychain({ account: "me", run });

    expect(await readClaudeKeychainCredentials(keychain, ["svc"])).toBe(token);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("falls back to the account-less legacy item", async () => {
    const run = vi.fn(async (args: string[]) => (args.includes("-a") ? notFound() : ok(token)));
    const keychain = new ClaudeKeychain({ account: "me", run });

    expect(await readClaudeKeychainCredentials(keychain, ["svc"])).toBe(token);
    expect(run).toHaveBeenLastCalledWith(["find-generic-password", "-w", "-s", "svc"]);
  });

  it("skips items that carry no access token", async () => {
    const run = vi.fn(async (args: string[]) =>
      args.includes("-a")
        ? ok(JSON.stringify({ claudeAiOauth: { subscriptionType: "team" } }))
        : ok(token),
    );
    const keychain = new ClaudeKeychain({ account: "me", run });

    expect(await readClaudeKeychainCredentials(keychain, ["svc"])).toBe(token);
  });

  it("is null when nothing usable is stored", async () => {
    const keychain = new ClaudeKeychain({ account: "me", run: async () => notFound() });
    expect(await readClaudeKeychainCredentials(keychain, ["svc"])).toBeNull();
  });
});
