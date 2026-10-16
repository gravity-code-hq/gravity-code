import { useMemo } from "react";
import { useFetchQuery } from "@/data/query";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { AggregatedSchedule } from "@/schedules/aggregated-schedules";
import {
  fetchScheduleRuns,
  scheduleRunsQueryBaseKey,
  type FetchScheduleRunsResult,
} from "@/schedules/schedule-runs";

const RUNNING_POLL_MS = 5_000;

export interface UseScheduleRunsResult {
  data: FetchScheduleRunsResult | null;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * Every run of every automation on one host. The daemon keeps runs per
 * automation, so this asks each one for its log. `updatedAt` moves when a run
 * starts or finishes, so it keys the query and a new run refetches on its own.
 */
export function useScheduleRuns(input: {
  serverId: string;
  schedules: readonly AggregatedSchedule[];
  enabled: boolean;
}): UseScheduleRunsResult {
  const { serverId, schedules, enabled } = input;
  const signature = useMemo(
    () =>
      schedules
        .map((schedule) => `${schedule.id}@${schedule.updatedAt}`)
        .sort()
        .join("|"),
    [schedules],
  );

  const query = useFetchQuery({
    queryKey: [...scheduleRunsQueryBaseKey, serverId, signature],
    queryFn: async () => {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) {
        throw new Error("Host is not connected");
      }
      return fetchScheduleRuns({ client, schedules });
    },
    dataShape: "value",
    staleTimeMs: 5_000,
    enabled,
    // A finished run does not touch the schedule list until something refetches
    // it, so poll the logs while any run is still going.
    refetchInterval: (current) =>
      current.state.data?.entries.some((entry) => entry.run.status === "running")
        ? RUNNING_POLL_MS
        : false,
  });

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => {
      void query.refetch();
    },
  };
}
