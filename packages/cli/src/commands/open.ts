import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnProcess } from "@gravity/server";
import { buildAgentDeepLink, type AgentDeepLinkTarget } from "@gravity/protocol/agent-deep-link";

export function findMacDesktopApp(input: { homeDir: string; bundledApp?: string }): string | null {
  if (input.bundledApp) return existsSync(input.bundledApp) ? input.bundledApp : null;
  const candidates = [
    "/Applications/Gravity.app",
    path.join(input.homeDir, "Applications", "Gravity.app"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function findDesktopApp(): string | null {
  if (process.platform === "darwin") {
    return findMacDesktopApp({ homeDir: homedir(), bundledApp: process.env.GRAVITY_DESKTOP_APP });
  }

  if (process.platform === "linux") {
    const candidates = [
      "/usr/bin/Gravity",
      "/opt/Gravity/Gravity",
      path.join(homedir(), "Applications", "Gravity.AppImage"),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) {
      return null;
    }

    const candidate = path.join(localAppData, "Programs", "Gravity", "Gravity.exe");
    return existsSync(candidate) ? candidate : null;
  }

  return null;
}

function cleanEnvForDesktopLaunch(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // The CLI runs via ELECTRON_RUN_AS_NODE=1. On Linux/Windows the spawned
  // desktop process inherits the env directly, so we must strip it or the
  // desktop app would start as a bare Node process instead of Electron.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  delete env.GRAVITY_NODE_ENV;
  delete env.GRAVITY_DESKTOP_APP;
  return env;
}

function spawnDetached(command: string, args: string[]): void {
  spawnProcess(command, args, {
    detached: true,
    stdio: "ignore",
    env: cleanEnvForDesktopLaunch(),
  }).unref();
}

function launchDesktop(args: string[]): void {
  if (process.env.GRAVITY_DESKTOP_CLI === "1") {
    throw new Error("Cannot open Gravity Desktop while running in desktop CLI passthrough mode.");
  }

  const desktopApp = findDesktopApp();
  if (!desktopApp) {
    throw new Error(
      "Gravity desktop app not found. Install it from https://github.com/gravity-code-hq/gravity-code/releases",
    );
  }

  if (process.platform === "darwin") {
    // -n forces a new instance even if the app is already running. The new
    // instance relays its argv to the existing one through Electron's
    // single-instance lock.
    spawnDetached("open", ["-n", "-a", desktopApp, "--args", ...args]);
    return;
  }

  spawnDetached(desktopApp, args);
}

export async function openDesktopWithProject(projectPath: string): Promise<void> {
  try {
    launchDesktop([projectPath]);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) throw error;
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

export async function openDesktopWithAgent(target: AgentDeepLinkTarget): Promise<void> {
  launchDesktop([buildAgentDeepLink(target)]);
}
