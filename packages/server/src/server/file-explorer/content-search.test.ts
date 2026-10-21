import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  buildGitGrepArgs,
  buildMatchPreviews,
  buildRipgrepArgs,
  parseSearchGlobs,
  searchFileContents,
} from "./content-search.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "content-search-")));
  tempDirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(dir, ".gitignore"), "node_modules\n");
  writeFileSync(join(dir, "src", "app.ts"), "const gravity = 1;\nexport { gravity, Gravity };\n");
  writeFileSync(join(dir, "README.md"), "Gravity keeps agents in orbit.\n");
  writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "gravity ignored\n");
  return dir;
}

describe("searchFileContents (git grep)", () => {
  test("finds every match on a line, case-insensitively, and skips ignored files", async () => {
    const root = makeRepo();
    const result = await searchFileContents({ root, query: "gravity" }, { engine: "git" });
    expect(result.truncated).toBe(false);
    expect(result.totalMatches).toBe(4);
    const paths = result.files.map((file) => file.path).sort();
    expect(paths).toEqual(["README.md", "src/app.ts"]);
    const app = result.files.find((file) => file.path === "src/app.ts");
    expect(app?.matches).toEqual([
      { line: 1, column: 7, length: 7, text: "const gravity = 1;", textStart: 6, textEnd: 13 },
      {
        line: 2,
        column: 10,
        length: 7,
        text: "export { gravity, Gravity };",
        textStart: 9,
        textEnd: 16,
      },
      {
        line: 2,
        column: 19,
        length: 7,
        text: "export { gravity, Gravity };",
        textStart: 18,
        textEnd: 25,
      },
    ]);
  });

  test("respects case sensitivity, whole word, and include globs", async () => {
    const root = makeRepo();
    const caseSensitive = await searchFileContents(
      { root, query: "Gravity", caseSensitive: true },
      { engine: "git" },
    );
    expect(caseSensitive.totalMatches).toBe(2);

    const wholeWord = await searchFileContents(
      { root, query: "orbit", wholeWord: true },
      { engine: "git" },
    );
    expect(wholeWord.files.map((file) => file.path)).toEqual(["README.md"]);

    const included = await searchFileContents(
      { root, query: "gravity", include: "*.md" },
      { engine: "git" },
    );
    expect(included.files.map((file) => file.path)).toEqual(["README.md"]);

    const excluded = await searchFileContents(
      { root, query: "gravity", exclude: "src/**" },
      { engine: "git" },
    );
    expect(excluded.files.map((file) => file.path)).toEqual(["README.md"]);
  });

  test("truncates at maxResults", async () => {
    const root = makeRepo();
    const result = await searchFileContents(
      { root, query: "gravity", maxResults: 2 },
      { engine: "git" },
    );
    expect(result.totalMatches).toBe(2);
    expect(result.truncated).toBe(true);
  });

  test("skips dotfiles when excludeHidden is set", async () => {
    const root = makeRepo();
    mkdirSync(join(root, ".github"), { recursive: true });
    writeFileSync(join(root, ".github", "ci.yml"), "gravity ci\n");
    writeFileSync(join(root, ".env.example"), "GRAVITY=1\n");
    const search = async (excludeHidden: boolean) =>
      (await searchFileContents({ root, query: "gravity", excludeHidden }, { engine: "git" })).files
        .map((file) => file.path)
        .sort();
    expect(await search(true)).toEqual(["README.md", "src/app.ts"]);
    expect(await search(false)).toEqual([
      ".env.example",
      ".github/ci.yml",
      "README.md",
      "src/app.ts",
    ]);
  });

  test("rejects a root outside any directory", async () => {
    await expect(
      searchFileContents({ root: join(tmpdir(), "does-not-exist-gravity"), query: "x" }),
    ).rejects.toThrow("Search root is not a directory");
  });
});

