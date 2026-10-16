import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { startGitCommandMetrics, stopGitCommandMetrics } from "@server/utils/run-git-command.js";

import { getCheckoutDiff, type CheckoutDiffResult } from "./checkout-git.js";

function initRepoWithTrackedChanges(fileCount: number): { tempDir: string; repoDir: string } {
  const tempDir = realpathSync(mkdtempSync(join(tmpdir(), "checkout-git-batch-test-")));
  const repoDir = join(tempDir, "repo");

  mkdirSync(repoDir, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });

  for (let i = 0; i < fileCount; i += 1) {
    writeFileSync(join(repoDir, `file-${i}.txt`), `before-${i}\n`);
  }
  execFileSync("git", ["add", "."], { cwd: repoDir });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "initial"], {
    cwd: repoDir,
  });

  for (let i = 0; i < fileCount; i += 1) {
    writeFileSync(join(repoDir, `file-${i}.txt`), `after-${i}\n`);
  }

  return { tempDir, repoDir };
}

describe("checkout git diff batching", () => {
  let tempDir: string;
  let repoDir: string;

  beforeEach(() => {
    const setup = initRepoWithTrackedChanges(20);
    tempDir = setup.tempDir;
    repoDir = setup.repoDir;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("publishes readable tracked and untracked patches before syntax highlighting", async () => {
    writeFileSync(join(repoDir, "tracked.ts"), "const value = 1;\n");
    execFileSync("git", ["add", "tracked.ts"], { cwd: repoDir });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "code"], { cwd: repoDir });
    writeFileSync(join(repoDir, "tracked.ts"), "const value = 2;\n");
    writeFileSync(join(repoDir, "new.ts"), "export const added = true;\n");
    const previews: CheckoutDiffResult[] = [];
    const result = await getCheckoutDiff(
      repoDir,
      { mode: "uncommitted", includeStructured: true },
      undefined,
      (preview) => previews.push(preview),
    );
    expect(previews).toHaveLength(1);
    const preview = previews[0];
    expect(preview.diff).toBe(result.diff);
    expect(preview.structured?.map((file) => file.path)).toEqual(
      result.structured?.map((file) => file.path),
    );
    for (const path of ["tracked.ts", "new.ts"]) {
      const plain = preview.structured?.find((file) => file.path === path);
      const highlighted = result.structured?.find((file) => file.path === path);
      expect(plain?.hunks[0].lines.find((line) => line.type === "add")?.tokens).toBeUndefined();
      expect(
        highlighted?.hunks[0].lines.find((line) => line.type === "add")?.tokens,
      ).toContainEqual({
        text: "const",
        style: "keyword",
      });
    }
  });

  it("collects ordinary tracked patches with one bounded Git command", async () => {
    startGitCommandMetrics();
    const result = await getCheckoutDiff(repoDir, {
      mode: "uncommitted",
      includeStructured: false,
    });

    expect(result.diff).toContain("file-0.txt");
    expect(result.diff).toContain("file-19.txt");
    const metrics = stopGitCommandMetrics();
    expect(
      metrics.commands.filter(({ args }) => args[0] === "diff" && args.includes("--")),
    ).toHaveLength(1);
  });

  it("preserves every untracked patch across batches, including binary files", async () => {
    for (let index = 0; index < 17; index++) {
      writeFileSync(
        join(repoDir, `new-${index.toString().padStart(2, "0")}.txt`),
        `new ${index}\n`,
      );
    }
    writeFileSync(join(repoDir, "new-binary.bin"), Buffer.from([0, 255, 0]));
    const result = await getCheckoutDiff(repoDir, { mode: "uncommitted", includeStructured: true });
    const added = result.structured?.filter((file) => file.isNew);
    expect(added?.map((file) => [file.path, file.additions, file.status])).toEqual([
      ...Array.from({ length: 17 }, (_, index) => [
        `new-${index.toString().padStart(2, "0")}.txt`,
        1,
        "ok",
      ]),
      ["new-binary.bin", 0, "binary"],
    ]);
    expect(result.structured).toHaveLength(38);
  });

  it("batches committed file contents and preserves the highlighted diff", async () => {
    execFileSync("git", ["checkout", "-b", "feature"], { cwd: repoDir });
    execFileSync("git", ["add", "."], { cwd: repoDir });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "change"], { cwd: repoDir });
    startGitCommandMetrics();
    const result = await getCheckoutDiff(repoDir, {
      mode: "base",
      baseRef: "main",
      includeStructured: true,
    });
    const metrics = stopGitCommandMetrics();
    expect(result.structured).toHaveLength(20);
    expect(result.structured?.every((file) => file.additions === 1 && file.deletions === 1)).toBe(
      true,
    );
    expect(metrics.commands.filter(({ args }) => args[0] === "show")).toHaveLength(0);
    expect(metrics.commands.filter(({ args }) => args[0] === "cat-file")).toHaveLength(1);
  });

  it("keeps small neighbors when a patch exceeds the entire batch budget", async () => {
    writeFileSync(join(repoDir, "file-0.txt"), "x".repeat(9 * 1024 * 1024) + "\n");
    const result = await getCheckoutDiff(repoDir, {
      mode: "uncommitted",
      includeStructured: true,
    });
    expect(result.structured).toHaveLength(20);
    expect(result.structured?.find((file) => file.path === "file-0.txt")).toMatchObject({
      status: "too_large",
      hunks: [],
    });
    expect(result.structured?.filter((file) => file.status === "ok")).toHaveLength(19);
    expect(result.diff).toContain("+after-19");
    expect(result.diff).not.toContain("x".repeat(1_000));
  });
});
