import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as childProcess from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runGitCommand } from "./run-git-command.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

const tempDirs: string[] = [];

function makeTempRepo(): string {
  const repo = mkdtempSync(path.join(tmpdir(), "gravity-git-fsmonitor-"));
  tempDirs.push(repo);
  return repo;
}

async function configureFsmonitor(repo: string): Promise<string> {
  const hookPath = path.join(repo, "fsmonitor-hook.sh");
  const markerPath = `${hookPath}.marker`;
  writeFileSync(hookPath, "#!/bin/sh\n: > \"$0.marker\"\nprintf '1\\n'\n");
  chmodSync(hookPath, 0o755);
  await runGitCommand(["config", "core.fsmonitor", hookPath], { cwd: repo });
  return markerPath;
}

afterEach(() => {
  vi.clearAllMocks();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe("runGitCommand executable lookup", () => {
  function createGit(cwd: string, name: string): string {
    const bin = path.join(cwd, name);
    mkdirSync(bin);
    const executable = path.join(bin, "git");
    writeFileSync(executable, `#!/bin/sh\nprintf '%s\\n' '${name}'\n`);
    chmodSync(executable, 0o755);
    return executable;
  }

  it("resolves the selected Git before spawning and honors PATH overlays", async () => {
    const cwd = makeTempRepo();
    const first = createGit(cwd, "first");
    const second = createGit(cwd, "second");
    const spawn = vi.mocked(childProcess.spawn);
    const result = await runGitCommand(["--version"], {
      cwd,
      env: { PATH: path.dirname(first) },
      envOverlay: { PATH: path.dirname(second) },
    });
    expect(result.stdout).toBe("second\n");
    expect(spawn.mock.calls[0]?.[0]).toBe(second);
  });

  it("resolves relative PATH entries against each command's working directory", async () => {
    const firstCwd = makeTempRepo();
    const secondCwd = makeTempRepo();
    const first = createGit(firstCwd, "bin");
    const second = createGit(secondCwd, "bin");
    const spawn = vi.mocked(childProcess.spawn);
    await runGitCommand(["--version"], { cwd: firstCwd, envOverlay: { PATH: "bin" } });
    await runGitCommand(["--version"], { cwd: secondCwd, envOverlay: { PATH: "bin" } });
    expect(spawn.mock.calls.map((call) => call[0])).toEqual([first, second]);
  });

  it("picks up a newly executable Git earlier on the same PATH", async () => {
    const cwd = makeTempRepo();
    const first = createGit(cwd, "first");
    const second = createGit(cwd, "second");
    const envOverlay = { PATH: [path.dirname(first), path.dirname(second)].join(path.delimiter) };
    chmodSync(first, 0o644);
    expect((await runGitCommand(["--version"], { cwd, envOverlay })).stdout).toBe("second\n");
    chmodSync(first, 0o755);
    expect((await runGitCommand(["--version"], { cwd, envOverlay })).stdout).toBe("first\n");
  });
});

describe("runGitCommand fsmonitor isolation", () => {
  it("does not execute a repository-configured fsmonitor command", async () => {
    const repo = makeTempRepo();
    await runGitCommand(["init"], { cwd: repo });
    const markerPath = await configureFsmonitor(repo);

    await runGitCommand(["status", "--porcelain"], { cwd: repo });

    expect(existsSync(markerPath)).toBe(false);
  });

  it("overrides core.fsmonitor for commands other than status", async () => {
    const repo = makeTempRepo();
    await runGitCommand(["init"], { cwd: repo });
    await configureFsmonitor(repo);

    const result = await runGitCommand(["config", "--get", "core.fsmonitor"], { cwd: repo });

    expect(result.stdout.trim()).toBe("false");
  });
});
