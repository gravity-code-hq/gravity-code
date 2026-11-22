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

/** A check finishes on the daemon with no push event, so an open list polls like the radar list. */
const RADAR_CHECKS_REFETCH_INTERVAL_MS = 15_000;

/** A radar whose checks to list. `channel` labels its rows; null where the list is one radar's. */
export interface RadarChecksTarget {
  radarId: string;
  channel: string | null;
}

export interface UseRadarChecksResult {
  view: RadarChecksView;
  refetch: () => void;
}

/**
 * The checks of the given radars as one list, newest first. Mount this only
 * while the list is on screen: the query, and its polling, live exactly as
 * long as the caller.
 */
export function useRadarChecks(input: {
  serverId: string;
  targets: readonly RadarChecksTarget[];
}): UseRadarChecksResult {
  const { serverId, targets } = input;
  const { t } = useTranslation();
  const unavailableMessage = t("common.errors.daemonClientUnavailable");
  // The key holds ids only, so renaming a channel relabels rows without a refetch.
  const radarIdsKey = targets.map((target) => target.radarId).join("|");

  const query = useFetchQuery({
    queryKey: radarChecksQueryKey(serverId, radarIdsKey),
    queryFn: async () => {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) {
        throw new Error(unavailableMessage);
      }
      const radarIds = radarIdsKey === "" ? [] : radarIdsKey.split("|");
      return Promise.all(
        radarIds.map(async (radarId) => {
          const payload = await client.radarListChecks({
            radarId,
            limit: RADAR_CHECK_HISTORY_PAGE_SIZE,
          });
          return { radarId, checks: payload.checks };
        }),
      );
    },
    dataShape: "list",
    staleTimeMs: 5_000,
    // The interval is the retry; the error state also offers one by hand.
    retry: false,
    refetchInterval: RADAR_CHECKS_REFETCH_INTERVAL_MS,
  });

  const view = useMemo(() => {
    const channelByRadarId = new Map(targets.map((target) => [target.radarId, target.channel]));
    return resolveRadarChecksView({
      groups: query.data?.map((group) => ({
        ...group,
        channel: channelByRadarId.get(group.radarId) ?? null,
      })),
      error: query.isError ? query.error : null,
    });
  }, [query.data, query.error, query.isError, targets]);

  return {
    view,
    refetch: () => {
      void query.refetch();
    },
  };
}
