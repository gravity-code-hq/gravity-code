import { describe, expect, it } from "vitest";
import { buildResultRows } from "./workspace-search-pane";

describe("buildResultRows", () => {
  const files = [
    {
      path: "src/a.ts",
      matches: [
        { line: 1, column: 1, length: 1, text: "a", textStart: 0, textEnd: 1 },
        { line: 4, column: 2, length: 1, text: "ba", textStart: 1, textEnd: 2 },
      ],
    },
    {
      path: "b.md",
      matches: [{ line: 2, column: 1, length: 1, text: "a", textStart: 0, textEnd: 1 }],
    },
  ];

  it("interleaves file headers with their matches", () => {
    expect(buildResultRows(files, new Set()).map((row) => row.key)).toEqual([
      "file:src/a.ts",
      "match:src/a.ts:1:1",
      "match:src/a.ts:4:2",
      "file:b.md",
      "match:b.md:2:1",
    ]);
  });

  it("hides the matches of collapsed files", () => {
    const rows = buildResultRows(files, new Set(["src/a.ts"]));
    expect(rows.map((row) => row.key)).toEqual(["file:src/a.ts", "file:b.md", "match:b.md:2:1"]);
    expect(rows[0]?.type === "file" && rows[0].expanded).toBe(false);
  });
});
