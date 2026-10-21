import { useCallback, useDeferredValue, useMemo, useState } from "react";
import type { SearchOption, SearchOptionValues } from "@/components/ui/search-option-toggles";
import { EMPTY_DIFF_SEARCH_RESULT, findDiffSearchMatches, type DiffSearchResult } from "./search";

const DEFAULT_OPTIONS: SearchOptionValues = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

export interface DiffFind {
  isOpen: boolean;
  query: string;
  options: SearchOptionValues;
  result: DiffSearchResult;
  /** Changes only when the query or options do, never when the diff updates underneath. */
  queryIdentity: object;
  activeIndex: number | null;
  /** Bumps each time the widget should take focus and select its text. */
  focusRequest: { id: number; text: string };
  open: (seed: string | null) => void;
  close: () => void;
  setQuery: (query: string) => void;
  toggleOption: (option: SearchOption) => void;
  setActiveIndex: (index: number | null) => void;
}

/** Find-in-diff state. Matching runs on the deferred query so typing never waits on a large diff. */
export function useDiffFind(files: Parameters<typeof findDiffSearchMatches>[0]): DiffFind {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [focusRequest, setFocusRequest] = useState({ id: 0, text: "" });
  const deferredQuery = useDeferredValue(query);
  const deferredOptions = useDeferredValue(options);
  const searchedQuery = isOpen ? deferredQuery : "";
  const result = useMemo(
    () =>
      searchedQuery
        ? findDiffSearchMatches(files, searchedQuery, deferredOptions)
        : EMPTY_DIFF_SEARCH_RESULT,
    [deferredOptions, files, searchedQuery],
  );
  const queryIdentity = useMemo(
    () => ({ query: searchedQuery, options: deferredOptions }),
    [deferredOptions, searchedQuery],
  );
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
    setActiveIndex(null);
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
    queryIdentity,
    activeIndex: activeIndex !== null && activeIndex < result.matches.length ? activeIndex : null,
    focusRequest,
    open,
    close,
    setQuery,
    toggleOption,
    setActiveIndex,
  };
}
