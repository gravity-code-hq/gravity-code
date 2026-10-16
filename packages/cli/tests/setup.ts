/**
 * Test setup utilities for Gravity CLI E2E tests
 *
 * Critical rules from design doc:
 * 1. Port: Random port via 10000 + Math.floor(Math.random() * 50000) - NEVER 6767
 * 2. Protocol: WebSocket ONLY - daemon has no HTTP endpoints
 * 3. Temp dirs: Create temp directories for GRAVITY_HOME and agent --cwd
 * 4. Model: Always --provider claude with haiku model for agent tests
 * 5. Cleanup: Kill daemon and remove temp dirs after each test
 */

import { $, ProcessPromise, sleep } from "zx";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const TEST_ENV_DEFAULTS = {
  GRAVITY_LOCAL_SPEECH_AUTO_DOWNLOAD: process.env.GRAVITY_LOCAL_SPEECH_AUTO_DOWNLOAD ?? "0",
  GRAVITY_DICTATION_ENABLED: process.env.GRAVITY_DICTATION_ENABLED ?? "0",
  GRAVITY_VOICE_MODE_ENABLED: process.env.GRAVITY_VOICE_MODE_ENABLED ?? "0",
};

function testEnvironment(gravityHome: string): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GRAVITY_")),
    ),
    ...TEST_ENV_DEFAULTS,
    GRAVITY_HOME: gravityHome,
    HOME: gravityHome,
    USERPROFILE: gravityHome,
  };
}

function killPidTree(pid: number, signal: NodeJS.Signals): void {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ESRCH") {
        return;
      }
    }
  }

  try {
    process.kill(pid, signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH") {
      throw error;
    }
  }
}

export interface TestContext {
  /** Random port for test daemon (never 6767) */
  port: number;
  /** Temp directory for GRAVITY_HOME */
  gravityHome: string;
  /** Temp directory for agent working directory */
  workDir: string;
  /** Running daemon process */
  daemon: ProcessPromise | null;
  /** Run a gravity CLI command against the test daemon */
  gravity: (args: string[]) => ProcessPromise;
  /** Clean up all resources */
  cleanup: () => Promise<void>;
}

/**
 * Generate a random port for test daemon
 * NEVER uses 6767 (user's running daemon)
 */
export function getRandomPort(): number {
  return 10000 + Math.floor(Math.random() * 50000);
}

/**
 * Create isolated temp directories for testing
 */
export async function createTempDirs(): Promise<{ gravityHome: string; workDir: string }> {
  const gravityHome = await mkdtemp(join(tmpdir(), "gravity-test-home-"));
  const workDir = await mkdtemp(join(tmpdir(), "gravity-test-work-"));
  return { gravityHome, workDir };
}

/**
 * Wait for daemon to be ready by testing WebSocket connection
 * Uses `gravity agent ls` which connects via WebSocket
 */
async function probeDaemon(port: number, gravityHome: string): Promise<boolean> {
  try {
    const result = await $({
      env: testEnvironment(gravityHome),
    })`gravity agent ls --host localhost:${port}`.nothrow();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function waitForDaemon(
  port: number,
  gravityHome: string,
  timeout = 30000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  async function poll(): Promise<void> {
    if (await probeDaemon(port, gravityHome)) return;
    if (Date.now() >= deadline) {
      throw new Error(`Daemon failed to start on port ${port} within ${timeout}ms`);
    }
    await sleep(100);
    return poll();
  }
  return poll();
}

/**
 * Start an isolated test daemon
 */
export async function startDaemon(port: number, gravityHome: string): Promise<ProcessPromise> {
  $.verbose = false;
  const daemon = $({
    env: {
      ...testEnvironment(gravityHome),
      GRAVITY_LISTEN: `127.0.0.1:${port}`,
      GRAVITY_RELAY_ENABLED: "false",
      CI: "true",
    },
  })`gravity daemon run`.nothrow();
  return daemon;
}

/**
 * Create a full test context with daemon, temp dirs, and helpers
 */
export async function createTestContext(): Promise<TestContext> {
  const port = getRandomPort();
  const { gravityHome, workDir } = await createTempDirs();

  // Helper to run CLI commands against test daemon
  const gravity = (args: string[]): ProcessPromise => {
    $.verbose = false;
    return $({
      env: testEnvironment(gravityHome),
    })`gravity --home ${gravityHome} ${args}`.nothrow();
  };

  // Cleanup function
  const cleanup = async (): Promise<void> => {
    if (ctx.daemon) {
      if (typeof ctx.daemon.pid === "number") {
        killPidTree(ctx.daemon.pid, "SIGTERM");
        await sleep(250);
        killPidTree(ctx.daemon.pid, "SIGKILL");
      } else {
        ctx.daemon.kill();
      }
    }
    await rm(gravityHome, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  };

  const ctx: TestContext = {
    port,
    gravityHome,
    workDir,
    daemon: null,
    gravity,
    cleanup,
  };

  return ctx;
}

/**
 * Create a test context and start the daemon
 * Use this for tests that need a running daemon
 */
export async function createTestContextWithDaemon(): Promise<TestContext> {
  const ctx = await createTestContext();
  ctx.daemon = await startDaemon(ctx.port, ctx.gravityHome);
  await waitForDaemon(ctx.port, ctx.gravityHome);
  return ctx;
}

/**
 * Register cleanup handlers for process exit
 */
export function registerCleanupHandlers(cleanup: () => Promise<void>): void {
  const handler = async () => {
    await cleanup();
    process.exit(0);
  };

  process.on("exit", () => {
    // Can't await in exit handler, but at least try to kill daemon
  });
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
}
