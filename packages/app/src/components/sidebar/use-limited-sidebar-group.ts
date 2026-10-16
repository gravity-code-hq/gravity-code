import { useCallback, useMemo, useState } from "react";

const INITIAL_VISIBLE_ITEMS = 20;

export function useLimitedSidebarGroup<T>(items: readonly T[], limit = INITIAL_VISIBLE_ITEMS) {
  const [expanded, setExpanded] = useState(false);
  const visibleItems = useMemo(
    () => (expanded ? items.slice() : items.slice(0, limit)),
    [expanded, items, limit],
  );
  const canToggle = items.length > limit;
  const toggleExpanded = useCallback(() => setExpanded((current) => !current), []);

  return { visibleItems, expanded, canToggle, toggleExpanded };
}
