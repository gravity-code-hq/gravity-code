import { skipToken } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useShallow } from "zustand/shallow";
import type { DaemonClient } from "@gravity/client/internal/daemon-client";
import { useFetchQuery } from "@/data/query";
import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import { dismissPromptSuggestionTurn, isPromptSuggestionTurnDismissed } from "./model";

export interface PromptSuggestionState {
  // The suggestion to show as the placeholder, or null when there is none to show.
  suggestion: string | null;
  dismiss: () => void;
}

interface UsePromptSuggestionInput {
  serverId: string;
  agentId: string;
  client: DaemonClient | null;
  isConnected: boolean;
  // False for composers that do not talk to a live agent (drafts, terminals, read-only).
  enabled: boolean;
  isAgentRunning: boolean;
  isInputEmpty: boolean;
}

export function usePromptSuggestion(input: UsePromptSuggestionInput): PromptSuggestionState {
  const supported = useHostFeature(input.serverId, "promptSuggestions");
  const agentTurn = useSessionStore(
    useShallow((state) => {
      const agent = state.sessions[input.serverId]?.agents?.get(input.agentId);
      return {
        isIdle: agent?.status === "idle",
        lastUserMessageAt: agent?.lastUserMessageAt?.getTime() ?? 0,
      };
    }),
  );
  const [dismissedTurnKey, setDismissedTurnKey] = useState<string | null>(null);

  const canSuggest =
    input.enabled &&
    supported &&
    input.isConnected &&
    input.client !== null &&
    agentTurn.isIdle &&
    !input.isAgentRunning;

  // Generation is a real provider call on the user's quota, so it only starts
  // when this composer is empty and actually waiting for the user's next turn.
  const client = input.client;
  const query = useFetchQuery({
    dataShape: "value",
    queryKey: [
      "agent-prompt-suggestion",
      input.serverId,
      input.agentId,
      agentTurn.lastUserMessageAt,
    ],
    queryFn: client ? () => client.getAgentPromptSuggestion(input.agentId) : skipToken,
    enabled: canSuggest && input.isInputEmpty,
    // The daemon caches per turn, so asking again on remount is cheap and
    // picks up a turn the agent started on its own.
    staleTimeMs: 0,
    gcTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const turnKey = query.data?.turnKey ?? null;
  const dismissed =
    turnKey !== null &&
    (dismissedTurnKey === turnKey ||
      isPromptSuggestionTurnDismissed(input.serverId, input.agentId, turnKey));
  const suggestion =
    canSuggest && input.isInputEmpty && !dismissed ? (query.data?.suggestion ?? null) : null;

  const dismiss = useCallback(() => {
    if (turnKey === null) {
      return;
    }
    dismissPromptSuggestionTurn(input.serverId, input.agentId, turnKey);
    setDismissedTurnKey(turnKey);
  }, [input.agentId, input.serverId, turnKey]);

  return { suggestion, dismiss };
}
