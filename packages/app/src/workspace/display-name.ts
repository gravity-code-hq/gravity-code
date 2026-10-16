import type { WorkspaceDescriptor } from "@/stores/session-store";

export function workspaceDisplayName(input: {
  projectName: string;
  projectKind: WorkspaceDescriptor["projectKind"] | "unknown";
  currentBranch: string | null;
  workspaceDirectory: string;
  worktreeSlug?: string | null;
}): string {
  if (input.projectKind !== "git") return input.projectName;
  const worktreeName =
    input.worktreeSlug ??
    input.workspaceDirectory.split(/[\\/]/).findLast(Boolean) ??
    input.workspaceDirectory;
  return `${worktreeName}: ${input.currentBranch || "HEAD"}`;
}
