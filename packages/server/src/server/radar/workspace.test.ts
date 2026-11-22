import { describe, expect, test } from "vitest";
import type { PersistedWorkspaceRecord } from "../workspace-registry.js";
import { selectRadarWorkspace } from "./workspace.js";

function workspace(overrides: Partial<PersistedWorkspaceRecord>): PersistedWorkspaceRecord {
  return {
    workspaceId: "wks_default",
    projectId: "prj_1",
    cwd: "/repo",
    kind: "local_checkout",
    displayName: "main",
    title: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    archivedAt: null,
    ...overrides,
  } as PersistedWorkspaceRecord;
}

describe("selectRadarWorkspace", () => {
  test("uses the workspace already open on the project folder", () => {
    const existing = workspace({ workspaceId: "wks_mine" });

    expect(selectRadarWorkspace([existing], "/repo")?.workspaceId).toBe("wks_mine");
  });

  test("a git checkout's workspace counts, whatever its kind is called", () => {
    const checkout = workspace({ workspaceId: "wks_checkout", kind: "local_checkout" });
    const directory = workspace({
      workspaceId: "wks_directory",
      kind: "directory",
      cwd: "/notes",
    });

    expect(selectRadarWorkspace([checkout, directory], "/repo")?.workspaceId).toBe("wks_checkout");
    expect(selectRadarWorkspace([checkout, directory], "/notes")?.workspaceId).toBe(
      "wks_directory",
    );
  });

  test("with several on the same folder the oldest wins", () => {
    const older = workspace({ workspaceId: "wks_older", createdAt: "2026-10-06T00:00:00.000Z" });
    const newer = workspace({ workspaceId: "wks_newer", createdAt: "2026-11-14T00:00:00.000Z" });

    expect(selectRadarWorkspace([newer, older], "/repo")?.workspaceId).toBe("wks_older");
  });

  test("skips archived workspaces, worktrees, and other folders", () => {
    const archived = workspace({
      workspaceId: "wks_archived",
      archivedAt: "2026-11-02T00:00:00.000Z",
    });
    const worktree = workspace({ workspaceId: "wks_worktree", kind: "worktree" });
    const elsewhere = workspace({ workspaceId: "wks_elsewhere", cwd: "/other" });

    expect(selectRadarWorkspace([archived, worktree, elsewhere], "/repo")).toBeNull();
  });
});
