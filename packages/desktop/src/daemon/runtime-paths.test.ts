import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveDaemonRunnerEntrypoint, resolveNodeExecPath } from "./runtime-paths";
import { resolveExternalCliEntrypoint, resolvePassthroughCliEntrypoint } from "./cli/entrypoints";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  app: {
    isPackaged: true,
  },
}));

vi.mock("node:fs", () => ({
  existsSync: mocks.existsSync,
  readFileSync: vi.fn(),
}));

vi.mock("electron", () => ({
  app: mocks.app,
}));

vi.mock("electron-log/main", () => ({
  default: { warn: vi.fn() },
}));

vi.mock("@gravity/server", () => ({
  spawnProcess: vi.fn(),
}));

const originalPlatform = process.platform;
const originalExecPath = process.execPath;
const originalResourcesPath = process.resourcesPath;

function setProcessRuntime(input: {
  platform: NodeJS.Platform;
  execPath: string;
  resourcesPath?: string;
}): void {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: input.platform,
  });
  Object.defineProperty(process, "execPath", {
    configurable: true,
    value: input.execPath,
  });
  Object.defineProperty(process, "resourcesPath", {
    configurable: true,
    value: input.resourcesPath,
  });
}

describe("runtime-paths", () => {
  beforeEach(() => {
    mocks.app.isPackaged = true;
    mocks.existsSync.mockReturnValue(true);
    setProcessRuntime({
      platform: "darwin",
      execPath: "/Applications/Gravity.app/Contents/MacOS/Gravity",
      resourcesPath: "/Applications/Gravity.app/Contents/Resources",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setProcessRuntime({
      platform: originalPlatform,
      execPath: originalExecPath,
      resourcesPath: originalResourcesPath,
    });
  });

  it("uses the macOS Helper executable for packaged daemon node launches", () => {
    expect(resolveNodeExecPath()).toBe(
      "/Applications/Gravity.app/Contents/Frameworks/Gravity Helper.app/Contents/MacOS/Gravity Helper",
    );
  });

  it("resolves the daemon runner from the bundled server package", () => {
    const entryPath =
      "/Applications/Gravity.app/Contents/Resources/app.asar/node_modules/@gravity/server/dist/scripts/supervisor-entrypoint.js";
    mocks.existsSync.mockImplementation((filePath) => filePath === entryPath);

    expect(resolveDaemonRunnerEntrypoint()).toEqual({ entryPath, execArgv: [] });
  });

  it("resolves the external CLI from the bundled CLI package", () => {
    const entryPath =
      "/Applications/Gravity.app/Contents/Resources/app.asar/node_modules/@gravity/cli/dist/index.js";
    mocks.existsSync.mockImplementation((filePath) => filePath === entryPath);

    expect(resolveExternalCliEntrypoint()).toEqual({ entryPath, execArgv: [] });
  });

  it("resolves the passthrough CLI from the bundled CLI package", () => {
    const entryPath =
      "/Applications/Gravity.app/Contents/Resources/app.asar/node_modules/@gravity/cli/dist/run.js";
    mocks.existsSync.mockImplementation((filePath) => filePath === entryPath);

    expect(resolvePassthroughCliEntrypoint()).toBe(entryPath);
  });
});
