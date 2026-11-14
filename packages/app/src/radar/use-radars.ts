import { useMemo } from "react";
import { useFetchQuery } from "@/data/query";
import {
  getHostRuntimeStore,
  useHostRuntimeConnectionStatuses,
  useHosts,
} from "@/runtime/host-runtime";
import type { AggregateLoadState } from "@/schedules/aggregated-schedules";
import {
  fetchAggregatedRadars,
  radarListQueryKey,
  type AggregatedRadar,
  type RadarHostError,
  type RadarHostInput,
} from "./aggregated";

/** Checks and tasks progress on the daemon with no push event, so the open screen polls. */
const RADAR_REFETCH_INTERVAL_MS = 15_000;

export interface UseRadarsResult {
  loadState: AggregateLoadState<AggregatedRadar>;
  hostErrors: RadarHostError[];
  error: Error | null;
  refetch: () => void;
}

/**
 * Radars for the host the screen is pinned to. `enabled` is the caller's
 * feature gate: a host without `features.radar` is never asked.
 */
export function useRadars(options: { serverId: string; enabled: boolean }): UseRadarsResult {
  const allHosts = useHosts();
  const runtime = getHostRuntimeStore();
  const { serverId } = options;
  const hostInputs = useMemo<RadarHostInput[]>(
    () =>
      allHosts
        .filter((host) => host.serverId === serverId)
        .map((host) => ({ serverId: host.serverId, serverName: host.label })),
    [allHosts, serverId],
  );
  const serverIds = useMemo(() => hostInputs.map((host) => host.serverId), [hostInputs]);
  const connectionStatuses = useHostRuntimeConnectionStatuses(serverIds);
  const connectionStatusKey = useMemo(
    () => serverIds.map((id) => connectionStatuses.get(id) ?? "connecting").join("|"),
    [connectionStatuses, serverIds],
  );

  const query = useFetchQuery({
    queryKey: [...radarListQueryKey(serverIds), connectionStatusKey],
    queryFn: () => fetchAggregatedRadars({ hosts: hostInputs, runtime }),
    dataShape: "list",
    staleTimeMs: 5_000,
    enabled: options.enabled,
    refetchInterval: RADAR_REFETCH_INTERVAL_MS,
  });

  let loadState: AggregateLoadState<AggregatedRadar>;
  if (query.data?.status === "connecting") {
    loadState = { status: "connecting" };
  } else if (query.data?.status === "loaded") {
    loadState = { status: "loaded", data: query.data.data };
  } else {
    loadState = { status: "loading" };
  }

  return {
    loadState,
    hostErrors: query.data?.status === "loaded" ? query.data.hostErrors : [],
    error: query.isError ? query.error : null,
    refetch: () => {
      void query.refetch();
    },
  };
}
