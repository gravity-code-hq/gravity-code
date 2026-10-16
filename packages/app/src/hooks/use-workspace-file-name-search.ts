import { useEffect, useState } from "react";
import { useSessionStore } from "@/stores/session-store";

export type WorkspaceFileNameSearchState =
  | { status: "idle" }
  | { status: "loading"; previous: readonly string[] }
  | { status: "error"; message: string }
  | { status: "success"; paths: readonly string[] };

const NAME_SEARCH_DEBOUNCE_MS = 100;
const NAME_SEARCH_LIMIT = 100;

function carriedPaths(state: WorkspaceFileNameSearchState): readonly string[] {
  if (state.status === "success") return state.paths;
  if (state.status === "loading") return state.previous;
  return [];
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (error.name !== "DaemonRpcError") return error.message;
  return error.message.replace(/ requestType=\S+(?: code=\S+)?$/, "");
}

/**
 * Fuzzy file-name search for the Explorer Search pane. Same daemon lookup the
 * command center's file scope uses, scoped to an explicit workspace rather than
 * the active selection.
 */
export function useWorkspaceFileNameSearch(input: {
  serverId: string;
  workspaceRoot: string | null;
  query: string;
  enabled: boolean;
}): WorkspaceFileNameSearchState {
  const { serverId, workspaceRoot, query, enabled } = input;
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const [state, setState] = useState<WorkspaceFileNameSearchState>({ status: "idle" });

  useEffect(() => {
    if (!enabled || !client || !workspaceRoot || query.trim().length === 0) {
      setState({ status: "idle" });
      return;
    }
    const activeClient = client;
    const activeRoot = workspaceRoot;
    let cancelled = false;
    setState((previous) => ({ status: "loading", previous: carriedPaths(previous) }));
    async function search(): Promise<void> {
      try {
        const payload = await activeClient.getDirectorySuggestions({
          cwd: activeRoot,
          query,
          includeFiles: true,
          includeDirectories: false,
          limit: NAME_SEARCH_LIMIT,
        });
        if (cancelled) return;
        if (payload.error) {
          setState({ status: "error", message: payload.error });
          return;
        }
        setState({
          status: "success",
          paths: payload.entries.map((entry) => entry.path.replace(/\\/g, "/")),
        });
      } catch (error) {
        if (!cancelled) setState({ status: "error", message: errorMessage(error) });
      }
    }
    const timer = setTimeout(() => void search(), NAME_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, enabled, query, workspaceRoot]);

  return state;
}