describe("argument construction (VS Code getRgArgs port)", () => {
  test("ripgrep args carry the toggles, includes, and anchored excludes", () => {
    const args = buildRipgrepArgs({
      root: "/tmp",
      query: "foo",
      caseSensitive: true,
      wholeWord: true,
      regex: true,
      include: "*.ts, src/**",
      exclude: "dist/**",
      maxResults: 10,
    });
    expect(args).toContain("--case-sensitive");
    expect(args).not.toContain("--fixed-strings");
    expect(args).toContain("--regexp");
    expect(args[args.indexOf("--regexp") + 1]).toBe("\\bfoo\\b");
    expect(args).toContain("--engine");
    expect(args).toContain("--no-config");
    expect(args).toContain("--json");
    expect(args.slice(-2)).toEqual(["--", "."]);
    expect(args.join(" ")).toContain("-g **/*.ts/** -g **/*.ts -g **/src/**");
    expect(args.join(" ")).toContain("-g !**/node_modules -g !**/bower_components");
    expect(args.join(" ")).toContain("-g !**/dist/**");
  });

  test("literal queries go after -- so a leading dash is not a flag", () => {
    const args = buildRipgrepArgs({ root: "/tmp", query: "-x", maxResults: 10 });
    expect(args).toContain("--fixed-strings");
    expect(args).toContain("--ignore-case");
    expect(args.slice(-3)).toEqual(["--", "-x", "."]);
  });

  test("git grep args expand includes like VS Code and exclude the defaults", () => {
    const args = buildGitGrepArgs({
      root: "/tmp",
      query: "foo",
      include: ".ts",
      exclude: "dist/**",
      maxResults: 10,
    });
    expect(args).toContain("-i");
    expect(args).toContain("-F");
    expect(args.slice(-12)).toEqual([
      ":(glob)**/*.ts/**",
      ":(glob)**/*.ts",
      ":(exclude,glob)**/node_modules",
      ":(exclude,glob)**/bower_components",
      ":(exclude,glob)**/*.code-search",
      ":(exclude,glob)**/.git",
      ":(exclude,glob)**/.svn",
      ":(exclude,glob)**/.hg",
      ":(exclude,glob)**/CVS",
      ":(exclude,glob)**/.DS_Store",
      ":(exclude,glob)**/Thumbs.db",
      ":(exclude,glob)**/dist/**",
    ]);
  });

  test("excludeHidden drops --hidden and excludes dot paths from git grep", () => {
    const base = { root: "/tmp", query: "foo", maxResults: 10 };
    const hidden = buildRipgrepArgs({ ...base, excludeHidden: true });
    expect(hidden).not.toContain("--hidden");
    expect(hidden.join(" ")).toContain("-g !**/node_modules");
    const shown = buildRipgrepArgs(base);
    expect(shown).toContain("--hidden");
    expect(shown.join(" ")).toContain("-g !**/.git");
    expect(buildGitGrepArgs({ ...base, excludeHidden: true }).slice(-2)).toEqual([
      ":(exclude,glob)**/.*",
      ":(exclude,glob)**/.*/**",
    ]);
  });

  test("parseSearchGlobs follows the VS Code include box rules", () => {
    expect(parseSearchGlobs(" .js, src/, {a,b}.ts ,./lib, ")).toEqual([
      "**/*.js/**",
      "**/*.js",
      "**/src/**",
      "**/src",
      "**/{a,b}.ts/**",
      "**/{a,b}.ts",
      "/lib",
      "/lib/**",
    ]);
  });
});

describe("buildMatchPreviews (VS Code TextSearchMatch port)", () => {
  test("keeps short lines intact and strips the newline", () => {
    const [preview] = buildMatchPreviews(
      "hello world\n",
      [{ startLineNumber: 0, startColumn: 6, endLineNumber: 0, endColumn: 11 }],
      1000,
    );
    expect(preview).toEqual({
      source: { startLineNumber: 0, startColumn: 6, endLineNumber: 0, endColumn: 11 },
      previewText: "hello world",
      previewStart: 6,
      previewEnd: 11,
    });
  });

  test("elides long gaps between matches on one line", () => {
    const line = `${"a".repeat(5000)}needle${"b".repeat(50)}`;
    const [preview] = buildMatchPreviews(
      line,
      [{ startLineNumber: 0, startColumn: 5000, endLineNumber: 0, endColumn: 5006 }],
      1000,
    );
    expect(preview?.previewText.startsWith("⟪ 4800 characters skipped ⟫")).toBe(true);
    expect(preview?.previewText.slice(preview.previewStart, preview.previewEnd)).toBe("needle");
  });
});
