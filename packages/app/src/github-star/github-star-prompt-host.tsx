import { StarPromptSheet } from "./internal/star-prompt-sheet";

/** Mounted once by the app shell so any trigger can open the star prompt. */
export function GitHubStarPromptHost() {
  return <StarPromptSheet />;
}
