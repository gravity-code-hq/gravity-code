import { describe, expect, it } from "vitest";
import { lcut, previewMatch, resultCountForm } from "./workspace-search-preview";

describe("lcut (VS Code port)", () => {
  it("returns trimmed text when it is shorter than the limit", () => {
    expect(lcut("   foo bar", 26, "…")).toBe("foo bar");
  });

  it("keeps at least n characters, cutting on a word boundary with the prefix", () => {
    const text = "the quick brown fox jumps over the lazy dog";
    expect(lcut(text, 10, "…")).toBe("…the lazy dog");
  });

  it("keeps text without a usable boundary", () => {
    expect(lcut("abcdefghijklmnopqrstuvwxyz0123456789", 10, "…")).toBe(
      "abcdefghijklmnopqrstuvwxyz0123456789",
    );
  });
});

describe("previewMatch", () => {
  it("splits the preview around the match and left-cuts long leading context", () => {
    const text = "    const value = compute(alpha, beta, gamma, delta, epsilon, needle, tail);";
    const start = text.indexOf("needle");
    const preview = previewMatch({
      line: 1,
      column: start + 1,
      length: 6,
      text,
      textStart: start,
      textEnd: start + 6,
    });
    expect(preview.inside).toBe("needle");
    expect(preview.after).toBe(", tail);");
    expect(preview.before.startsWith("…")).toBe(true);
    expect(preview.before.length).toBeLessThan(preview.fullBefore.length);
    expect(preview.fullBefore.endsWith(preview.before.slice(1))).toBe(true);
    expect(preview.fullBefore).toBe(text.slice(0, start));
  });

  it("caps the preview at 250 characters", () => {
    const text = `needle${"x".repeat(500)}`;
    const preview = previewMatch({ line: 1, column: 1, length: 6, text, textStart: 0, textEnd: 6 });
    expect(preview.before + preview.inside + preview.after).toHaveLength(250);
  });
});

describe("resultCountForm", () => {
  it("mirrors VS Code's four message variants", () => {
    expect(resultCountForm(1, 1)).toBe("fileResult");
    expect(resultCountForm(1, 2)).toBe("filesResult");
    expect(resultCountForm(3, 1)).toBe("fileResults");
    expect(resultCountForm(3, 2)).toBe("filesResults");
  });
});
