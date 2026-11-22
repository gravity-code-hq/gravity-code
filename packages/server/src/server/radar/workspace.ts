import path from "node:path";
import type { PersistedWorkspaceRecord } from "../workspace-registry.js";

/**
 * The workspace a radar's tasks run in: the one the user already has open on
 * the project folder, so Radar conversations sit next to their own. With
 * several on the same folder the oldest wins, which keeps the choice stable as
 * newer ones come and go. Worktree workspaces are someone's branch in
 * progress and are never used. Null means the folder has no workspace yet.
 */
export function selectRadarWorkspace(
  workspaces: readonly PersistedWorkspaceRecord[],
  cwd: string,
): PersistedWorkspaceRecord | null {
  const target = path.resolve(cwd);
  const candidates = workspaces
    .filter(
      (workspace) =>
        !workspace.archivedAt && workspace.kind !== "worktree" && workspace.cwd === target,
    )
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
  return candidates[0] ?? null;
}
