import type { DaemonClient } from "@gravity/client/internal/daemon-client";
import type { ScheduleRun } from "@gravity/protocol/schedule/types";
import type { AggregatedSchedule } from "@/schedules/aggregated-schedules";
import { toErrorMessage } from "@/utils/error-messages";
import { resolveScheduleTitle } from "@/utils/schedule-format";

// Kept off the `schedules` prefix: the schedule mutations rewrite every query
// under that prefix as a schedule list.
export const scheduleRunsQueryBaseKey = ["schedule-runs"] as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** One run of one automation, flattened for the cross-automation Runs view. */
export interface ScheduleRunEntry {
  key: string;
  schedule: AggregatedSchedule;
  run: ScheduleRun;
  title: string;
  /** 1-based position among this automation's runs, oldest first. */
  runNumber: number;
  searchText: string;
}

export interface ScheduleRunsFailure {
  schedule: AggregatedSchedule;
  message: string;
}

export interface FetchScheduleRunsResult {
  entries: ScheduleRunEntry[];
  failures: ScheduleRunsFailure[];
}

export async function fetchScheduleRuns(input: {
  client: Pick<DaemonClient, "scheduleLogs">;
  schedules: readonly AggregatedSchedule[];
}): Promise<FetchScheduleRunsResult> {
  const runsByScheduleKey = new Map<string, readonly ScheduleRun[]>();
  const failures: ScheduleRunsFailure[] = [];
  await Promise.all(
    input.schedules.map(async (schedule) => {
      try {
        const payload = await input.client.scheduleLogs({ id: schedule.id });
        if (payload.error) {
          throw new Error(payload.error);
        }
        runsByScheduleKey.set(scheduleKey(schedule), payload.runs);
      } catch (error) {
        failures.push({ schedule, message: toErrorMessage(error) });
      }
    }),
  );
  return { entries: buildScheduleRunEntries(input.schedules, runsByScheduleKey), failures };
}

export function buildScheduleRunEntries(
  schedules: readonly AggregatedSchedule[],
  runsByScheduleKey: ReadonlyMap<string, readonly ScheduleRun[]>,
): ScheduleRunEntry[] {
  return schedules
    .flatMap((schedule) => {
      const title = resolveScheduleTitle(schedule);
      const runs = [...(runsByScheduleKey.get(scheduleKey(schedule)) ?? [])].sort(
        (left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt),
      );
      return runs.map((run, index) => ({
        key: `${scheduleKey(schedule)}:${run.id}`,
        schedule,
        run,
        title,
        runNumber: index + 1,
        searchText: [title, schedule.prompt, run.error ?? "", run.output ?? ""]
          .join("\n")
          .toLocaleLowerCase(),
      }));
    })
    .sort((left, right) => Date.parse(right.run.startedAt) - Date.parse(left.run.startedAt));
}

export type ScheduleRunStatusFilter = "all" | ScheduleRun["status"];

export function filterScheduleRunEntries(
  entries: readonly ScheduleRunEntry[],
  filter: {
    query?: string;
    status?: ScheduleRunStatusFilter;
    /** `scheduleKey()` of the one automation to keep, or null for every one. */
    scheduleKey?: string | null;
  },
): ScheduleRunEntry[] {
  const query = filter.query?.trim().toLocaleLowerCase() ?? "";
  const status = filter.status ?? "all";
  const onlyScheduleKey = filter.scheduleKey ?? null;
  return entries.filter(
    (entry) =>
      (status === "all" || entry.run.status === status) &&
      (onlyScheduleKey === null || scheduleKey(entry.schedule) === onlyScheduleKey) &&
      (!query || entry.searchText.includes(query)),
  );
}

export interface ScheduleRunOutcomeCounts {
  succeeded24h: number;
  failed24h: number;
  succeeded7d: number;
  failed7d: number;
}

export function countScheduleRunOutcomes(
  entries: readonly ScheduleRunEntry[],
  now: number,
): ScheduleRunOutcomeCounts {
  const dayAgo = now - MS_PER_DAY;
  const weekAgo = now - 7 * MS_PER_DAY;
  const counts = { succeeded24h: 0, failed24h: 0, succeeded7d: 0, failed7d: 0 };
  for (const { run } of entries) {
    const startedAt = Date.parse(run.startedAt);
    // A clock-skewed future run has not happened inside either window yet.
    if (Number.isNaN(startedAt) || startedAt > now) {
      continue;
    }
    const succeeded = run.status === "succeeded" ? 1 : 0;
    const failed = run.status === "failed" ? 1 : 0;
    if (startedAt >= weekAgo) {
      counts.succeeded7d += succeeded;
      counts.failed7d += failed;
    }
    if (startedAt >= dayAgo) {
      counts.succeeded24h += succeeded;
      counts.failed24h += failed;
    }
  }
  return counts;
}

export function scheduleKey(schedule: Pick<AggregatedSchedule, "serverId" | "id">): string {
  return `${schedule.serverId}:${schedule.id}`;
}
