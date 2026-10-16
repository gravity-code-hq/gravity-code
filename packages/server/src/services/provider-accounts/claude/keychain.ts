import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const KEYCHAIN_TIMEOUT_MS = 5_000;
const SECURITY_BINARY = "/usr/bin/security";
// `security -i` reads commands from stdin with a 4096-byte line buffer. Longer lines are
// silently truncated, so bigger values go through argv instead.
const SECURITY_STDIN_LINE_LIMIT = 4096 - 64;
const NOT_FOUND_EXIT_CODE = 44;

export const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";

// Keep this in sync with Claude Code's Keychain account derivation.
const CLAUDE_KEYCHAIN_ACCOUNT_PATTERN = /^[a-zA-Z0-9._-]+$/;
const CLAUDE_KEYCHAIN_FALLBACK_ACCOUNT = "claude-code-user";

const OauthTokenPresenceSchema = z.object({
  claudeAiOauth: z.object({ accessToken: z.string().optional() }).optional(),
});

export function claudeKeychainAccount(
  user: string = process.env["USER"] || userInfo().username,
): string {
  return CLAUDE_KEYCHAIN_ACCOUNT_PATTERN.test(user) ? user : CLAUDE_KEYCHAIN_FALLBACK_ACCOUNT;
}

/**
 * Keychain services Claude Code may have stored the login under, most specific first.
 *
 * With `CLAUDE_CONFIG_DIR` set, Claude Code suffixes the service with a hash of the raw
 * (NFC-normalized, unresolved) directory string. A config dir that resolves to the default
 * `~/.claude` may still have been written under the plain name by an older launch.
 */
export function claudeKeychainServices(configDir: string | undefined): string[] {
  if (!configDir) return [CLAUDE_KEYCHAIN_SERVICE];
  const digest = createHash("sha256").update(configDir.normalize("NFC"), "utf8").digest("hex");
  const hashed = `${CLAUDE_KEYCHAIN_SERVICE}-${digest.slice(0, 8)}`;
  const isDefaultDir = resolve(configDir) === join(homedir(), ".claude");
  return isDefaultDir ? [hashed, CLAUDE_KEYCHAIN_SERVICE] : [hashed];
}

export class KeychainError extends Error {
  constructor(
    readonly operation: "read" | "write" | "delete",
    readonly exitCode: number | null,
    message: string,
  ) {
    super(message);
    this.name = "KeychainError";
  }
}

export interface KeychainCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Runs `/usr/bin/security` with the given args; `stdin` is piped when provided. */
export type KeychainCommandRunner = (
  args: string[],
  stdin?: string,
) => Promise<KeychainCommandResult>;

export async function runSecurity(args: string[], stdin?: string): Promise<KeychainCommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(SECURITY_BINARY, args, {
      timeout: KEYCHAIN_TIMEOUT_MS,
      ...(stdin === undefined ? {} : { input: stdin }),
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
    return {
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      stdout: typeof failure.stdout === "string" ? failure.stdout : "",
      stderr: typeof failure.stderr === "string" ? failure.stderr : "",
    };
  }
}

export interface ClaudeKeychainOptions {
  account?: string;
  run?: KeychainCommandRunner;
}

/** Generic-password access for one Keychain service, as Claude Code itself uses it. */
export class ClaudeKeychain {
  private readonly account: string;
  private readonly run: KeychainCommandRunner;

  constructor(options: ClaudeKeychainOptions = {}) {
    this.account = options.account ?? claudeKeychainAccount();
    this.run = options.run ?? runSecurity;
  }

  /** The stored secret, or null when no item exists for this account and service. */
  async read(service: string): Promise<string | null> {
    const result = await this.run([
      "find-generic-password",
      "-a",
      this.account,
      "-w",
      "-s",
      service,
    ]);
    if (result.exitCode === NOT_FOUND_EXIT_CODE) return null;
    if (result.exitCode !== 0) {
      throw new KeychainError("read", result.exitCode, keychainFailureMessage(result));
    }
    // `security -w` appends exactly one newline to the secret.
    return result.stdout.replace(/\n$/, "");
  }

  /** The account-less item older Claude Code versions wrote, or null when absent. */
  async readLegacy(service: string): Promise<string | null> {
    const result = await this.run(["find-generic-password", "-w", "-s", service]);
    if (result.exitCode === NOT_FOUND_EXIT_CODE) return null;
    if (result.exitCode !== 0) {
      throw new KeychainError("read", result.exitCode, keychainFailureMessage(result));
    }
    return result.stdout.replace(/\n$/, "");
  }

  async write(service: string, secret: string): Promise<void> {
    const hex = Buffer.from(secret, "utf8").toString("hex");
    const args = ["add-generic-password", "-U", "-a", this.account, "-s", service, "-X", hex];
    const line = `${args.map(quoteSecurityArg).join(" ")}\n`;
    // Interactive mode keeps the secret out of the process table.
    const result =
      Buffer.byteLength(line, "utf8") <= SECURITY_STDIN_LINE_LIMIT
        ? await this.run(["-i"], line)
        : await this.run(args);
    if (result.exitCode !== 0) {
      throw new KeychainError("write", result.exitCode, keychainFailureMessage(result));
    }
  }

  async delete(service: string): Promise<void> {
    const result = await this.run(["delete-generic-password", "-a", this.account, "-s", service]);
    if (result.exitCode !== 0 && result.exitCode !== NOT_FOUND_EXIT_CODE) {
      throw new KeychainError("delete", result.exitCode, keychainFailureMessage(result));
    }
  }
}

function quoteSecurityArg(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function keychainFailureMessage(result: KeychainCommandResult): string {
  const detail = result.stderr.trim() || result.stdout.trim();
  return detail
    ? `security exited with ${result.exitCode}: ${detail}`
    : `security exited with ${result.exitCode}`;
}

/**
 * The first Keychain item that carries an OAuth access token, trying the account-scoped
 * item under each candidate service and then the legacy account-less item.
 */
export async function readClaudeKeychainCredentials(
  keychain: ClaudeKeychain,
  services: string[] = claudeKeychainServices(process.env["CLAUDE_CONFIG_DIR"]),
): Promise<string | null> {
  for (const service of services) {
    const raw = await readIgnoringFailures(() => keychain.read(service));
    if (raw && carriesAccessToken(raw)) return raw;
  }
  const legacy = await readIgnoringFailures(() =>
    keychain.readLegacy(services[0] ?? CLAUDE_KEYCHAIN_SERVICE),
  );
  return legacy && carriesAccessToken(legacy) ? legacy : null;
}

async function readIgnoringFailures(read: () => Promise<string | null>): Promise<string | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof KeychainError) return null;
    throw error;
  }
}

function carriesAccessToken(raw: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  const result = OauthTokenPresenceSchema.safeParse(parsed);
  return result.success && Boolean(result.data.claudeAiOauth?.accessToken);
}
