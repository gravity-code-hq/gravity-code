import { join } from "node:path";

import { getGravityWorktreesRoot, isGravityOwnedWorktreeCwd } from "../../utils/worktree.js";
import {
  archiveByScope,
  resolveWorkspaceIdAtPath,
  type ArchiveDependencies,
  type ArchiveScope,
} from "../workspace-archive-service.js";
import type {
  CreateGravityWorktreeInput,
  CreateGravityWorktreeResult,
} from "../gravity-worktree-service.js";
import { toWorktreeWireError, type WorktreeWireError } from "../worktree-errors.js";
import type { WorkspaceGitService, WorkspaceGitWorktreeInfo } from "../workspace-git-service.js";

export interface ListGravityWorktreesCommandDependencies {
  workspaceGitService: Pick<WorkspaceGitService, "listWorktrees">;
}

export interface ListGravityWorktreesCommandInput {
  cwd: string;
  reason?: string;
}

export async function listGravityWorktreesCommand(
  dependencies: ListGravityWorktreesCommandDependencies,
  input: ListGravityWorktreesCommandInput,
): Promise<WorkspaceGitWorktreeInfo[]> {
  if (input.reason) {
    return dependencies.workspaceGitService.listWorktrees(input.cwd, { reason: input.reason });
  }
  return dependencies.workspaceGitService.listWorktrees(input.cwd);
}

type CreateGravityWorktreeWorkflow<Result extends CreateGravityWorktreeResult> = (
  input: CreateGravityWorktreeInput,
) => Promise<Result>;

export interface CreateGravityWorktreeCommandDependencies<
  Result extends CreateGravityWorktreeResult = CreateGravityWorktreeResult,
> {
  gravityHome?: string;
  worktreesRoot?: string;
  createGravityWorktreeWorkflow?: CreateGravityWorktreeWorkflow<Result>;
}

export type CreateGravityWorktreeCommandInput = Omit<
  CreateGravityWorktreeInput,
  "gravityHome" | "runSetup"
> & {
  gravityHome?: string;
  worktreesRoot?: string;
};

export type CreateGravityWorktreeCommandResult<Result extends CreateGravityWorktreeResult> =
  | {
      ok: true;
      createdWorktree: Result;
    }
  | {
      ok: false;
      error: WorktreeWireError;
      cause: unknown;
    };

export async function createGravityWorktreeCommand<Result extends CreateGravityWorktreeResult>(
  dependencies: CreateGravityWorktreeCommandDependencies<Result>,
  input: CreateGravityWorktreeCommandInput,
): Promise<CreateGravityWorktreeCommandResult<Result>> {
  try {
    if (!dependencies.createGravityWorktreeWorkflow) {
      throw new Error("Gravity worktree service is not configured");
    }

    const createdWorktree = await dependencies.createGravityWorktreeWorkflow({
      ...input,
      runSetup: false,
      gravityHome: input.gravityHome ?? dependencies.gravityHome,
      worktreesRoot: input.worktreesRoot ?? dependencies.worktreesRoot,
    });
    return { ok: true, createdWorktree };
  } catch (error) {
    return {
      ok: false,
      error: toWorktreeWireError(error),
      cause: error,
    };
  }
}

export interface ArchiveCommandDependencies extends Omit<
  ArchiveDependencies,
  "workspaceGitService"
> {
  workspaceGitService: Pick<WorkspaceGitService, "getSnapshot" | "listWorktrees">;
}

export interface ArchiveCommandInput {
  requestId: string;
  repoRoot?: string | null;
  worktreePath?: string;
  worktreeSlug?: string;
  branchName?: string;
  workspaceId?: string;
  scope?: ArchiveScope["kind"];
}

export type ArchiveCommandResult =
  | {
      ok: true;
      removedAgents: string[];
    }
  | {
      ok: false;
      code: "NOT_ALLOWED";
      message: string;
      removedAgents: [];
    };

export async function archiveCommand(
  dependencies: ArchiveCommandDependencies,
  input: ArchiveCommandInput,
): Promise<ArchiveCommandResult> {
  const targetPath = await resolveArchiveTarget(dependencies, input);
  const scope = input.scope ?? "workspace";
  const ownership = await isGravityOwnedWorktreeCwd(targetPath, {
    gravityHome: dependencies.gravityHome,
    worktreesRoot: dependencies.gravityWorktreesBaseRoot,
  });

  if (scope === "worktree") {
    if (!ownership.allowed) {
      return {
        ok: false,
        code: "NOT_ALLOWED",
        message: "Worktree is not a Gravity-owned worktree",
        removedAgents: [],
      };
    }

    const result = await archiveByScope(dependencies, {
      scope: { kind: "worktree", targetPath },
      requestId: input.requestId,
    });

    return {
      ok: true,
      removedAgents: result.archivedAgentIds,
    };
  }

  const workspaceId =
    input.workspaceId ?? (await resolveWorkspaceIdAtPath(dependencies, targetPath));

  if (!workspaceId) {
    dependencies.sessionLogger?.warn(
      { targetPath },
      "Could not resolve workspace for archive; skipping",
    );
    return {
      ok: true,
      removedAgents: [],
    };
  }

  const result = await archiveByScope(dependencies, {
    scope: { kind: "workspace", workspaceId },
    requestId: input.requestId,
  });

  return {
    ok: true,
    removedAgents: result.archivedAgentIds,
  };
}

async function resolveArchiveTarget(
  dependencies: ArchiveCommandDependencies,
  input: ArchiveCommandInput,
): Promise<string> {
  const repoRoot = input.repoRoot ?? null;
  if (input.worktreePath) {
    return input.worktreePath;
  }

  if (input.worktreeSlug) {
    if (!repoRoot) {
      throw new Error("repoRoot is required when worktreeSlug is supplied");
    }
    return resolveWorktreeSlugPath(dependencies, repoRoot, input.worktreeSlug);
  }

  if (repoRoot && input.branchName) {
    const worktrees = await dependencies.workspaceGitService.listWorktrees(repoRoot);
    const match = worktrees.find((entry) => entry.branchName === input.branchName);
    if (!match) {
      throw new Error(`Gravity worktree not found for branch ${input.branchName}`);
    }
    return match.path;
  }

  throw new Error("worktreePath, worktreeSlug, or repoRoot+branchName is required");
}

async function resolveWorktreeSlugPath(
  dependencies: ArchiveCommandDependencies,
  repoRoot: string,
  worktreeSlug: string,
): Promise<string> {
  const worktreesRoot = await getGravityWorktreesRoot(
    repoRoot,
    dependencies.gravityHome,
    dependencies.gravityWorktreesBaseRoot,
  );
  return join(worktreesRoot, worktreeSlug);
}
