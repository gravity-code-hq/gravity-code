import { useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@gravity/client/internal/daemon-client";
import type { ProviderAccountsListResponseMessage } from "@gravity/protocol/messages";
import { useFetchQuery } from "@/data/query";
import { providerUsageQueryKey } from "@/provider-usage/use-provider-usage";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export type ProviderAccountsListPayload = ProviderAccountsListResponseMessage["payload"];

export type ProviderAccountsView =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; payload: ProviderAccountsListPayload; isRefreshing: boolean };

const PROVIDER_ACCOUNTS_STALE_TIME_MS = 5 * 60 * 1000;

type ProviderAccountsClient = Pick<
  DaemonClient,
  "listProviderAccounts" | "activateProviderAccount" | "removeProviderAccount"
>;

export function providerAccountsQueryKey(serverId: string | null | undefined) {
  return ["providerAccounts", serverId ?? ""] as const;
}

export interface ProviderAccountTarget {
  providerId: string;
  accountId: string;
}

export function useProviderAccounts(serverId: string) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const client: ProviderAccountsClient | null = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const isSupported = useHostFeature(serverId, "providerAccounts");
  const queryKey = useMemo(() => providerAccountsQueryKey(serverId), [serverId]);
  const canFetch = Boolean(client && isConnected && isSupported);

  const query = useFetchQuery({
    queryKey,
    dataShape: "value",
    staleTimeMs: PROVIDER_ACCOUNTS_STALE_TIME_MS,
    enabled: canFetch,
    queryFn: async () => {
      if (!client) throw new Error(t("settings.accounts.clientUnavailable"));
      return client.listProviderAccounts();
    },
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
    // The Host Usage page reads the live login, which a switch just changed.
    await queryClient.invalidateQueries({ queryKey: providerUsageQueryKey(serverId) });
  }, [queryClient, queryKey, serverId]);

  const refresh = useCallback(async () => {
    if (!client || !canFetch) return;
    await queryClient.fetchQuery({
      queryKey,
      queryFn: () => client.listProviderAccounts({ refresh: true }),
      staleTime: 0,
    });
  }, [canFetch, client, queryClient, queryKey]);

  const requireClient = useCallback(() => {
    if (!client) throw new Error(t("settings.accounts.clientUnavailable"));
    return client;
  }, [client, t]);

  const activate = useMutation({
    mutationFn: (target: ProviderAccountTarget) => requireClient().activateProviderAccount(target),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (target: ProviderAccountTarget) => requireClient().removeProviderAccount(target),
    onSuccess: invalidate,
  });

  const view = useMemo<ProviderAccountsView>(() => {
    if (!client || !isConnected) {
      return { kind: "error", message: t("settings.accounts.hostUnavailable") };
    }
    if (!isSupported) {
      return { kind: "error", message: t("settings.accounts.hostUpgradeRequired") };
    }
    if (query.data) {
      return { kind: "ready", payload: query.data, isRefreshing: query.isFetching };
    }
    if (query.isError) {
      return {
        kind: "error",
        message: query.error instanceof Error ? query.error.message : String(query.error),
      };
    }
    return { kind: "loading" };
  }, [
    client,
    isConnected,
    isSupported,
    query.data,
    query.error,
    query.isError,
    query.isFetching,
    t,
  ]);

  return { view, refresh, activate, remove };
}
