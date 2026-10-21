import { useEffect, useMemo, useRef, useState } from "react";
import type { FileContentSearchFile } from "@gravity/protocol/messages";
import { usePanelStore } from "@/stores/panel-store";
import { useSessionStore } from "@/stores/session-store";

export interface WorkspaceContentSearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  include: string;
  exclude: string;
}

export interface WorkspaceContentSearchResult {
  files: readonly FileContentSearchFile[];
  totalMatches: number;
  truncated: boolean;
}

export type WorkspaceContentSearchState =
  | { status: "idle" }
  | { status: "loading"; previous: WorkspaceContentSearchResult | null }
  | { status: "error"; message: string }
  | { status: "success"; result: WorkspaceContentSearchResult };

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MAX_RESULTS = 2000;

/** The result a rerun keeps on screen until the next one lands. */
function carriedResult(state: WorkspaceContentSearchState): WorkspaceContentSearchResult | null {
  if (state.status === "success") return state.result;
  if (state.status === "loading") return state.previous;
  return null;
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (error.name !== "DaemonRpcError") return error.message;
  return error.message.replace(/ requestType=\S+(?: code=\S+)?$/, "");
}

/**
 * Debounced workspace-wide content search against the daemon. Every change to
 * the query or options restarts the debounce; `runId` forces an immediate rerun
 * with unchanged inputs (Enter in the search field).
 */
export function useWorkspaceContentSearch(input: {
  serverId: string;
  workspaceRoot: string | null;
  query: string;
  options: WorkspaceContentSearchOptions;
  enabled: boolean;
  runId: number;
}): WorkspaceContentSearchState {
  const { serverId, workspaceRoot, query, options, enabled, runId } = input;
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  // Search follows the Files pane's hidden-files toggle. Daemons without the
  // flag always search dotfiles, so nothing is sent to them.
  const supportsExcludeHidden = useSessionStore(
    (state) =>
      state.sessions[serverId]?.serverInfo?.features?.fsContentSearchExcludeHidden === true,
  );
  const showHiddenFiles = usePanelStore((state) => state.explorerShowHiddenFiles);
  const excludeHidden = supportsExcludeHidden ? !showHiddenFiles : undefined;
  const [state, setState] = useState<WorkspaceContentSearchState>({ status: "idle" });
  // The effect keys off `requestKey`, which already folds in every input; the
  // ref hands it the matching values without widening its dependency list.
  const latestInput = useRef({ query, options, excludeHidden });
  latestInput.current = { query, options, excludeHidden };
  const requestKey = useMemo(
    () =>
      enabled && workspaceRoot && query.length > 0
        ? [
            workspaceRoot,
            query,
            options.caseSensitive ? 1 : 0,
            options.wholeWord ? 1 : 0,
            options.regex ? 1 : 0,
            options.include,
            options.exclude,
            String(excludeHidden),
            runId,
          ].join("\0")
        : null,
    [
      enabled,
      excludeHidden,
      options.caseSensitive,
      options.exclude,
      options.include,
      options.regex,
      options.wholeWord,
      query,
      runId,
      workspaceRoot,
    ],
  );

  useEffect(() => {
    if (!requestKey || !client || !workspaceRoot) {
      setState({ status: "idle" });
      return;
    }
    const activeClient = client;
    const activeRoot = workspaceRoot;
    let cancelled = false;
    setState((previous) => ({ status: "loading", previous: carriedResult(previous) }));
    const {
      query: activeQuery,
      options: activeOptions,
      excludeHidden: activeExcludeHidden,
    } = latestInput.current;
    async function search(): Promise<void> {
      try {
        const payload = await activeClient.searchFileContents({
          cwd: activeRoot,
          query: activeQuery,
          caseSensitive: activeOptions.caseSensitive,
          wholeWord: activeOptions.wholeWord,
          regex: activeOptions.regex,
          include: activeOptions.include.trim() || undefined,
          exclude: activeOptions.exclude.trim() || undefined,
          maxResults: SEARCH_MAX_RESULTS,
          excludeHidden: activeExcludeHidden,
        });
        if (cancelled) return;
        if (payload.error) {
          setState({ status: "error", message: payload.error });
          return;
        }
        setState({
          status: "success",
          result: {
            files: payload.files,
            totalMatches: payload.totalMatches,
            truncated: payload.truncated,
          },
        });
      } catch (error) {
        if (!cancelled) setState({ status: "error", message: errorMessage(error) });
      }
    }
    const timer = setTimeout(() => void search(), SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, requestKey, workspaceRoot]);

  return state;
}
