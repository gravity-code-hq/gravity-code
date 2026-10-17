import { describe, expect, it } from "vitest";
import { darkPureBlackTheme, darkTheme, lightTheme } from "@/styles/theme";
import { codeLineNumberTone, codeTextColor, createDiffPalette, retainDiffPalette } from "./palette";
import type { DiffCell, DiffPalette } from "./types";

describe("diff text color", () => {
  it.each(["add", "remove", "context"] as const)(
    "uses normal code foreground for an untokenized %s line",
    (type) => {
      expect(codeTextColor(cell(type), palette)).toBe("foreground");
    },
  );

  it.each([
    ["add", "addition"],
    ["remove", "deletion"],
    ["context", "foregroundMuted"],
  ] as const)("uses the %s gutter tone for native and web line numbers", (type, tone) => {
    expect(codeLineNumberTone(cell(type))).toBe(tone);
  });
});

describe("diff palette retention", () => {
  it("retains the previous value when a theme wrapper recreates equal colors", () => {
    const recreated = { ...palette, syntax: { keyword: "purple" } };
    const previous = { ...recreated, syntax: { keyword: "purple" } };

    expect(retainDiffPalette(previous, recreated)).toBe(previous);
  });

  it("accepts a real color change", () => {
    const changed = { ...palette, foreground: "new-foreground" };

    expect(retainDiffPalette(palette, changed)).toBe(changed);
  });
});

describe("diff colors", () => {
  it("uses fresh green and coral without changing light mode's surfaces or syntax", () => {
    const theme = lightTheme;
    const created = createDiffPalette(theme);

    expect(created.addition).toBe("#19743e");
    expect(created.deletion).toBe("#b34842");
    expect(created.additionBackground).toBe("#e7f7ec");
    expect(created.deletionBackground).toBe("#ffedea");
    expect(created.additionGutterBackground).toBe(created.additionBackground);
    expect(created.deletionGutterBackground).toBe(created.deletionBackground);
    expect(created.surface).toBe(theme.colors.surface0);
    expect(created.headerSurface).toBe(theme.colors.surface1);
    expect(created.statusSuccess).toBe(theme.colors.statusSuccess);
    expect(created.statusDanger).toBe(theme.colors.statusDanger);
    expect(created.syntax).toBe(theme.colors.syntax);
  });

  it.each([darkTheme, darkPureBlackTheme])(
    "keeps dark diff fills opaque and gutters continuous with their rows",
    (theme) => {
      const created = createDiffPalette(theme);

      expect(created.surface).toBe("#191919");
      expect(created.addition).toBe("#7fdca0");
      expect(created.deletion).toBe("#f29a90");
      expect(created.additionBackground).toBe("#193526");
      expect(created.deletionBackground).toBe("#3d2524");
      expect(created.additionGutterBackground).toBe(created.additionBackground);
      expect(created.deletionGutterBackground).toBe(created.deletionBackground);
      expect(created.emptyBackground).toBe(created.surface);
      expect(created.syntax.keyword).toBe("#80cbc4");
      expect(created.syntax.string).toBe("#d69bd2");
      expect(created.statusSuccess).toBe(theme.colors.statusSuccess);
      expect(created.statusDanger).toBe(theme.colors.statusDanger);
    },
  );
});

const palette: DiffPalette = {
  surface: "surface",
  hunkBackground: "#123",
  additionGutterBackground: "#142",
  deletionGutterBackground: "#412",
  headerSurface: "header",
  border: "border",
  foreground: "foreground",
  foregroundMuted: "muted",
  addition: "green",
  deletion: "red",
  additionBackground: "green-bg",
  deletionBackground: "red-bg",
  emptyBackground: "empty",
  selection: "selection",
  headerActiveSurface: "active-header",
  headerBorder: "header-border",
  statusSuccess: "success",
  statusDanger: "danger",
  statusWarning: "warning",
  syntax: {},
};

function cell(type: DiffCell["type"]): DiffCell {
  return {
    type,
    content: "code",
    lineNumber: 1,
    tokens: [],
    fragments: [],
    reviewTarget: null,
    sourceIdentity: { hunkIndex: 0, lineIndex: 1, side: "new" },
  };
}
