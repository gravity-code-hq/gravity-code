import { useCallback, useEffect, useId, useRef } from "react";
import { withUnistyles } from "react-native-unistyles";
import { FindWidget } from "@/components/ui/find-widget.web";
import { createDiffSearchRegExp } from "@/git/diff-document/search";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useStableEvent } from "@/hooks/use-stable-event";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import { useOptionalPaneFocus } from "@/panels/pane-context";
import type { Theme } from "@/styles/theme";
import type { ChatFindProps } from "./chat-find";
import { nearestChatSearchMatch, type ChatSearchMatch } from "./search";
import { findHistoryRow, findRowTextRanges } from "./text-ranges.web";
import { useChatFind } from "./use-chat-find";

const MATCH_HIGHLIGHT = "gravity-chat-find-match";
const ACTIVE_HIGHLIGHT = "gravity-chat-find-active";
const HIGHLIGHT_STYLE_ID = "gravity-chat-find-highlight";
// The widget floats over the top of the transcript, so a match under it is not in view.
const WIDGET_CLEARANCE_PX = 48;
const BOTTOM_CLEARANCE_PX = 24;
// Loading a history window and settling a virtualized jump each take a few frames.
const REVEAL_FRAME_BUDGET = 90;

interface PendingReveal {
  match: ChatSearchMatch;
  frames: number;
  requestedWindow: boolean;
  requestedScroll: boolean;
}

interface OwnedRanges {
  matches: Range[];
  active: Range | null;
}

/**
 * Find-in-chat: the diff's find widget over the agent transcript. Matches are counted from the
 * loaded messages; the mounted rows are searched again to paint them with the CSS Highlight API,
 * which leaves the Markdown renderer and the paced text reveal untouched.
 */
