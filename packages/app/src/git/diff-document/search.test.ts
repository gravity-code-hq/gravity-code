import type { ParsedDiffFile } from "@gravity/protocol/messages";
import { describe, expect, it } from "vitest";
import { buildDiffDocumentModel } from "./model";
import {
  DIFF_SEARCH_MATCH_LIMIT,
  diffSearchLineKey,
  findDiffSearchMatches,
  firstDiffSearchMatchFrom,
  locateDiffSearchMatch,
  type DiffSearchOptions,
} from "./search";
import type { DiffPalette } from "./types";

const literal: DiffSearchOptions = { caseSensitive: false, wholeWord: false, regex: false };

function file(
  path: string,
  lines: ParsedDiffFile["hunks"][number]["lines"],
  status?: ParsedDiffFile["status"],
): ParsedDiffFile {
  return {
    path,
    isNew: false,
    isDeleted: false,
    additions: 1,
    deletions: 1,
    status,
    hunks: [{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, lines }],
  };
}

function texts(files: ParsedDiffFile[], query: string, options = literal): string[] {
  return findDiffSearchMatches(files, query, options).matches.map(
    (match) =>
      files[match.fileIndex]!.hunks[match.hunkIndex]!.lines[match.lineIndex]!.content.slice(
        match.start,
        match.end,
      ) + `@${match.lineIndex}:${match.start}`,
  );
}

const palette = {
  syntax: {},
} as unknown as DiffPalette;

describe("diff search", () => {
  const files = [
    file("src/a.ts", [
      { type: "header", content: "@@ -1 +1 @@ Scored" },
      { type: "remove", content: "scored = Scored(scored_checks)" },
      { type: "add", content: "rescored = 1" },
    ]),
  ];

  it("matches literally and ignores case by default", () => {
    expect(texts(files, "scored")).toEqual([
      "scored@1:0",
      "Scored@1:9",
      "scored@1:16",
      "scored@2:2",
    ]);
    expect(texts(files, "(scored")).toEqual(["(scored@1:15"]);
  });

  it("honours match case", () => {
    expect(texts(files, "Scored", { ...literal, caseSensitive: true })).toEqual(["Scored@1:9"]);
  });

  it("uses VS Code's word separators for whole word, so underscores join words", () => {
    expect(texts(files, "scored", { ...literal, wholeWord: true })).toEqual([
      "scored@1:0",
      "Scored@1:9",
    ]);
  });

  it("runs regular expressions, skips empty matches, and flags invalid ones", () => {
    expect(texts(files, "(re)?scored\\b", { ...literal, regex: true })).toEqual([
      "scored@1:0",
      "Scored@1:9",
      "rescored@2:0",
    ]);
    expect(texts(files, "x*", { ...literal, regex: true })).toEqual([]);
    const invalid = findDiffSearchMatches(files, "(", { ...literal, regex: true });
    expect(invalid.invalid).toBe(true);
    expect(invalid.matches).toEqual([]);
  });

  it("skips hunk headers and binary or oversized files", () => {
    const skipped = [
      file("bin.png", [{ type: "add", content: "scored" }], "binary"),
      file("big.txt", [{ type: "add", content: "scored" }], "too_large"),
    ];
    expect(texts(skipped, "scored")).toEqual([]);
    expect(texts(files, "@@")).toEqual([]);
  });

  it("indexes matches by line for painting", () => {
    const result = findDiffSearchMatches(files, "scored", literal);
    expect(result.matchesByLine.get(diffSearchLineKey(0, 0, 1))).toEqual([0, 1, 2]);
    expect(result.matchesByLine.get(diffSearchLineKey(0, 0, 2))).toEqual([3]);
  });

  it("stops at VS Code's match limit", () => {
    const many = [
      file("a.txt", [{ type: "add", content: "a".repeat(DIFF_SEARCH_MATCH_LIMIT + 5) }]),
    ];
    const result = findDiffSearchMatches(many, "a", literal);
    expect(result.matches).toHaveLength(DIFF_SEARCH_MATCH_LIMIT);
    expect(result.limitHit).toBe(true);
  });

  it("locates matches in the layout and picks the first one from the viewport down", () => {
    const sources = [
      file("src/a.ts", [{ type: "add", content: "one scored" }]),
      file("src/b.ts", [{ type: "add", content: "two scored" }]),
    ];
    const model = buildDiffDocumentModel({
      files: sources,
      collapsedFilePaths: new Set(["src/b.ts"]),
      layout: "unified",
      wrapLines: false,
      viewportWidth: 400,
      typography: { family: "monospace", size: 12, lineHeight: 18 },
      measureText: { measure: (text) => Array.from(text).length * 10 },
      palette,
      labels: { binary: "Binary", tooLarge: "Too large" },
    });
    const result = findDiffSearchMatches(sources, "scored", literal);

    const location = locateDiffSearchMatch({ model, match: result.matches[0]! });
    expect(location).toMatchObject({ top: model.files[0]!.bodyTop, x: 40, width: 60 });
    expect(locateDiffSearchMatch({ model, match: result.matches[1]! })).toBeNull();

    expect(firstDiffSearchMatchFrom({ model, result, documentTop: 0 })).toBe(0);
    expect(firstDiffSearchMatchFrom({ model, result, documentTop: model.files[0]!.bottom })).toBe(
      1,
    );
    expect(firstDiffSearchMatchFrom({ model, result, documentTop: model.height + 1 })).toBe(0);
  });
});
