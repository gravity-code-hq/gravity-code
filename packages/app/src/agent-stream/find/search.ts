import {
  createDiffSearchRegExp,
  DIFF_SEARCH_MATCH_LIMIT,
  matchRanges,
  type DiffSearchOptions,
} from "@/git/diff-document/search";
import type { StreamItem } from "@/types/stream";

/**
 * Find-in-chat over the loaded transcript. Matches come from the message source text, so rows
 * outside the virtualized window still count and can be jumped to; the rendered row is searched
 * again only to paint the highlight.
 */

export interface ChatSearchMatch {
  itemId: string;
  /** Which match inside the item, in reading order. */
  occurrence: number;
}

export interface ChatSearchResult {
  matches: ChatSearchMatch[];
  limitHit: boolean;
  invalid: boolean;
}

export const EMPTY_CHAT_SEARCH_RESULT: ChatSearchResult = {
  matches: [],
  limitHit: false,
  invalid: false,
};

// Tool calls and reasoning render collapsed, so a match inside one would point at nothing the
// reader can see.
export function chatSearchText(item: StreamItem): string | null {
  if (item.kind === "user_message" || item.kind === "assistant_message") return item.text;
  return null;
}

export function findChatSearchMatches(
  items: readonly StreamItem[],
  query: string,
  options: DiffSearchOptions,
): ChatSearchResult {
  if (query.length === 0) return EMPTY_CHAT_SEARCH_RESULT;
  const regex = createDiffSearchRegExp(query, options);
  if (!regex) return { ...EMPTY_CHAT_SEARCH_RESULT, invalid: true };
  const matches: ChatSearchMatch[] = [];
  for (const item of items) {
    const text = chatSearchText(item);
    if (!text) continue;
    const ranges = matchRanges(regex, text, options.wholeWord);
    for (let occurrence = 0; !ranges.next().done; occurrence += 1) {
      if (matches.length === DIFF_SEARCH_MATCH_LIMIT) {
        return { matches, limitHit: true, invalid: false };
      }
      matches.push({ itemId: item.id, occurrence });
    }
  }
  return { matches, limitHit: false, invalid: false };
}

export function findChatSearchMatchIndex(
  result: ChatSearchResult,
  target: ChatSearchMatch | null,
): number | null {
  if (!target) return null;
  const index = result.matches.findIndex(
    (match) => match.itemId === target.itemId && match.occurrence === target.occurrence,
  );
  return index < 0 ? null : index;
}

/**
 * The first match in an item at or after `itemIndex` in `itemIds`, else the last one above it.
 * A reader at the bottom of a chat lands on the latest match instead of the oldest.
 */
export function nearestChatSearchMatch(input: {
  result: ChatSearchResult;
  itemIds: readonly string[];
  itemIndex: number;
}): number | null {
  const { result, itemIds, itemIndex } = input;
  if (result.matches.length === 0) return null;
  const orderById = new Map(itemIds.map((id, index) => [id, index]));
  const index = result.matches.findIndex(
    (match) => (orderById.get(match.itemId) ?? -1) >= itemIndex,
  );
  return index < 0 ? result.matches.length - 1 : index;
}