export function ChatFind({
  tail,
  head,
  viewportRef,
  visibleItemIds,
  revealLoadedItem,
  isActive,
}: ChatFindProps) {
  const find = useChatFind({ tail, head });
  const paneFocus = useOptionalPaneFocus();
  const handlerId = `agent-find:${useId()}`;
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const ownedRangesRef = useRef<OwnedRanges>({ matches: [], active: null });
  const paintFrameRef = useRef<number | null>(null);
  const pendingRevealRef = useRef<PendingReveal | null>(null);
  const revealFrameRef = useRef<number | null>(null);

  const getScrollElement = useCallback(
    () => viewportRef.current?.getScrollElement?.() ?? null,
    [viewportRef],
  );

  const paintHighlights = useStableEvent(() => {
    paintFrameRef.current = null;
    const registry = getHighlightRegistry();
    if (!registry) return;
    releaseOwnedRanges(registry, ownedRangesRef.current);
    ownedRangesRef.current = { matches: [], active: null };
    const scroll = getScrollElement();
    const regex = createDiffSearchRegExp(find.searched.query, find.searched.options);
    if (!find.isOpen || !scroll || !regex || find.result.matches.length === 0) return;
    const matchedItemIds = new Set(find.result.matches.map((match) => match.itemId));
    const owned: OwnedRanges = { matches: [], active: null };
    for (const row of scroll.querySelectorAll<HTMLElement>("[data-history-row-id]")) {
      const itemId = row.dataset.historyRowId;
      if (!itemId || !matchedItemIds.has(itemId)) continue;
      const ranges = findRowTextRanges(row, regex, find.searched.options.wholeWord);
      owned.matches.push(...ranges);
      if (find.activeMatch?.itemId === itemId) {
        owned.active = ranges[find.activeMatch.occurrence] ?? null;
      }
    }
    const matchHighlight = ensureHighlight(registry, MATCH_HIGHLIGHT, 0);
    for (const range of owned.matches) matchHighlight.add(range);
    if (owned.active) ensureHighlight(registry, ACTIVE_HIGHLIGHT, 1).add(owned.active);
    ownedRangesRef.current = owned;
  });
  const schedulePaint = useStableEvent(() => {
    if (paintFrameRef.current === null) {
      paintFrameRef.current = window.requestAnimationFrame(paintHighlights);
    }
  });

  useEffect(() => {
    schedulePaint();
  }, [find.isOpen, find.result, find.activeMatch, schedulePaint]);

  // Virtualized rows mount as the reader scrolls and streaming text replaces nodes; either
  // leaves the painted ranges pointing at detached text.
  useEffect(() => {
    if (!find.isOpen) return;
    const scroll = getScrollElement();
    if (!scroll) return;
    const observer = new MutationObserver(schedulePaint);
    observer.observe(scroll, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [find.isOpen, getScrollElement, schedulePaint]);

  useEffect(
    () => () => {
      if (paintFrameRef.current !== null) window.cancelAnimationFrame(paintFrameRef.current);
      if (revealFrameRef.current !== null) window.cancelAnimationFrame(revealFrameRef.current);
      const registry = getHighlightRegistry();
      if (registry) releaseOwnedRanges(registry, ownedRangesRef.current);
    },
    [],
  );

  const scheduleRevealTick = useStableEvent(() => {
    if (revealFrameRef.current === null) {
      revealFrameRef.current = window.requestAnimationFrame(revealTick);
    }
  });
  // A match can sit above the mounted history window, in an unmounted virtualized row, or
  // further down a long message than the row's top. Each step waits for the previous one.
  const revealTick = useStableEvent(() => {
    revealFrameRef.current = null;
    const pending = pendingRevealRef.current;
    if (!pending) return;
    pending.frames += 1;
    const viewport = viewportRef.current;
    const scroll = getScrollElement();
    if (!viewport || !scroll || pending.frames > REVEAL_FRAME_BUDGET) {
      pendingRevealRef.current = null;
      return;
    }
    const { itemId, occurrence } = pending.match;
    if (!visibleItemIds.has(itemId)) {
      if (!pending.requestedWindow) {
        pending.requestedWindow = true;
        revealLoadedItem(itemId);
      }
      scheduleRevealTick();
      return;
    }
    if (viewport.isScrollToMessageSettling?.()) {
      scheduleRevealTick();
      return;
    }
    const row = findHistoryRow(scroll, itemId);
    if (!row) {
      if (!pending.requestedScroll) {
        pending.requestedScroll = true;
        viewport.scrollToMessage?.(itemId);
      }
      scheduleRevealTick();
      return;
    }
    pendingRevealRef.current = null;
    const regex = createDiffSearchRegExp(find.searched.query, find.searched.options);
    const range = regex
      ? findRowTextRanges(row, regex, find.searched.options.wholeWord)[occurrence]
      : undefined;
    scrollRectIntoView(scroll, (range ?? row).getBoundingClientRect(), () =>
      viewport.stopFollowingOutput?.(),
    );
  });

  const revealMatch = useStableEvent((index: number) => {
    const match = find.result.matches[index];
    if (!match) return;
    find.setActiveMatch(match);
    pendingRevealRef.current = { match, frames: 0, requestedWindow: false, requestedScroll: false };
    scheduleRevealTick();
  });

  const nearestMatchToView = useStableEvent((): number | null => {
    const itemIds = [...tail, ...head].map((item) => item.id);
    return nearestChatSearchMatch({
      result: find.result,
      itemIds,
      itemIndex: firstRowIndexInView(getScrollElement(), itemIds),
    });
  });

  // A new query or option jumps to the match nearest the reading position; a reply streaming
  // in under an unchanged query leaves the reader where they are.
  const jumpToNearestMatch = useStableEvent(() => {
    if (!find.isOpen) return;
    const index = nearestMatchToView();
    if (index === null) find.setActiveMatch(null);
    else revealMatch(index);
  });
  useEffect(() => {
    jumpToNearestMatch();
  }, [find.searched, jumpToNearestMatch]);

  const step = useStableEvent((direction: 1 | -1) => {
    const count = find.result.matches.length;
    if (count === 0) return;
    const current = find.activeIndex;
    if (current === null) {
      const nearest = nearestMatchToView() ?? 0;
      revealMatch(direction === 1 ? nearest : (nearest - 1 + count) % count);
      return;
    }
    revealMatch((current + direction + count) % count);
  });
  const next = useCallback(() => step(1), [step]);
  const previous = useCallback(() => step(-1), [step]);

  const close = useStableEvent(() => {
    find.close();
    pendingRevealRef.current = null;
    const restore = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (restore?.isConnected) restore.focus({ preventScroll: true });
  });

  // Cmd+F belongs to the chat only while focus is in its transcript or composer, or nowhere;
  // the diff, the file editor, and other panes keep their own find.
  const handleKeyboardAction = useStableEvent((action: KeyboardActionDefinition): boolean => {
    if (action.id !== "agent.find") return false;
    const scroll = getScrollElement();
    if (!scroll?.isConnected) return false;
    const focused = document.activeElement;
    const ownsFocus =
      !focused ||
      focused === document.body ||
      scroll.contains(focused) ||
      focused.closest('[data-testid="message-input-root"]') !== null;
    if (!ownsFocus) return false;
    restoreFocusRef.current =
      focused instanceof HTMLElement && focused !== document.body ? focused : null;
    find.open(selectedSingleLineText(scroll));
    return true;
  });
  useKeyboardActionHandler({
    handlerId,
    actions: ["agent.find"],
    enabled: isActive && (paneFocus?.isInteractive ?? false),
    priority: 100,
    handle: handleKeyboardAction,
  });

  if (!find.isOpen) return null;
  return (
    <>
      <ThemedHighlightStyle uniProps={highlightColorMapping} />
      <FindWidget
        find={find}
        onNext={next}
        onPrevious={previous}
        onClose={close}
        positionStyle={WIDGET_POSITION_STYLE}
        testIDPrefix="chat-find"
      />
    </>
  );
}

function HighlightStyle({ match, active }: { match?: string; active?: string }) {
  useEffect(() => {
    let style = document.getElementById(HIGHLIGHT_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = HIGHLIGHT_STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent =
      `::highlight(${MATCH_HIGHLIGHT}){background-color:${match};}` +
      `::highlight(${ACTIVE_HIGHLIGHT}){background-color:${active};}`;
  }, [active, match]);
  return null;
}

const ThemedHighlightStyle = withUnistyles(HighlightStyle);
// The file editor's and the diff's find colors, so every find reads alike.
const highlightColorMapping = (theme: Theme) => ({
  match: theme.colors.interactionHighlight,
  active: theme.colors.terminal.selectionBackground,
});

function getHighlightRegistry(): HighlightRegistry | null {
  if (typeof Highlight === "undefined" || typeof CSS === "undefined" || !CSS.highlights) {
    return null;
  }
  return CSS.highlights;
}

// Every chat pane shares the two named highlights, so each one adds and removes only its own.
function ensureHighlight(registry: HighlightRegistry, name: string, priority: number): Highlight {
  const existing = registry.get(name);
  if (existing) return existing;
  const highlight = new Highlight();
  highlight.priority = priority;
  registry.set(name, highlight);
  return highlight;
}

function releaseOwnedRanges(registry: HighlightRegistry, owned: OwnedRanges): void {
  const matchHighlight = registry.get(MATCH_HIGHLIGHT);
  for (const range of owned.matches) matchHighlight?.delete(range);
  if (owned.active) registry.get(ACTIVE_HIGHLIGHT)?.delete(owned.active);
}

function firstRowIndexInView(scroll: HTMLElement | null, itemIds: readonly string[]): number {
  if (!scroll) return itemIds.length;
  const top = scroll.getBoundingClientRect().top + WIDGET_CLEARANCE_PX;
  for (const row of scroll.querySelectorAll<HTMLElement>("[data-history-row-id]")) {
    if (row.getBoundingClientRect().bottom <= top) continue;
    const index = itemIds.indexOf(row.dataset.historyRowId ?? "");
    if (index >= 0) return index;
  }
  return itemIds.length;
}

function scrollRectIntoView(scroll: HTMLElement, rect: DOMRect, beforeScroll: () => void): void {
  const bounds = scroll.getBoundingClientRect();
  const top = bounds.top + WIDGET_CLEARANCE_PX;
  const bottom = bounds.bottom - BOTTOM_CLEARANCE_PX;
  if (rect.top >= top && rect.bottom <= bottom) return;
  beforeScroll();
  const available = bottom - top;
  scroll.scrollTop +=
    rect.height > available ? rect.top - top : rect.top + rect.height / 2 - (top + available / 2);
}

// Like VS Code, only a single-line selection seeds the query.
function selectedSingleLineText(scroll: HTMLElement): string | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode) return null;
  if (!scroll.contains(selection.anchorNode)) return null;
  const text = selection.toString();
  return text && !text.includes("\n") ? text : null;
}

const WIDGET_POSITION_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 8,
  right: 16,
  zIndex: 10,
  maxWidth: "calc(100% - 32px)",
};
