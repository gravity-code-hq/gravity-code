import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { workspaceDisplayName } from "@/workspace/display-name";
import { STATUS_BUCKET_LABELS } from "@/hooks/sidebar-status-view-model";

export function resolveSidebarWorkspacePrimaryLabel(input: {
  workspace: Pick<
    SidebarWorkspaceEntry,
    "projectName" | "projectKind" | "currentBranch" | "workspaceDirectory" | "worktreeSlug"
  >;
}): string {
  return workspaceDisplayName(input.workspace);
}

export function resolveSidebarWorkspaceAccessibilityLabel(input: {
  workspace: Pick<
    SidebarWorkspaceEntry,
    | "projectName"
    | "projectKind"
    | "currentBranch"
    | "workspaceDirectory"
    | "worktreeSlug"
    | "statusBucket"
  >;
  leadingProjectName?: string | null;
  hostBadgeLabel?: string | null;
  pullRequestLabel?: string | null;
  serviceLabel?: string | null;
}): string {
  return [
    input.leadingProjectName,
    resolveSidebarWorkspacePrimaryLabel(input),
    input.hostBadgeLabel,
    input.pullRequestLabel,
    input.serviceLabel,
    input.workspace.statusBucket === "done"
      ? null
      : STATUS_BUCKET_LABELS[input.workspace.statusBucket],
  ]
    .filter((label): label is string => Boolean(label))
    .join(", ");
}
