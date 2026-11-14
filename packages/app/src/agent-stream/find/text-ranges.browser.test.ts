import { afterEach, describe, expect, it } from "vitest";
import { createDiffSearchRegExp, type DiffSearchOptions } from "@/git/diff-document/search";
import { findHistoryRow, findRowTextRanges } from "./text-ranges.web";

const literal: DiffSearchOptions = { caseSensitive: false, wholeWord: false, regex: false };

// Compact, like react-native-web's output: no whitespace text between elements.
const fixture = [
  '<div data-history-row-id="user:1"><div data-testid="user-message">',
  '<div data-testid="user-message-text">Buy stock today</div>',
  '<div data-testid="user-message-timestamp">stock 10:32</div>',
  "</div></div>",
  '<div data-history-row-id="assistant:1"><div data-testid="assistant-message">',
  "<div>Stock <span>sto</span><code>ck</code> split</div>",
  '<div><span data-gravity-markdown-ignore="true">•</span><span>stock bullet</span></div>',
  "</div></div>",
].join("");

function mount(): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = fixture;
  document.body.append(host);
  return host;
}

function search(row: Element, query: string, options = literal): string[] {
  const regex = createDiffSearchRegExp(query, options);
  if (!regex) throw new Error("Expected a valid query");
  return findRowTextRanges(row, regex, options.wholeWord).map((range) => range.toString());
}

describe("findRowTextRanges", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("searches only the message text, not the row's timestamp", () => {
    const row = findHistoryRow(mount(), "user:1")!;
    expect(search(row, "stock")).toEqual(["stock"]);
  });

  it("joins inline nodes so a match can span formatting", () => {
    const row = findHistoryRow(mount(), "assistant:1")!;
    expect(search(row, "stock")).toEqual(["Stock", "stock", "stock"]);
  });

  it("keeps blocks apart, as the Markdown source does", () => {
    const row = findHistoryRow(mount(), "assistant:1")!;
    expect(search(row, "splitstock")).toEqual([]);
    expect(search(row, "split\\sstock", { ...literal, regex: true })).toHaveLength(1);
  });

  it("skips drawn list markers so whole-word matches agree with the source", () => {
    const row = findHistoryRow(mount(), "assistant:1")!;
    expect(search(row, "stock bullet", { ...literal, wholeWord: true })).toEqual(["stock bullet"]);
  });

  it("finds rows by ids that need escaping", () => {
    const host = mount();
    expect(findHistoryRow(host, "assistant:1")?.dataset.historyRowId).toBe("assistant:1");
    expect(findHistoryRow(host, 'missing"]')).toBeNull();
  });
});
