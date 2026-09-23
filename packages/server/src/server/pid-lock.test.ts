import { mkdtemp, open, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { describe, expect, test } from "vitest";

import {
  acquirePidLock,
  getPidLockInfo,
  isLocked,
  PidLockError,
  refreshPidLock,
  releasePidLock,
  updatePidLock,
} from "./pid-lock.js";

describe("pid-lock ownership", () => {
  test.skipIf(process.platform === "win32")(
    "keeps a suspended owner's lock but reclaims it after the owner becomes a zombie",
    async () => {
      const gravityHome = await mkdtemp(join(tmpdir(), "gravity-pid-lock-zombie-"));
      const parent = spawn(
        process.execPath,
        [
          "-e",
          `const { spawn } = require('node:child_process');
           const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
           console.log(child.pid);
           process.kill(process.pid, 'SIGSTOP');`,
        ],
        { stdio: ["ignore", "pipe", "inherit"] },
      );
      const exited = once(parent, "exit");
      const lines = createInterface({ input: parent.stdout });
      let ownerPid: number | undefined;
      const processState = (pid: number) =>
        spawnSync("ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8" }).stdout.trim();

      try {
        const [line] = await once(lines, "line");
        ownerPid = Number(line);
        expect(Number.isInteger(ownerPid)).toBe(true);
        expect(ownerPid).toBeGreaterThan(0);
        await expect.poll(() => processState(parent.pid!), { timeout: 2000 }).toMatch(/^T/);
        process.kill(ownerPid, "SIGSTOP");
        await expect.poll(() => processState(ownerPid!), { timeout: 2000 }).toMatch(/^T/);

        await acquirePidLock(gravityHome, null, { ownerPid });
        await expect(acquirePidLock(gravityHome, null)).rejects.toThrow(
          "Another Gravity daemon is already running",
        );

        process.kill(ownerPid, "SIGKILL");
        await expect.poll(() => processState(ownerPid!), { timeout: 2000 }).toMatch(/^Z/);
        await expect(acquirePidLock(gravityHome, null)).resolves.toBeUndefined();
        expect((await getPidLockInfo(gravityHome))?.pid).toBe(process.pid);
      } finally {
        lines.close();
        if (ownerPid) {
          process.kill(ownerPid, "SIGKILL");
        }
        parent.kill("SIGCONT");
        parent.kill("SIGTERM");
        await exited;
        await rm(gravityHome, { recursive: true, force: true });
      }
    },
  );

  test("writes and releases lock for explicit owner pid", async () => {
    const parent = await mkdtemp(join(tmpdir(), "gravity-pid-lock-owner-"));
    const gravityHome = join(parent, "home");
    const ownerPid = process.pid + 10_000;

    try {
      await (
        acquirePidLock as unknown as (
          home: string,
          sockPath: string | null,
          options: { ownerPid: number },
        ) => Promise<void>
      )(gravityHome, null, { ownerPid });

      if (process.platform !== "win32") {
        expect((await stat(gravityHome)).mode & 0o777).toBe(0o700);
      }
      const lock = await getPidLockInfo(gravityHome);
      expect(lock?.pid).toBe(ownerPid);
      expect(lock?.listen).toBeNull();
      expect(lock?.heartbeat).toBe(true);

      await (
        updatePidLock as unknown as (
          home: string,
          patch: { listen: string },
          options: { ownerPid: number },
        ) => Promise<void>
      )(gravityHome, { listen: "127.0.0.1:6767" }, { ownerPid });

      const updatedLock = await getPidLockInfo(gravityHome);
      expect(updatedLock?.listen).toBe("127.0.0.1:6767");

      await (
        releasePidLock as unknown as (home: string, options: { ownerPid: number }) => Promise<void>
      )(gravityHome, { ownerPid: ownerPid + 1 });
      const lockAfterWrongOwnerRelease = await getPidLockInfo(gravityHome);
      expect(lockAfterWrongOwnerRelease?.pid).toBe(ownerPid);

      await (
        releasePidLock as unknown as (home: string, options: { ownerPid: number }) => Promise<void>
      )(gravityHome, { ownerPid });
      const lockAfterOwnerRelease = await getPidLockInfo(gravityHome);
      expect(lockAfterOwnerRelease).toBeNull();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("keeps a stale heartbeat lock when the recorded pid is alive without a reachability check", async () => {
    const gravityHome = await mkdtemp(join(tmpdir(), "gravity-pid-lock-stale-heartbeat-"));
    const replacementOwnerPid = process.pid + 10_000;

    try {
      const pidPath = join(gravityHome, "gravity.pid");
      await writeFile(
        pidPath,
        JSON.stringify({
          pid: process.pid,
          startedAt: new Date().toISOString(),
          hostname: "old-host",
          uid: process.getuid?.() ?? 0,
          listen: "127.0.0.1:6767",
          desktopManaged: true,
          heartbeat: true,
        }),
      );
      const staleTime = new Date(Date.now() - 10 * 60_000);
      await utimes(pidPath, staleTime, staleTime);

      await expect(isLocked(gravityHome)).resolves.toMatchObject({ locked: true });
      await expect(
        acquirePidLock(gravityHome, null, { ownerPid: replacementOwnerPid }),
      ).rejects.toThrow("Another Gravity daemon is already running");

      const lock = await getPidLockInfo(gravityHome);
      expect(lock?.pid).toBe(process.pid);
    } finally {
      await rm(gravityHome, { recursive: true, force: true });
    }
  });

  test("preserves a stale live desktop heartbeat lock", async () => {
    const gravityHome = await mkdtemp(join(tmpdir(), "gravity-pid-lock-stale-desktop-heartbeat-"));
    const replacementOwnerPid = process.pid + 10_000;

    try {
      const pidPath = join(gravityHome, "gravity.pid");
      await writeFile(
        pidPath,
        JSON.stringify({
          pid: process.pid,
          startedAt: new Date().toISOString(),
          hostname: "old-host",
          uid: process.getuid?.() ?? 0,
          listen: "127.0.0.1:6767",
          desktopManaged: true,
          heartbeat: true,
        }),
      );
      const staleTime = new Date(Date.now() - 10 * 60_000);
      await utimes(pidPath, staleTime, staleTime);

      await expect(
        acquirePidLock(gravityHome, null, { ownerPid: replacementOwnerPid }),
      ).rejects.toThrow("Another Gravity daemon is already running");

      const lock = await getPidLockInfo(gravityHome);
      expect(lock?.pid).toBe(process.pid);
      expect(lock?.listen).toBe("127.0.0.1:6767");
    } finally {
      await rm(gravityHome, { recursive: true, force: true });
    }
  });

  test("keeps a stale live lock written by a pre-heartbeat daemon", async () => {
    const gravityHome = await mkdtemp(join(tmpdir(), "gravity-pid-lock-legacy-live-"));
    const pidPath = join(gravityHome, "gravity.pid");

    try {
      await writeFile(
        pidPath,
        JSON.stringify({
          pid: process.pid,
          startedAt: new Date().toISOString(),
          hostname: "old-host",
          uid: process.getuid?.() ?? 0,
          listen: "127.0.0.1:6767",
          desktopManaged: true,
        }),
      );
      const staleTime = new Date(Date.now() - 10 * 60_000);
      await utimes(pidPath, staleTime, staleTime);

      await expect(
        acquirePidLock(gravityHome, null, { ownerPid: process.pid + 10_000 }),
      ).rejects.toThrow("Another Gravity daemon is already running");

      const lock = await getPidLockInfo(gravityHome);
      expect(lock?.pid).toBe(process.pid);
    } finally {
      await rm(gravityHome, { recursive: true, force: true });
    }
  });

  test("preserves a stale live legacy desktop lock", async () => {
    const gravityHome = await mkdtemp(join(tmpdir(), "gravity-pid-lock-legacy-desktop-"));
    const replacementOwnerPid = process.pid + 10_000;
    const pidPath = join(gravityHome, "gravity.pid");

    try {
      await writeFile(
        pidPath,
        JSON.stringify({
          pid: process.pid,
          startedAt: new Date().toISOString(),
          hostname: "old-host",
          uid: process.getuid?.() ?? 0,
          listen: "127.0.0.1:6767",
          desktopManaged: true,
        }),
      );
      const staleTime = new Date(Date.now() - 10 * 60_000);
      await utimes(pidPath, staleTime, staleTime);

      await expect(
        acquirePidLock(gravityHome, null, { ownerPid: replacementOwnerPid }),
      ).rejects.toThrow("Another Gravity daemon is already running");

      const lock = await getPidLockInfo(gravityHome);
      expect(lock?.pid).toBe(process.pid);
      expect(lock?.heartbeat).toBeUndefined();
    } finally {
      await rm(gravityHome, { recursive: true, force: true });
    }
  });

  test("rejects a heartbeat refresh after another supervisor takes ownership", async () => {
    const gravityHome = await mkdtemp(join(tmpdir(), "gravity-pid-lock-refresh-owner-"));

    try {
      await acquirePidLock(gravityHome, null, { ownerPid: process.pid + 10_000 });

      await expect(refreshPidLock(gravityHome, { ownerPid: process.pid })).rejects.toBeInstanceOf(
        PidLockError,
      );
    } finally {
      await rm(gravityHome, { recursive: true, force: true });
    }
  });

  test("retries a heartbeat refresh while its owner is rewriting the lock", async () => {
    const gravityHome = await mkdtemp(join(tmpdir(), "gravity-pid-lock-refresh-rewrite-"));
    const pidPath = join(gravityHome, "gravity.pid");

    try {
      await acquirePidLock(gravityHome, null, { ownerPid: process.pid });
      const lock = await getPidLockInfo(gravityHome);
      expect(lock).not.toBeNull();

      const rewriteHandle = await open(pidPath, "r+");
      await rewriteHandle.truncate(0);

      const refresh = refreshPidLock(gravityHome, { ownerPid: process.pid });
      await new Promise((resolve) => setTimeout(resolve, 250));
      await rewriteHandle.writeFile(JSON.stringify(lock));
      await rewriteHandle.close();

      await expect(refresh).resolves.toBeUndefined();
    } finally {
      await rm(gravityHome, { recursive: true, force: true });
    }
  });

  test("keeps a fresh lock when the recorded pid is alive", async () => {
    const gravityHome = await mkdtemp(join(tmpdir(), "gravity-pid-lock-fresh-heartbeat-"));

    try {
      await writeFile(
        join(gravityHome, "gravity.pid"),
        JSON.stringify({
          pid: process.pid,
          startedAt: new Date().toISOString(),
          hostname: "current-host",
          uid: process.getuid?.() ?? 0,
          listen: "127.0.0.1:6767",
          desktopManaged: true,
          heartbeat: true,
        }),
      );

      await expect(
        acquirePidLock(gravityHome, null, { ownerPid: process.pid + 10_000 }),
      ).rejects.toThrow("Another Gravity daemon is already running");

      const lock = await getPidLockInfo(gravityHome);
      expect(lock?.pid).toBe(process.pid);
      expect(lock?.listen).toBe("127.0.0.1:6767");
    } finally {
      await rm(gravityHome, { recursive: true, force: true });
    }
  });
});
