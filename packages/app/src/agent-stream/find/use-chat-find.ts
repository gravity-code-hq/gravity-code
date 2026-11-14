import { useCallback, useDeferredValue, useMemo, useState } from "react";
import type { SearchOption, SearchOptionValues } from "@/components/ui/search-option-toggles";
import type { StreamItem } from "@/types/stream";
import {
  EMPTY_CHAT_SEARCH_RESULT,
  findChatSearchMatches,
  findChatSearchMatchIndex,
  type ChatSearchMatch,
  type ChatSearchResult,
} from "./search";

const DEFAULT_OPTIONS: SearchOptionValues = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

export interface ChatFind {
  isOpen: boolean;
  query: string;
  options: SearchOptionValues;
  result: ChatSearchResult;
  /** The query and options the result was computed for. Changes only when they do. */
  searched: { query: string; options: SearchOptionValues };
  activeIndex: number | null;
  activeMatch: ChatSearchMatch | null;
  focusRequest: { id: number; text: string };
  open: (seed: string | null) => void;
  close: () => void;
  setQuery: (query: string) => void;
  toggleOption: (option: SearchOption) => void;
  setActiveMatch: (match: ChatSearchMatch | null) => void;
}

/**
 * Find-in-chat state. The active match is kept by identity rather than index, so older
 * history loading above it or a reply streaming in below it does not move the selection.
 */
export function useChatFind(input: {
  tail: readonly StreamItem[];
  head: readonly StreamItem[];
}): ChatFind {
  const { tail, head } = input;
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [activeMatch, setActiveMatch] = useState<ChatSearchMatch | null>(null);
  const [focusRequest, setFocusRequest] = useState({ id: 0, text: "" });
  const deferredQuery = useDeferredValue(query);
  const deferredOptions = useDeferredValue(options);
  const searchedQuery = isOpen ? deferredQuery : "";
  const result = useMemo(
    () =>
      searchedQuery
        ? findChatSearchMatches([...tail, ...head], searchedQuery, deferredOptions)
        : EMPTY_CHAT_SEARCH_RESULT,
    [deferredOptions, head, searchedQuery, tail],
  );
  const searched = useMemo(
    () => ({ query: searchedQuery, options: deferredOptions }),
    [deferredOptions, searchedQuery],
  );
  const activeIndex = findChatSearchMatchIndex(result, activeMatch);
  const open = useCallback(
    (seed: string | null) => {
      const text = seed ?? query;
      setQuery(text);
      setIsOpen(true);
      setFocusRequest((previous) => ({ id: previous.id + 1, text }));
    },
    [query],
  );
  const close = useCallback(() => {
    setIsOpen(false);
    setActiveMatch(null);
  }, []);
  const toggleOption = useCallback(
    (option: SearchOption) =>
      setOptions((previous) => ({ ...previous, [option]: !previous[option] })),
    [],
  );
  return {
    isOpen,
    query,
    options,
    result,
    searched,
    activeIndex,
    activeMatch: activeIndex === null ? null : activeMatch,
    focusRequest,
    open,
    close,
    setQuery,
    toggleOption,
    setActiveMatch,
  };
}
