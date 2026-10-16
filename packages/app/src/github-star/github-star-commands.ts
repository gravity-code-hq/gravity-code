import { resolveAppVersion } from "@/utils/app-version";
import { presentStarPrompt } from "./internal/present-star-prompt";
import { isStarPromptDue } from "./internal/star-prompt-policy";
import { useStarPromptStore } from "./internal/star-prompt-store";

// Let the new agent's screen settle before a sheet slides over it.
const SCHEDULED_PROMPT_DELAY_MS = 5_000;

/** Counts an agent the user created from this app toward the automatic ask. */
export function recordAgentCreatedForGitHubStar(): void {
  const store = useStarPromptStore.getState();
  store.recordAgentCreated(resolveAppVersion());
  if (!isStarPromptDue(useStarPromptStore.getState().schedule, Date.now())) {
    return;
  }
  setTimeout(() => {
    void presentStarPrompt("schedule");
  }, SCHEDULED_PROMPT_DELAY_MS);
}

/** Opens the star prompt on request, whatever the automatic schedule says. */
export function openGitHubStarPrompt(): void {
  void presentStarPrompt("manual");
}
