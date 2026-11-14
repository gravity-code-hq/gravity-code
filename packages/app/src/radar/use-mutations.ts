import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@gravity/client/internal/daemon-client";
import type { RadarStatus, StoredRadar } from "@gravity/protocol/radar/types";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import {
  radarListQueryKey,
  radarsQueryKey,
  removeAggregatedRadar,
  upsertAggregatedRadar,
  type FetchAggregatedRadarsState,
} from "./aggregated";

export type RadarCreateInput = Omit<Parameters<DaemonClient["radarCreate"]>[0], "requestId">;
export type RadarUpdateInput = Omit<Parameters<DaemonClient["radarUpdate"]>[0], "requestId">;
export type RadarCheckNowInput = Omit<Parameters<DaemonClient["radarCheckNow"]>[0], "requestId">;

export interface RadarMutations {
  createRadar: (input: RadarCreateInput) => Promise<void>;
  updateRadar: (input: RadarUpdateInput) => Promise<void>;
  setRadarStatus: (radarId: string, status: RadarStatus) => Promise<void>;
  deleteRadar: (radarId: string) => Promise<void>;
  checkRadarNow: (input: RadarCheckNowInput) => Promise<void>;
}

/**
 * Every RPC answers with the radar as the daemon now holds it, so the cached
 * list takes that copy directly and then refetches. A failed RPC rejects with
 * the daemon's message and leaves the cache alone; callers own the failure UI.
 */
export function useRadarMutations(serverId: string): RadarMutations {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMemo(() => {
    const listQueryKey = radarListQueryKey([serverId]);

    function requireClient(): DaemonClient {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      return client;
    }

    // The host's whole subtree, so an open check history refetches with the list.
    function refetch(): void {
      void queryClient.invalidateQueries({ queryKey: radarsQueryKey([serverId]) });
    }

    function store(radar: StoredRadar): void {
      queryClient.setQueriesData<FetchAggregatedRadarsState>(
        { queryKey: listQueryKey },
        (current) => upsertAggregatedRadar(current, { ...radar, serverId }),
      );
      refetch();
    }

    return {
      async createRadar(input) {
        const payload = await requireClient().radarCreate(input);
        store(payload.radar);
      },
      async updateRadar(input) {
        const payload = await requireClient().radarUpdate(input);
        store(payload.radar);
      },
      async setRadarStatus(radarId, status) {
        const payload = await requireClient().radarSetStatus({ radarId, status });
        store(payload.radar);
      },
      async deleteRadar(radarId) {
        const payload = await requireClient().radarDelete({ radarId });
        queryClient.setQueriesData<FetchAggregatedRadarsState>(
          { queryKey: listQueryKey },
          (current) => removeAggregatedRadar(current, { serverId, id: payload.radarId }),
        );
        refetch();
      },
      // The response returns once the check is queued; the refetch and the
      // screen's polling pick up what the check finds.
      async checkRadarNow(input) {
        const payload = await requireClient().radarCheckNow(input);
        store(payload.radar);
      },
    };
  }, [queryClient, serverId, t]);
}
