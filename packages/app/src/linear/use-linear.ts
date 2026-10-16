import { useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@gravity/client/internal/daemon-client";
import type {
  LinearIssue,
  LinearIssueDetail,
  LinearIssueListFilter,
  LinearStatus,
  LinearTeam,
} from "@gravity/protocol/linear/types";
import { fetchQueryOptions, useFetchQuery } from "@/data/query";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export const LINEAR_ISSUES_PAGE_SIZE = 50;

export const linearQueryBaseKey = ["linear"] as const;

export function linearStatusQueryKey(serverId: string) {
  return [...linearQueryBaseKey, serverId, "status"] as const;
}

export function linearTeamsQueryKey(serverId: string) {
  return [...linearQueryBaseKey, serverId, "teams"] as const;
}

export interface LinearIssueListQuery {
  filter: LinearIssueListFilter;
  teamId: string | null;
  search: string;
}

export function linearIssuesQueryKey(
  serverId: string,
  query: LinearIssueListQuery,
  after: string | null,
) {
  return [
    ...linearQueryBaseKey,
    serverId,
    "issues",
    query.filter,
    query.teamId ?? "",
    query.search,
    after,
  ] as const;
}

export function linearIssueQueryKey(serverId: string, issueId: string) {
  return [...linearQueryBaseKey, serverId, "issue", issueId] as const;
}

const STATUS_STALE_TIME_MS = 5 * 60 * 1000;
const TEAMS_STALE_TIME_MS = 10 * 60 * 1000;
const ISSUES_STALE_TIME_MS = 60 * 1000;

type LinearClient = Pick<
  DaemonClient,
  | "linearGetStatus"
  | "linearConnect"
  | "linearDisconnect"
  | "linearListTeams"
  | "linearListIssues"
  | "linearGetIssue"
  | "linearSetIssueState"
>;

export type LinearHostAvailability =
  | { kind: "offline" }
  | { kind: "unsupported" }
  | { kind: "available"; client: LinearClient };

/** One answer to "can this host serve Linear right now", shared by every hook below. */
export function useLinearHost(serverId: string): LinearHostAvailability {
  const client: LinearClient | null = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const isSupported = useHostFeature(serverId, "linearIntegration");
  return useMemo<LinearHostAvailability>(() => {
    if (!client || !isConnected) return { kind: "offline" };
    if (!isSupported) return { kind: "unsupported" };
    return { kind: "available", client };
  }, [client, isConnected, isSupported]);
}

export type LinearStatusView =
  | { kind: "offline" }
  | { kind: "unsupported" }
  | { kind: "loading" }
  | { kind: "error"; error: unknown }
  | { kind: "ready"; status: LinearStatus };

export function useLinearStatus(serverId: string) {
  const host = useLinearHost(serverId);
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => linearStatusQueryKey(serverId), [serverId]);
  const client = host.kind === "available" ? host.client : null;

  const query = useFetchQuery({
    queryKey,
    dataShape: "value",
    staleTimeMs: STATUS_STALE_TIME_MS,
    enabled: client !== null,
    queryFn: async () => {
      if (!client) throw new Error("Host unavailable");
      const payload = await client.linearGetStatus();
      return payload.status;
    },
    retry: false,
    refetchOnWindowFocus: false,
  });

  const resetLinearCaches = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: [...linearQueryBaseKey, serverId] });
  }, [queryClient, serverId]);

  const connect = useMutation({
    mutationFn: async (apiKey: string) => {
      if (!client) throw new Error("Host unavailable");
      const payload = await client.linearConnect({ apiKey });
      return payload.status;
    },
    onSuccess: async (status) => {
      queryClient.setQueryData(queryKey, status);
      await resetLinearCaches();
    },
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      if (!client) throw new Error("Host unavailable");
      await client.linearDisconnect();
    },
    onSuccess: async () => {
      queryClient.setQueryData<LinearStatus>(queryKey, { kind: "disconnected" });
      await resetLinearCaches();
    },
  });

  const view = useMemo<LinearStatusView>(() => {
    if (host.kind === "offline") return { kind: "offline" };
    if (host.kind === "unsupported") return { kind: "unsupported" };
    if (query.data) return { kind: "ready", status: query.data };
    if (query.isError) return { kind: "error", error: query.error };
    return { kind: "loading" };
  }, [host.kind, query.data, query.error, query.isError]);

  return { view, connect, disconnect, refetch: query.refetch };
}

