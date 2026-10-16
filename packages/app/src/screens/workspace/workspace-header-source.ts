import { workspaceDisplayName } from "@/workspace/display-name";
import type { WorkspaceDescriptor } from "@/stores/session-store";

export type WorkspaceHeaderCheckoutState =
  | { kind: "pending" }
  | { kind: "error" }
  | { kind: "ready"; checkout: { isGit: boolean; currentBranch: string | null } };

type WorkspaceHeaderRenderState =
  | { kind: "skeleton" }
  | {
      kind: "ready";
      title: string;
      subtitle: string;
      /**
       * Whether the project name says anything the workspace name doesn't. It is the fact, not
       * the verdict: a header that stacks the two lines shows the project either way, and one
       * that sets them side by side drops the repeat.
       */
      isSubtitleDistinct: boolean;
      isGitCheckout: boolean;
      currentBranchName: string | null;
    };

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveWorkspaceHeader(input: { workspace: WorkspaceDescriptor }): {
  title: string;
  subtitle: string;
} {
  return {
    title: workspaceDisplayName({
      projectName: input.workspace.projectCustomName ?? input.workspace.projectDisplayName,
      projectKind: input.workspace.projectKind,
      workspaceDirectory: input.workspace.workspaceDirectory,
      worktreeSlug: input.workspace.worktreeSlug,
      currentBranch: input.workspace.gitRuntime?.currentBranch ?? null,
    }),
    subtitle: "",
  };
}

export function resolveWorkspaceHeaderRenderState(input: {
  workspace: WorkspaceDescriptor | null;
  checkoutState: WorkspaceHeaderCheckoutState;
}): WorkspaceHeaderRenderState {
  if (!input.workspace) {
    return { kind: "skeleton" };
  }

  const checkout = input.checkoutState.kind === "ready" ? input.checkoutState.checkout : null;
  const currentBranchName =
    checkout?.isGit && checkout.currentBranch !== "HEAD"
      ? trimNonEmpty(checkout.currentBranch)
      : null;

  return {
    kind: "ready",
    title: workspaceDisplayName({
      projectName: input.workspace.projectCustomName ?? input.workspace.projectDisplayName,
      projectKind: input.workspace.projectKind,
      workspaceDirectory: input.workspace.workspaceDirectory,
      worktreeSlug: input.workspace.worktreeSlug,
      currentBranch: checkout
        ? checkout.currentBranch
        : (input.workspace.gitRuntime?.currentBranch ?? null),
    }),
    subtitle: "",
    isSubtitleDistinct: false,
    isGitCheckout: checkout?.isGit ?? false,
    currentBranchName,
  };
}

export function shouldRenderMissingWorkspaceDescriptor(input: {
  workspace: WorkspaceDescriptor | null;
  hasHydratedWorkspaces: boolean;
}): boolean {
  return !input.workspace && input.hasHydratedWorkspaces;
}
