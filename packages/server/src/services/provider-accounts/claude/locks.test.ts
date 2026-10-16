import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaudeLockTimeoutError, claudeLockPaths, withClaudeLocks } from "./locks.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "claude-locks-"));
  mkdirSync(join(root, ".claude"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function paths() {
  return claudeLockPaths(join(root, ".claude"), join(root, ".claude.json"));
}

describe("withClaudeLocks", () => {
  it("holds all three Claude Code locks during work and releases them after", async () => {
    const lockPaths = paths();
    let heldDuringWork: boolean[] = [];

    await withClaudeLocks(lockPaths, async () => {
      heldDuringWork = [
        existsSync(lockPaths.oauthRefresh),
        existsSync(lockPaths.legacyCredentials),
        existsSync(lockPaths.config),
      ];
    });

    expect(heldDuringWork).toEqual([true, true, true]);
    expect(existsSync(lockPaths.oauthRefresh)).toBe(false);
    expect(existsSync(lockPaths.legacyCredentials)).toBe(false);
    expect(existsSync(lockPaths.config)).toBe(false);
  });

  it("releases the locks it took when work throws", async () => {
    const lockPaths = paths();

    await expect(
      withClaudeLocks(lockPaths, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(existsSync(lockPaths.oauthRefresh)).toBe(false);
    expect(existsSync(lockPaths.config)).toBe(false);
  });

  it("steals a lock whose holder stopped touching it", async () => {
    const lockPaths = paths();
    mkdirSync(lockPaths.oauthRefresh);
    const stale = new Date(Date.now() - 5 * 60 * 1000);
    utimesSync(lockPaths.oauthRefresh, stale, stale);

    let ran = false;
    await withClaudeLocks(lockPaths, async () => {
      ran = true;
    });

    expect(ran).toBe(true);
    expect(existsSync(lockPaths.oauthRefresh)).toBe(false);
  });

  it("waits for a live lock and gives up at the deadline", async () => {
    const lockPaths = paths();
    mkdirSync(lockPaths.oauthRefresh);
    let clock = 1_000_000;
    // A fresh mtime relative to the fake clock; the deadline lands well inside the
    // 60-second staleness window, so the lock is never stolen.
    utimesSync(lockPaths.oauthRefresh, new Date(clock), new Date(clock));
    const sleeps: number[] = [];

    await expect(
      withClaudeLocks(lockPaths, async () => undefined, {
        now: () => clock,
        sleep: async (ms) => {
          sleeps.push(ms);
          clock += 5_000;
        },
      }),
    ).rejects.toBeInstanceOf(ClaudeLockTimeoutError);

    expect(sleeps.length).toBeGreaterThan(0);
    expect(existsSync(lockPaths.oauthRefresh)).toBe(true);
    expect(existsSync(lockPaths.legacyCredentials)).toBe(false);
    expect(existsSync(lockPaths.config)).toBe(false);
  });
});
