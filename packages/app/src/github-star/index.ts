/**
 * The GitHub star prompt, ported from Orca's star nag. After enough agents it
 * asks once, stars Gravity through a connected host's gh CLI so the user never
 * leaves the app, and falls back to opening GitHub when no host can.
 *
 * Import from `@/github-star`, never a path within it.
 */
export { GitHubStarPromptHost } from "./github-star-prompt-host";
export { openGitHubStarPrompt, recordAgentCreatedForGitHubStar } from "./github-star-commands";
