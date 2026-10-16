import { GRAVITY_GITHUB_REPO } from "@gravity/protocol/gravity-repo";
import { findExecutable } from "../executable-resolution/executable-resolution.js";
import { execCommand } from "../utils/spawn.js";

// Nothing waits on these calls except an optional star prompt, which falls back
// to opening GitHub in a browser, so a bounded answer beats the 30s gh default.
const STAR_GH_TIMEOUT_MS = 15_000;

// The star is always for github.com, even when the user's shell exports GH_HOST
// for a GitHub Enterprise instance.
const STAR_GH_ENV = {
  GH_HOST: "github.com",
  GH_PROMPT_DISABLED: "1",
  GIT_TERMINAL_PROMPT: "0",
} as const;

export type GravityRepoStarRunner = (args: string[]) => Promise<{ stdout: string; stderr: string }>;

export interface GravityRepoStarService {
  readonly repo: string;
  /** true if starred, false if not, null when gh cannot tell (missing, signed out, offline). */
  getStarred(): Promise<boolean | null>;
  star(): Promise<boolean>;
}

async function runGh(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const ghPath = await findExecutable("gh");
  if (!ghPath) {
    throw new Error("GitHub CLI (gh) is not installed or not in PATH");
  }
  return execCommand(ghPath, args, { envOverlay: STAR_GH_ENV, timeout: STAR_GH_TIMEOUT_MS });
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const { message, stderr } = error as { message?: unknown; stderr?: unknown };
  return [message, stderr].some((text) => typeof text === "string" && text.includes("HTTP 404"));
}

export function createGravityRepoStarService(
  options: { runner?: GravityRepoStarRunner; repo?: string } = {},
): GravityRepoStarService {
  const runner = options.runner ?? runGh;
  const repo = options.repo ?? GRAVITY_GITHUB_REPO;
  // Every connected client can ask at once; share one gh child between them.
  let inFlightCheck: Promise<boolean | null> | null = null;

  async function runCheck(): Promise<boolean | null> {
    try {
      const { stdout, stderr } = await runner(["api", "--include", `user/starred/${repo}`]);
      return /HTTP\/\S+\s+(?:200|204)\b/.test(`${stdout}\n${stderr}`) ? true : null;
    } catch (error) {
      // 404 is GitHub's only "not starred" answer; anything else is unknown.
      return isNotFoundError(error) ? false : null;
    }
  }

  return {
    repo,
    getStarred() {
      inFlightCheck ??= runCheck().finally(() => {
        inFlightCheck = null;
      });
      return inFlightCheck;
    },
    async star() {
      try {
        await runner(["api", "-X", "PUT", `user/starred/${repo}`]);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Daemon-wide instance so concurrent sessions share the in-flight check. */
const sharedGravityRepoStarService = createGravityRepoStarService();

export function resolveGravityRepoStarService(
  service: GravityRepoStarService | undefined,
): GravityRepoStarService {
  return service ?? sharedGravityRepoStarService;
}