export function useLinearTeams(serverId: string, enabled: boolean) {
  const host = useLinearHost(serverId);
  const client = host.kind === "available" ? host.client : null;
  return useFetchQuery({
    queryKey: linearTeamsQueryKey(serverId),
    dataShape: "list",
    staleTimeMs: TEAMS_STALE_TIME_MS,
    enabled: enabled && client !== null,
    queryFn: async (): Promise<LinearTeam[]> => {
      if (!client) throw new Error("Host unavailable");
      const payload = await client.linearListTeams();
      return payload.teams;
    },
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export interface LinearIssueList {
  issues: LinearIssue[];
  hasMore: boolean;
  endCursor: string | null;
}

export function useLinearIssues(
  serverId: string,
  query: LinearIssueListQuery,
  after: string | null,
) {
  const host = useLinearHost(serverId);
  const client = host.kind === "available" ? host.client : null;
  return useFetchQuery({
    queryKey: linearIssuesQueryKey(serverId, query, after),
    dataShape: "value",
    staleTimeMs: ISSUES_STALE_TIME_MS,
    enabled: client !== null,
    queryFn: async (): Promise<LinearIssueList> => {
      if (!client) throw new Error("Host unavailable");
      const payload = await client.linearListIssues({
        after: after ?? undefined,
        limit: LINEAR_ISSUES_PAGE_SIZE,
        filter: query.filter,
        teamId: query.teamId ?? undefined,
        search: query.search || undefined,
      });
      // COMPAT(linearIssuePagination): added in v0.8.1, remove after 2027-03-25.
      return {
        issues: payload.issues,
        hasMore: payload.hasMore,
        endCursor: payload.endCursor ?? null,
      };
    },
    retry: false,
    refetchOnWindowFocus: false,
  });
}

async function fetchLinearIssue(
  client: LinearClient | null,
  issueId: string,
): Promise<LinearIssueDetail> {
  if (!client) throw new Error("Host unavailable");
  const payload = await client.linearGetIssue({ issueId });
  return payload.issue;
}

export function useLinearIssue(serverId: string, issueId: string | null) {
  const host = useLinearHost(serverId);
  const client = host.kind === "available" ? host.client : null;
  return useFetchQuery({
    queryKey: linearIssueQueryKey(serverId, issueId ?? ""),
    dataShape: "value",
    staleTimeMs: ISSUES_STALE_TIME_MS,
    enabled: issueId !== null && client !== null,
    queryFn: () => fetchLinearIssue(client, issueId ?? ""),
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/**
 * Imperative read of one issue's detail through the same cache entry the drawer
 * uses, for actions that need the full issue without opening it (Start agent
 * from a row).
 */
export function useLinearIssueFetcher(serverId: string) {
  const host = useLinearHost(serverId);
  const client = host.kind === "available" ? host.client : null;
  const queryClient = useQueryClient();
  return useCallback(
    (issueId: string): Promise<LinearIssueDetail> =>
      queryClient.fetchQuery(
        fetchQueryOptions({
          queryKey: linearIssueQueryKey(serverId, issueId),
          dataShape: "value",
          staleTimeMs: ISSUES_STALE_TIME_MS,
          queryFn: () => fetchLinearIssue(client, issueId),
          retry: false,
        }),
      ),
    [client, queryClient, serverId],
  );
}

export interface LinearSetIssueStateInput {
  issueId: string;
  stateId: string;
}

export function useLinearSetIssueState(serverId: string) {
  const host = useLinearHost(serverId);
  const client = host.kind === "available" ? host.client : null;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: LinearSetIssueStateInput): Promise<LinearIssue> => {
      if (!client) throw new Error("Host unavailable");
      const payload = await client.linearSetIssueState(input);
      return payload.issue;
    },
    onSuccess: async (issue) => {
      queryClient.setQueryData<LinearIssueDetail>(
        linearIssueQueryKey(serverId, issue.id),
        (current) => (current ? { ...current, ...issue } : current),
      );
      // Patch the row in place so the pill flips before the lists refetch.
      queryClient.setQueriesData<LinearIssueList>(
        { queryKey: [...linearQueryBaseKey, serverId, "issues"] },
        (current) =>
          current
            ? {
                ...current,
                issues: current.issues.map((row) => (row.id === issue.id ? issue : row)),
              }
            : current,
      );
      await queryClient.invalidateQueries({
        queryKey: [...linearQueryBaseKey, serverId, "issues"],
      });
    },
  });
}

/** The `code` a daemon `rpc_error` carried, when the failure came from one. */
export function linearErrorCode(error: unknown): string | null {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return null;
}
