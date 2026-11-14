import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useFetchQuery } from "@/data/query";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { radarChecksQueryKey } from "./aggregated";
import {
  RADAR_CHECK_HISTORY_PAGE_SIZE,
  resolveRadarChecksView,
  type RadarChecksView,
} from "./checks";

/** A check finishes on the daemon with no push event, so the open sheet polls like the list. */
const RADAR_CHECKS_REFETCH_INTERVAL_MS = 15_000;

export interface UseRadarChecksResult {
  view: RadarChecksView;
  refetch: () => void;
}

/**
 * One radar's check history, newest first. Mount this only while the history
 * is on screen: the query, and its polling, live exactly as long as the caller.
 */
export function useRadarChecks(input: { serverId: string; radarId: string }): UseRadarChecksResult {
  const { serverId, radarId } = input;
  const { t } = useTranslation();
  const unavailableMessage = t("common.errors.daemonClientUnavailable");

  const query = useFetchQuery({
    queryKey: radarChecksQueryKey(serverId, radarId),
    queryFn: async () => {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) {
        throw new Error(unavailableMessage);
      }
      const payload = await client.radarListChecks({
        radarId,
        limit: RADAR_CHECK_HISTORY_PAGE_SIZE,
      });
      return payload.checks;
    },
    dataShape: "list",
    staleTimeMs: 5_000,
    // The interval is the retry; the error state also offers one by hand.
    retry: false,
    refetchInterval: RADAR_CHECKS_REFETCH_INTERVAL_MS,
  });

  const view = useMemo(
    () => resolveRadarChecksView({ checks: query.data, error: query.isError ? query.error : null }),
    [query.data, query.error, query.isError],
  );

  return {
    view,
    refetch: () => {
      void query.refetch();
    },
  };
}
