import { promises as fs } from "node:fs";
import { join } from "node:path";

/**
 * Claude Code guards its credential and config writes with `proper-lockfile`-style
 * directory locks. A switch takes the same locks, in the same order, so it never
 * interleaves with a token refresh in a running Claude Code process.
 *
 * Protocol: `mkdir` is the mutex; a lock whose mtime is older than its staleness window
 * is considered abandoned and removed; the holder touches the directory while it works.
 */
const CREDENTIALS_STALENESS_MS = 60_000;
const CONFIG_STALENESS_MS = 10_000;
const TOUCH_INTERVAL_MS = 3_000;
const ACQUIRE_TIMEOUT_MS = 9_000;
const RETRY_MIN_MS = 250;
const RETRY_MAX_MS = 500;

export class ClaudeLockTimeoutError extends Error {
  constructor(readonly lockPath: string) {
    super(`Timed out waiting for Claude Code lock ${lockPath}`);
    this.name = "ClaudeLockTimeoutError";
  }
}

export interface ClaudeLockPaths {
  /** `<configDir>/.oauth_refresh.lock`, the primary credential lock (Claude Code 2.1.218+). */
  oauthRefresh: string;
  /** `<configDir>.lock`, the legacy credential lock Claude Code still takes. */
  legacyCredentials: string;
  /** `<globalConfig>.lock`, guarding `~/.claude.json` writes. */
  config: string;
}

export function claudeLockPaths(configDir: string, globalConfigPath: string): ClaudeLockPaths {
  return {
    oauthRefresh: join(configDir, ".oauth_refresh.lock"),
    legacyCredentials: `${configDir}.lock`,
    config: `${globalConfigPath}.lock`,
  };
}

interface AcquireOptions {
  stalenessMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireDirectoryLock(
  lockPath: string,
  options: AcquireOptions,
): Promise<() => Promise<void>> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const deadline = now() + ACQUIRE_TIMEOUT_MS;

  for (;;) {
    try {
      await fs.mkdir(lockPath);
      break;
    } catch (error) {
      if (!isExistsError(error)) throw error;
    }
    if (await removeIfStale(lockPath, options.stalenessMs, now)) continue;
    if (now() >= deadline) throw new ClaudeLockTimeoutError(lockPath);
    await sleep(RETRY_MIN_MS + Math.random() * (RETRY_MAX_MS - RETRY_MIN_MS));
  }

  const touch = setInterval(() => {
    const at = new Date(now());
    void fs.utimes(lockPath, at, at).catch(() => undefined);
  }, TOUCH_INTERVAL_MS);
  touch.unref();

  return async () => {
    clearInterval(touch);
    await fs.rmdir(lockPath).catch(() => undefined);
  };
}

async function removeIfStale(
  lockPath: string,
  stalenessMs: number,
  now: () => number,
): Promise<boolean> {
  let mtimeMs: number;
  try {
    mtimeMs = (await fs.stat(lockPath)).mtimeMs;
  } catch {
    // Released between our mkdir and stat; retry the mkdir.
    return true;
  }
  if (now() - mtimeMs < stalenessMs) return false;
  await fs.rmdir(lockPath).catch(() => undefined);
  return true;
}

function isExistsError(error: unknown): boolean {
  return (error as { code?: unknown }).code === "EEXIST";
}

export interface ClaudeLocksOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Runs `work` while holding Claude Code's credential locks and its config lock, in the
 * order Claude Code takes them. Nothing inside `work` may do network I/O: the locks are
 * stale after 60 seconds and Claude Code will steal them.
 */
export async function withClaudeLocks<T>(
  paths: ClaudeLockPaths,
  work: () => Promise<T>,
  options: ClaudeLocksOptions = {},
): Promise<T> {
  const releases: Array<() => Promise<void>> = [];
  const plan: Array<{ path: string; stalenessMs: number }> = [
    { path: paths.oauthRefresh, stalenessMs: CREDENTIALS_STALENESS_MS },
    { path: paths.legacyCredentials, stalenessMs: CREDENTIALS_STALENESS_MS },
    { path: paths.config, stalenessMs: CONFIG_STALENESS_MS },
  ];
  try {
    for (const step of plan) {
      releases.push(await acquireDirectoryLock(step.path, { ...options, ...step }));
    }
    return await work();
  } finally {
    for (const release of releases.toReversed()) {
      await release();
    }
  }
}
