import type { StreamItem, ToolCallItem } from "@/types/stream";
import { isGroupableToolCall, type GroupedToolCalls } from "./grouping";
import { buildOverviewGroup, type OverviewToolCallGroup } from "./overview/model";

const VISIBLE_TOOL_CALLS = 5;
const EMPTY_GROUPS = new Map<string, OverviewToolCallGroup>();

interface DetailedHistory {
  prefix: StreamItem[];
  pending: ToolCallItem[];
  trailingRows: ToolCallItem[];
  tail: StreamItem[];
  groups: Map<string, OverviewToolCallGroup>;
}

const historyCache = new WeakMap<StreamItem[], DetailedHistory>();

function collapseRun(calls: ToolCallItem[], groups: Map<string, OverviewToolCallGroup>) {
  if (calls.length <= VISIBLE_TOOL_CALLS) return calls;
  const hidden = calls.slice(0, -VISIBLE_TOOL_CALLS);
  const first = hidden[0]!;
  const latest = hidden[hidden.length - 1]!;
  const group = buildOverviewGroup({
    id: first.id,
    calls: hidden,
    latest,
    isSealed: true,
  });
  groups.set(first.id, group);
  return [{ ...latest, id: first.id }, ...calls.slice(-VISIBLE_TOOL_CALLS)];
}

function prepareHistory(tail: StreamItem[]): DetailedHistory {
  const cached = historyCache.get(tail);
  if (cached) return cached;
  const prefix: StreamItem[] = [];
  const groups = new Map<string, OverviewToolCallGroup>();
  let pending: ToolCallItem[] = [];
  for (const item of tail) {
    if (isGroupableToolCall(item)) {
      pending.push(item);
      continue;
    }
    prefix.push(...collapseRun(pending, groups), item);
    pending = [];
  }
  const trailingRows = collapseRun(pending, groups);
  const projectedTail = retainItems(tail, [...prefix, ...trailingRows]);
  const history = { prefix, pending, trailingRows, tail: projectedTail, groups };
  historyCache.set(tail, history);
  return history;
}

function retainItems(source: StreamItem[], projected: StreamItem[]): StreamItem[] {
  const unchanged =
    source.length === projected.length && source.every((item, index) => item === projected[index]);
  return unchanged ? source : projected;
}

export function collapseDetailedToolCalls(input: {
  tail: StreamItem[];
  head: StreamItem[];
}): GroupedToolCalls<OverviewToolCallGroup> {
  const history = prepareHistory(input.tail);
  const tail = [...history.prefix];
  const head: StreamItem[] = [];
  const groups = new Map(history.groups);
  const historyUpdates = new Map<string, OverviewToolCallGroup>();
  let pending = [...history.pending];
  // A run can straddle history and live delivery. Keep its host in history and
  // preserve the lane of each visible call, so promotion never duplicates a row.
  let historyCallCount = pending.length;

  function flush() {
    const unchangedHistoryRun = historyCallCount > 0 && pending.length === historyCallCount;
    const rows = unchangedHistoryRun ? history.trailingRows : collapseRun(pending, groups);
    const hiddenCount = Math.max(0, pending.length - VISIBLE_TOOL_CALLS);
    const removedCount = Math.max(0, hiddenCount - 1);
    const tailCount = historyCallCount > 0 ? Math.max(1, historyCallCount - removedCount) : 0;
    tail.push(...rows.slice(0, tailCount));
    head.push(...rows.slice(tailCount));
    const hostId = pending[0]?.id;
    const group = hostId && groups.get(hostId);
    if (historyCallCount > 0 && group && !unchangedHistoryRun) {
      historyUpdates.set(group.run.id, group);
    }
    pending = [];
    historyCallCount = 0;
  }

  for (const item of input.head) {
    if (isGroupableToolCall(item)) {
      pending.push(item);
      continue;
    }
    flush();
    head.push(item);
  }
  flush();
  return {
    tail: retainItems(history.tail, tail),
    head: retainItems(input.head, head),
    groupsByHostId: groups,
    historyGroupUpdatesByHostId: historyUpdates.size > 0 ? historyUpdates : EMPTY_GROUPS,
  };
}
