import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  GravityConfigRawSchema,
  type GravityConfigRaw,
  type GravityConfigRevision,
  type ProjectConfigRpcError,
} from "@gravity/protocol/gravity-config-schema";
export {
  GravityConfigRevisionSchema,
  ProjectConfigRpcErrorSchema,
  type GravityConfigRevision,
  type ProjectConfigRpcError,
} from "@gravity/protocol/gravity-config-schema";

export const GRAVITY_CONFIG_FILE_NAME = "gravity.json";

export type ReadGravityConfigForEditResult =
  | { ok: true; config: GravityConfigRaw | null; revision: GravityConfigRevision | null }
  | { ok: false; error: ProjectConfigRpcError };

export type WriteGravityConfigForEditResult =
  | { ok: true; config: GravityConfigRaw; revision: GravityConfigRevision }
  | { ok: false; error: ProjectConfigRpcError };

export interface WriteGravityConfigForEditInput {
  repoRoot: string;
  config: GravityConfigRaw;
  expectedRevision: GravityConfigRevision | null;
}

export function resolveGravityConfigPath(repoRoot: string): string {
  return join(repoRoot, GRAVITY_CONFIG_FILE_NAME);
}

export function statGravityConfigPath(repoRoot: string): GravityConfigRevision | null {
  const configPath = resolveGravityConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  const stats = statSync(configPath);
  return {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
}

export function readGravityConfigJson(repoRoot: string): unknown {
  const configPath = resolveGravityConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  return JSON.parse(readFileSync(configPath, "utf8"));
}

export function readGravityConfigForEdit(repoRoot: string): ReadGravityConfigForEditResult {
  try {
    const json = readGravityConfigJson(repoRoot);
    if (json === null) {
      return { ok: true, config: null, revision: null };
    }
    return {
      ok: true,
      config: GravityConfigRawSchema.parse(json),
      revision: statGravityConfigPath(repoRoot),
    };
  } catch {
    return {
      ok: false,
      error: { code: "invalid_project_config" },
    };
  }
}

export function writeGravityConfigForEdit(
  input: WriteGravityConfigForEditInput,
): WriteGravityConfigForEditResult {
  const parsed = GravityConfigRawSchema.safeParse(input.config);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_project_config" } };
  }

  const configPath = resolveGravityConfigPath(input.repoRoot);
  const tempPath = join(
    input.repoRoot,
    `.${GRAVITY_CONFIG_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    writeFileSync(tempPath, `${JSON.stringify(parsed.data, null, 2)}\n`);
    const currentRevision = statGravityConfigPath(input.repoRoot);
    if (!gravityConfigRevisionsEqual(currentRevision, input.expectedRevision)) {
      removeTempGravityConfig(tempPath);
      return {
        ok: false,
        error: { code: "stale_project_config", currentRevision },
      };
    }

    renameSync(tempPath, configPath);
    const revision = statGravityConfigPath(input.repoRoot);
    if (!revision) {
      return { ok: false, error: { code: "write_failed" } };
    }
    return { ok: true, config: parsed.data, revision };
  } catch {
    removeTempGravityConfig(tempPath);
    return { ok: false, error: { code: "write_failed" } };
  }
}

function gravityConfigRevisionsEqual(
  left: GravityConfigRevision | null,
  right: GravityConfigRevision | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.mtimeMs === right.mtimeMs && left.size === right.size;
}

function removeTempGravityConfig(tempPath: string): void {
  try {
    rmSync(tempPath, { force: true });
  } catch {
    // Best-effort cleanup only; callers need the original write outcome.
  }
}
