import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { buildWatchdogScript, shellQuote } from "./macos-script.js";

const exec = promisify(execFile);

async function harness() {
  const root = await mkdtemp(path.join(tmpdir(), "gravity-power-test-"));
  const state = path.join(root, "state");
  const lease = path.join(root, "lease ' quoted");
  const plist = path.join(root, "job.plist");
  const commands = path.join(root, "bin");
  await Promise.all([mkdir(state), mkdir(lease), mkdir(commands)]);
  await writeFile(path.join(state, "armed"), "");
  await writeFile(plist, "test job");
  await writeFile(path.join(root, "battery"), "AC Power");
  await writeFile(path.join(root, "disabled"), "0");
  async function executable(name: string, source: string) {
    await writeFile(
      path.join(commands, name),
      `#!/bin/sh\nset -eu\nroot=${shellQuote(root)}\n${source}\n`,
      { mode: 0o755 },
    );
  }
  await executable(
    "pmset",
    `
if [ "$1" = "-a" ]; then
  printf '%s\\n' "$3" >> "$root/calls"
  if [ -f "$root/fail-restore" ] && [ "$3" = 0 ]; then exit 1; fi
  printf '%s' "$3" > "$root/disabled"
elif [ "$#" -eq 2 ] && [ "$2" = "batt" ]; then cat "$root/battery"
else
  echo 'System-wide power settings:'
  if [ "$(cat "$root/disabled")" = 1 ]; then echo ' SleepDisabled 1'; fi
fi`,
  );
  await executable("launchctl", `printf '%s\\n' "$*" >> "$root/launchctl"`);
  await executable("sleep", "/bin/sleep 0.01");
  // GNU stat differs from macOS stat; the fake exposes the watchdog's mtime contract.
  await executable("stat", `cat "$root/modified"`);
  await writeFile(path.join(root, "modified"), String(Math.floor(Date.now() / 1000)));
  const started = await exec("/bin/ps", ["-p", String(process.pid), "-o", "lstart="]);
  const script = buildWatchdogScript(
    {
      leasePath: lease,
      token: "test-token",
      ownerPid: process.pid,
      ownerStartedAt: started.stdout.trimEnd(),
      deadline: Math.floor(Date.now() / 1000) + 60,
    },
    {
      stateDirectory: state,
      plistPath: plist,
      commandPath: `${commands}:/usr/bin:/bin:/usr/sbin:/sbin`,
    },
  );
  return {
    root,
    state,
    lease,
    plist,
    script,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function waitForActive(state: string) {
  await expect
    .poll(async () => readFile(path.join(state, "active"), "utf8").catch(() => ""), {
      timeout: 3_000,
    })
    .toBe("test-token");
}

test("releasing the lease restores sleep and removes the recovery job", async () => {
  const h = await harness();
  try {
    const child = exec("/bin/sh", ["-c", h.script], { timeout: 5_000 }).then(
      () => null,
      (error: unknown) => error,
    );
    await waitForActive(h.state);
    await rm(h.lease, { recursive: true });
    expect(await child).toBeNull();
    expect(await readFile(path.join(h.root, "calls"), "utf8")).toBe("1\n0\n");
    await expect(readFile(h.plist)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await h.cleanup();
  }
});

test("a stale heartbeat restores sleep without enabling it", async () => {
  const h = await harness();
  try {
    await writeFile(path.join(h.root, "modified"), "1");
    await utimes(h.lease, 1, 1);
    await exec("/bin/sh", ["-c", h.script], { timeout: 5_000 });
    expect(await readFile(path.join(h.root, "calls"), "utf8")).toBe("0\n");
  } finally {
    await h.cleanup();
  }
});

test("battery cutoff restores sleep while the app is alive", async () => {
  const h = await harness();
  try {
    const child = exec("/bin/sh", ["-c", h.script], { timeout: 5_000 }).then(
      () => null,
      (error: unknown) => error,
    );
    await waitForActive(h.state);
    await writeFile(
      path.join(h.root, "battery"),
      "Now drawing from 'Battery Power'\n -InternalBattery-0 20%; discharging\n",
    );
    expect(await child).toBeNull();
    expect(await readFile(path.join(h.root, "calls"), "utf8")).toBe("1\n0\n");
  } finally {
    await h.cleanup();
  }
});

test("a helper restart restores the old session instead of enabling again", async () => {
  const h = await harness();
  try {
    await rm(path.join(h.state, "armed"));
    await writeFile(path.join(h.root, "disabled"), "1");
    await exec("/bin/sh", ["-c", h.script], { timeout: 5_000 });
    expect(await readFile(path.join(h.root, "calls"), "utf8")).toBe("0\n");
  } finally {
    await h.cleanup();
  }
});

test("failed restoration retains the recovery job for launchd to retry", async () => {
  const h = await harness();
  try {
    await rm(path.join(h.state, "armed"));
    await writeFile(path.join(h.root, "fail-restore"), "");
    await expect(exec("/bin/sh", ["-c", h.script], { timeout: 5_000 })).rejects.toMatchObject({
      code: 1,
    });
    expect(await readFile(h.plist, "utf8")).toBe("test job");
  } finally {
    await h.cleanup();
  }
});
