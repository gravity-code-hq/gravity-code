import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { buildPowerInstallScript, POWER_STATE_DIRECTORY, shellQuote } from "./macos-script.js";
import { PowerSessionError, type PowerLease } from "./session.js";

const exec = promisify(execFile);

async function readActiveToken(): Promise<string | null> {
  try {
    return await readFile(path.join(POWER_STATE_DIRECTORY, "active"), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function waitForState(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(200);
  }
  throw new PowerSessionError("macOS did not confirm the sleep setting. Try again.");
}

export async function acquireMacPowerLease(): Promise<PowerLease> {
  if (process.platform !== "darwin") {
    throw new PowerSessionError("Closed-lid operation is only available on macOS.");
  }
  const leasePath = await mkdtemp(path.join(tmpdir(), "gravity-power-"));
  const token = randomUUID();
  const started = await exec("/bin/ps", ["-p", String(process.pid), "-o", "lstart="], {
    env: { ...process.env, LC_ALL: "C" },
  });
  const script = buildPowerInstallScript({
    leasePath,
    token,
    ownerPid: process.pid,
    ownerStartedAt: started.stdout.trimEnd(),
    deadline: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
  });
  const command = `/bin/sh -c ${shellQuote(script)}`;
  // AppleScript quoting is separate from shell quoting. No renderer input enters the script.
  const appleScriptString = command.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const heartbeat = setInterval(() => {
    const now = new Date();
    void utimes(leasePath, now, now).catch(() => undefined);
  }, 5_000);
  heartbeat.unref();
  try {
    await exec(
      "/usr/bin/osascript",
      [
        "-e",
        `do shell script "${appleScriptString}" with administrator privileges with prompt "Gravity needs permission to keep this Mac working with its lid closed."`,
      ],
      { timeout: 120_000 },
    );
    await waitForState(async () => (await readActiveToken()) === token);
  } catch (error) {
    clearInterval(heartbeat);
    await rm(leasePath, { recursive: true, force: true });
    if (error instanceof PowerSessionError) throw error;
    let detail = "macOS could not authorize the power setting.";
    if (error instanceof Error && "stderr" in error && typeof error.stderr === "string") {
      detail = error.stderr.trim().slice(0, 500) || detail;
    }
    throw new PowerSessionError(detail, { cause: error });
  }
  clearInterval(heartbeat);

  return {
    isActive: async () => (await readActiveToken()) === token,
    async refresh() {
      const now = new Date();
      await utimes(leasePath, now, now);
    },
    async release() {
      await rm(leasePath, { recursive: true, force: true });
      await waitForState(async () => (await readActiveToken()) !== token);
    },
  };
}
