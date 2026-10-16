import { resolveSidebarWorkspacePrimaryLabel } from "@/components/sidebar/sidebar-workspace-title";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

import {
  resolveWorkspaceHeader,
  resolveWorkspaceHeaderRenderState,
  shouldRenderMissingWorkspaceDescriptor,
} from "./workspace-header-source";
import { createSidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { WorkspaceDescriptor } from "@/stores/session-store";

function createWorkspaceDescriptor(input: Partial<WorkspaceDescriptor> = {}): WorkspaceDescriptor {
  return {
    id: "/repo/main",
    projectId: "remote:github.com/gravity-code-hq/gravity",
    projectDisplayName: "gravity-code-hq/gravity",
    projectRootPath: "/repo/main",
    workspaceDirectory: "/repo/main",
    projectKind: "git",
    workspaceKind: "local_checkout",
    name: "Old first-chat title",
    gitRuntime: { currentBranch: "feat/workspace-sot", isDirty: false, aheadOfOrigin: 0 },
    status: "running",
    diffStat: null,
    scripts: [],
    statusEnteredAt: null,
    ...input,
    archivingAt: input.archivingAt ?? null,
  };
}

describe("workspace source of truth consumption", () => {
  it("ignores saved chat titles and uses the same workspace directory and branch in header and sidebar", () => {
    const workspace = createWorkspaceDescriptor();

    const header = resolveWorkspaceHeader({ workspace });
    const sidebarWorkspace = createSidebarWorkspaceEntry({
      serverId: "srv",
      workspace,
    });

    expect(header.title).toBe("main: feat/workspace-sot");
    expect(header.subtitle).toBe("");
    expect(resolveSidebarWorkspacePrimaryLabel({ workspace: sidebarWorkspace })).toBe(header.title);
    expect(sidebarWorkspace.statusBucket).toBe("running");
  });

  it("keeps the worktree name consistent in sidebar rows, tooltips, and headers", () => {
    const workspace = createWorkspaceDescriptor({
      workspaceDirectory: "/worktrees/friendly-husky/packages/app",
      worktreeSlug: "friendly-husky",
      workspaceKind: "worktree",
    });
    const sidebarWorkspace = createSidebarWorkspaceEntry({ serverId: "srv", workspace });
    const expectedTitle = "friendly-husky: feat/workspace-sot";

    expect(sidebarWorkspace.name).toBe(expectedTitle);
    expect(resolveSidebarWorkspacePrimaryLabel({ workspace: sidebarWorkspace })).toBe(
      expectedTitle,
    );
    expect(resolveWorkspaceHeader({ workspace }).title).toBe(expectedTitle);
  });

  it("maps the sidebar entry branch from gitRuntime.currentBranch", () => {
    const entry = createSidebarWorkspaceEntry({
      serverId: "srv",
      workspace: createWorkspaceDescriptor({
        name: "feat/workspace-sot",
        gitRuntime: {
          currentBranch: "feat/real-branch",
          isDirty: false,
          aheadOfOrigin: 0,
        },
      }),
    });

    expect(entry.currentBranch).toBe("feat/real-branch");
  });

  it("normalizes detached HEAD, blank, and missing branches to null", () => {
    const detached = createSidebarWorkspaceEntry({
      serverId: "srv",
      workspace: createWorkspaceDescriptor({
        gitRuntime: { currentBranch: "HEAD", isDirty: false, aheadOfOrigin: 0 },
      }),
    });
    const blank = createSidebarWorkspaceEntry({
      serverId: "srv",
      workspace: createWorkspaceDescriptor({
        gitRuntime: { currentBranch: "  ", isDirty: false, aheadOfOrigin: 0 },
      }),
    });
    const missing = createSidebarWorkspaceEntry({
      serverId: "srv",
      workspace: createWorkspaceDescriptor(),
    });

    expect(detached.currentBranch).toBeNull();
    expect(blank.currentBranch).toBeNull();
    expect(missing.currentBranch).toBe("feat/workspace-sot");
  });

  it("keeps the header skeleton while the workspace descriptor is missing", () => {
    expect(
      resolveWorkspaceHeaderRenderState({
        workspace: null,
        checkoutState: { kind: "pending" },
      }),
    ).toEqual({ kind: "skeleton" });
  });

  it("keeps cached git workspace identity visible while checkout status refreshes", () => {
    expect(
      resolveWorkspaceHeaderRenderState({
        workspace: createWorkspaceDescriptor({ projectKind: "git" }),
        checkoutState: { kind: "pending" },
      }),
    ).toEqual({
      kind: "ready",
      title: "main: feat/workspace-sot",
      subtitle: "",
      isSubtitleDistinct: false,
      isGitCheckout: false,
      currentBranchName: null,
    });
  });

  it("renders known non-git workspace identity while checkout status is pending", () => {
    expect(
      resolveWorkspaceHeaderRenderState({
        workspace: createWorkspaceDescriptor({
          projectKind: "non_git",
          workspaceKind: "directory",
          name: "notes",
          projectDisplayName: "Local folders",
        }),
        checkoutState: { kind: "pending" },
      }),
    ).toEqual({
      kind: "ready",
      title: "Local folders",
      subtitle: "",
      isSubtitleDistinct: false,
      isGitCheckout: false,
      currentBranchName: null,
    });
  });

  it("renders git checkout headers with branch affordance after checkout status resolves", () => {
    expect(
      resolveWorkspaceHeaderRenderState({
        workspace: createWorkspaceDescriptor(),
        checkoutState: {
          kind: "ready",
          checkout: { isGit: true, currentBranch: "feat/workspace-sot" },
        },
      }),
    ).toEqual({
      kind: "ready",
      title: "main: feat/workspace-sot",
      subtitle: "",
      isSubtitleDistinct: false,
      isGitCheckout: true,
      currentBranchName: "feat/workspace-sot",
    });
  });

  it("renders non-git checkout headers without branch affordance after checkout status resolves", () => {
    expect(
      resolveWorkspaceHeaderRenderState({
        workspace: createWorkspaceDescriptor({
          projectKind: "non_git",
          workspaceKind: "directory",
          name: "notes",
          projectDisplayName: "notes",
        }),
        checkoutState: {
          kind: "ready",
          checkout: { isGit: false, currentBranch: null },
        },
      }),
    ).toEqual({
      kind: "ready",
      title: "notes",
      subtitle: "",
      isSubtitleDistinct: false,
      isGitCheckout: false,
      currentBranchName: null,
    });
  });

  it("renders descriptor identity after checkout status errors", () => {
    expect(
      resolveWorkspaceHeaderRenderState({
        workspace: createWorkspaceDescriptor(),
        checkoutState: { kind: "error" },
      }),
    ).toEqual({
      kind: "ready",
      title: "main: feat/workspace-sot",
      subtitle: "",
      isSubtitleDistinct: false,
      isGitCheckout: false,
      currentBranchName: null,
    });
  });

  it("renders explicit missing state only after workspace hydration", () => {
    expect(
      shouldRenderMissingWorkspaceDescriptor({
        workspace: null,
        hasHydratedWorkspaces: true,
      }),
    ).toBe(true);

    expect(
      shouldRenderMissingWorkspaceDescriptor({
        workspace: null,
        hasHydratedWorkspaces: false,
      }),
    ).toBe(false);
  });
});
