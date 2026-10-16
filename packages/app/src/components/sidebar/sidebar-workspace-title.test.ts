import { describe, expect, it } from "vitest";
import {
  resolveSidebarWorkspaceAccessibilityLabel,
  resolveSidebarWorkspacePrimaryLabel,
} from "@/components/sidebar/sidebar-workspace-title";

describe("resolveSidebarWorkspacePrimaryLabel", () => {
  it.each([
    "/worktrees/friendly-husky",
    "/worktrees/friendly-husky/",
    "C:\\worktrees\\friendly-husky\\",
  ])("uses the worktree directory and branch for %s", (workspaceDirectory) => {
    const label = resolveSidebarWorkspacePrimaryLabel({
      workspace: {
        workspaceDirectory,
        projectName: "gravity",
        projectKind: "git",
        currentBranch: "fix/search",
      },
    });

    expect(label).toBe("friendly-husky: fix/search");
  });

  it("uses the worktree slug when the workspace is in a subdirectory", () => {
    const label = resolveSidebarWorkspacePrimaryLabel({
      workspace: {
        workspaceDirectory: "/worktrees/friendly-husky/packages/app",
        worktreeSlug: "friendly-husky",
        projectName: "gravity",
        projectKind: "git",
        currentBranch: "fix/search",
      },
    });

    expect(label).toBe("friendly-husky: fix/search");
  });

  it("uses the project name for a directory without Git", () => {
    const label = resolveSidebarWorkspacePrimaryLabel({
      workspace: {
        workspaceDirectory: "/worktrees/friendly-husky",
        projectName: "Local folder",
        projectKind: "non_git",
        currentBranch: null,
      },
    });

    expect(label).toBe("Local folder");
  });
});

describe("resolveSidebarWorkspaceAccessibilityLabel", () => {
  it("includes the visible host badge with the workspace title", () => {
    const label = resolveSidebarWorkspaceAccessibilityLabel({
      workspace: {
        workspaceDirectory: "/worktrees/friendly-husky",
        projectName: "gravity",
        projectKind: "git",
        currentBranch: "fix/search",
        statusBucket: "done",
      },
      hostBadgeLabel: "Build host",
    });

    expect(label).toBe("friendly-husky: fix/search, Build host");
  });

  it("owns every visual row contributor in one accessible label", () => {
    const label = resolveSidebarWorkspaceAccessibilityLabel({
      workspace: {
        workspaceDirectory: "/worktrees/friendly-husky",
        projectName: "gravity",
        projectKind: "git",
        currentBranch: "fix/search",
        statusBucket: "running",
      },
      leadingProjectName: "Search project",
      hostBadgeLabel: "Build host",
      pullRequestLabel: "Pull request 42",
      serviceLabel: "Service web running",
    });

    expect(label).toBe(
      "Search project, friendly-husky: fix/search, Build host, Pull request 42, Service web running, Working",
    );
  });

  it("omits the idle status from the workspace label", () => {
    const label = resolveSidebarWorkspaceAccessibilityLabel({
      workspace: {
        workspaceDirectory: "/worktrees/friendly-husky",
        projectName: "gravity",
        projectKind: "git",
        currentBranch: "fix/search",
        statusBucket: "done",
      },
      leadingProjectName: "Search project",
      hostBadgeLabel: "Build host",
    });

    expect(label).toBe("Search project, friendly-husky: fix/search, Build host");
  });
});
