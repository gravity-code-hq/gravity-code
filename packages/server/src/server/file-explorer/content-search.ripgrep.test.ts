import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { resolveRipgrep, searchFileContents } from "./content-search.js";

const ripgrepAvailable = resolveRipgrep() !== null;

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "content-search-rg-")));
  tempDirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(dir, ".gitignore"), "node_modules\n");
  writeFileSync(join(dir, "src", "app.ts"), "const gravity = 1;\nexport { gravity, Gravity };\n");
  writeFileSync(join(dir, "README.md"), "Gravity keeps agents in orbit — ünïcode gravity.\n");
  writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "gravity ignored\n");
  return dir;
}

// Skipped where ripgrep is not installed; the git grep suite covers the shared shape.
describe.skipIf(!ripgrepAvailable)("searchFileContents (ripgrep)", () => {
  test("reports every submatch with character columns and skips ignored files", async () => {
    const root = makeRepo();
    const result = await searchFileContents({ root, query: "gravity" }, { engine: "ripgrep" });
    expect(result.truncated).toBe(false);
    expect(result.files.map((file) => file.path).sort()).toEqual(["README.md", "src/app.ts"]);
    const readme = result.files.find((file) => file.path === "README.md");
    expect(
      readme?.matches.map((match) => [
        match.column,
        match.text.slice(match.textStart, match.textEnd),
      ]),
    ).toEqual([
      [1, "Gravity"],
      [41, "gravity"],
    ]);
    const app = result.files.find((file) => file.path === "src/app.ts");
    expect(app?.matches.map((match) => [match.line, match.column])).toEqual([
      [1, 7],
      [2, 10],
      [2, 19],
    ]);
  });

  test("honours regex, whole word, and globs", async () => {
    const root = makeRepo();
    const regex = await searchFileContents(
      { root, query: "grav\\w+y", regex: true, caseSensitive: true },
      { engine: "ripgrep" },
    );
    expect(regex.totalMatches).toBe(3);
    const wholeWord = await searchFileContents(
      { root, query: "orbit", wholeWord: true, include: "*.md" },
      { engine: "ripgrep" },
    );
    expect(wholeWord.files.map((file) => file.path)).toEqual(["README.md"]);
    const excluded = await searchFileContents(
      { root, query: "gravity", exclude: "*.md" },
      { engine: "ripgrep" },
    );
    expect(excluded.files.map((file) => file.path)).toEqual(["src/app.ts"]);
    const capped = await searchFileContents(
      { root, query: "gravity", maxResults: 1 },
      { engine: "ripgrep" },
    );
    expect(capped.totalMatches).toBe(1);
    expect(capped.truncated).toBe(true);
  });
});
