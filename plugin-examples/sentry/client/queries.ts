import type { SentryIssueListInput } from "../shared/contracts";

/** React Query keys. Each plugin installation has its own query client, so keys need no host. */
export const sentryKeys = {
  all: ["sentry"] as const,
  status: () => ["sentry", "status"] as const,
  projects: (organization: string) => ["sentry", "projects", organization] as const,
  issues: (input: Omit<SentryIssueListInput, "cursor">) => ["sentry", "issues", input] as const,
  issue: (organization: string, issueId: string) =>
    ["sentry", "issue", organization, issueId] as const,
  models: () => ["sentry", "models"] as const,
  gravityProjects: () => ["sentry", "gravity-projects"] as const,
};
