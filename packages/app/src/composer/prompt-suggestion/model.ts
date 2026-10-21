import type { ComposerKeyPressEvent } from "@/composer/input/input";

export type PromptSuggestionKeyAction = "accept" | "dismiss" | null;

// Keys only mean something while the suggestion is showing, i.e. the input is
// empty; any other time Tab and Escape keep their usual behavior.
export function resolvePromptSuggestionKeyAction(
  event: Pick<ComposerKeyPressEvent, "key" | "input">,
  suggestion: string | null,
): PromptSuggestionKeyAction {
  if (!suggestion || event.input.text.length > 0) {
    return null;
  }
  if (event.key === "Tab") {
    return "accept";
  }
  if (event.key === "Escape") {
    return "dismiss";
  }
  return null;
}

const MAX_DISMISSED_TURNS = 200;
const dismissedTurns = new Set<string>();

function turnId(serverId: string, agentId: string, turnKey: string): string {
  return `${serverId}\u0000${agentId}\u0000${turnKey}`;
}

// Survives the composer remounting (tab switch, panel swap), so a suggestion
// the user already waved away for this turn stays gone.
export function dismissPromptSuggestionTurn(
  serverId: string,
  agentId: string,
  turnKey: string,
): void {
  dismissedTurns.add(turnId(serverId, agentId, turnKey));
  if (dismissedTurns.size > MAX_DISMISSED_TURNS) {
    const oldest = dismissedTurns.values().next().value;
    if (oldest !== undefined) {
      dismissedTurns.delete(oldest);
    }
  }
}

export function isPromptSuggestionTurnDismissed(
  serverId: string,
  agentId: string,
  turnKey: string,
): boolean {
  return dismissedTurns.has(turnId(serverId, agentId, turnKey));
}
