import { describe, expect, it } from "vitest";
import type { DiffSearchOptions } from "@/git/diff-document/search";
import type { StreamItem } from "@/types/stream";
import { findChatSearchMatches, findChatSearchMatchIndex, nearestChatSearchMatch } from "./search";

const literal: DiffSearchOptions = { caseSensitive: false, wholeWord: false, regex: false };
const timestamp = new Date(0);

function user(id: string, text: string): StreamItem {
  return { kind: "user_message", id, text, timestamp };
}

function assistant(id: string, text: string): StreamItem {
  return { kind: "assistant_message", id, text, timestamp };
}

function thought(id: string, text: string): StreamItem {
  return { kind: "thought", id, text, timestamp, status: "ready" };
}

describe("findChatSearchMatches", () => {
  it("numbers matches per item in reading order", () => {
    const result = findChatSearchMatches(
      [user("u1", "Stock run"), assistant("a1", "stock one, STOCK two"), user("u2", "nothing")],
      "stock",
      literal,
    );
    expect(result.matches).toEqual([
      { itemId: "u1", occurrence: 0 },
      { itemId: "a1", occurrence: 0 },
      { itemId: "a1", occurrence: 1 },
    ]);
    expect(result.invalid).toBe(false);
  });

  it("skips items that render collapsed", () => {
    const result = findChatSearchMatches(
      [thought("t1", "stock"), assistant("a1", "stock")],
      "stock",
      literal,
    );
    expect(result.matches).toEqual([{ itemId: "a1", occurrence: 0 }]);
  });

  it("honors case, whole word, and regex options", () => {
    const items = [assistant("a1", "Stock stocks stock")];
    expect(
      findChatSearchMatches(items, "stock", { ...literal, caseSensitive: true }).matches,
    ).toHaveLength(2);
    expect(
      findChatSearchMatches(items, "stock", { ...literal, wholeWord: true }).matches,
    ).toHaveLength(2);
    expect(
      findChatSearchMatches(items, "stocks?$", { ...literal, regex: true }).matches,
    ).toHaveLength(1);
  });

  it("treats a line break as a word boundary", () => {
    const result = findChatSearchMatches([assistant("a1", "intro\nstock\nend")], "stock", {
      ...literal,
      wholeWord: true,
    });
    expect(result.matches).toHaveLength(1);
  });

  it("reports an invalid regex instead of throwing", () => {
    const result = findChatSearchMatches([assistant("a1", "x")], "(", { ...literal, regex: true });
    expect(result).toMatchObject({ matches: [], invalid: true });
  });

  it("treats regex characters literally when regex is off", () => {
    const result = findChatSearchMatches([assistant("a1", "a.b axb")], "a.b", literal);
    expect(result.matches).toHaveLength(1);
  });
});

describe("findChatSearchMatchIndex", () => {
  it("follows a match by identity when earlier history loads", () => {
    const before = findChatSearchMatches([assistant("a2", "stock")], "stock", literal);
    const after = findChatSearchMatches(
      [assistant("a1", "stock"), assistant("a2", "stock")],
      "stock",
      literal,
    );
    const active = before.matches[0]!;
    expect(findChatSearchMatchIndex(after, active)).toBe(1);
    expect(findChatSearchMatchIndex(after, { itemId: "gone", occurrence: 0 })).toBeNull();
  });
});

describe("nearestChatSearchMatch", () => {
  const items = [assistant("a1", "stock"), user("u1", "hi"), assistant("a2", "stock")];
  const itemIds = items.map((item) => item.id);
  const result = findChatSearchMatches(items, "stock", literal);

  it("starts at the first match at or below the reading position", () => {
    expect(nearestChatSearchMatch({ result, itemIds, itemIndex: 1 })).toBe(1);
  });

  it("falls back to the last match above when nothing matches below", () => {
    expect(nearestChatSearchMatch({ result, itemIds, itemIndex: 3 })).toBe(1);
  });
});
