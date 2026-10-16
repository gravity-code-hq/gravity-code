import type { ScheduleSummary } from "@gravity/protocol/schedule/types";
import { scheduleBucket, type ScheduleDerivedState } from "@/schedules/schedule-derivation";
import { formatCadence, resolveScheduleTitle } from "@/utils/schedule-format";

export type ScheduleStatusFilter = "all" | "active" | "paused" | "ended";

interface FilterableScheduleRow {
  schedule: ScheduleSummary;
  state: ScheduleDerivedState;
  targetLabel: string;
}

function matchesStatus(state: ScheduleDerivedState, filter: ScheduleStatusFilter): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "ended") {
    return scheduleBucket(state) === "ended";
  }
  return state === filter;
}

export function filterScheduleRows<T extends FilterableScheduleRow>(
  rows: readonly T[],
  filter: { query: string; status: ScheduleStatusFilter },
): T[] {
  const query = filter.query.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (!matchesStatus(row.state, filter.status)) {
      return false;
    }
    if (!query) {
      return true;
    }
    return [
      resolveScheduleTitle(row.schedule),
      row.schedule.prompt,
      row.targetLabel,
      formatCadence(row.schedule.cadence),
    ]
      .join("\n")
      .toLocaleLowerCase()
      .includes(query);
  });
}
