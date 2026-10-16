import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createCliParseArgv } from "./run";
import { findMacDesktopApp } from "./commands/open";

describe("runCli", () => {
  it("opens the exact bundled Gravity app and resolves the terminal's current folder", () => {
    const root = mkdtempSync(path.join(tmpdir(), "gravity-launch-"));
    const bundledApp = path.join(root, "Custom Apps", "Gravity.app");
    const project = path.join(root, "my project");
    mkdirSync(bundledApp, { recursive: true });
    mkdirSync(project);
    try {
      expect(findMacDesktopApp({ homeDir: root, bundledApp })).toBe(bundledApp);
      expect(
        createCliParseArgv({ argv: ["."], cwd: project, nodeArgv: ["node", "gravity"] }),
      ).toEqual({
        kind: "open-project",
        resolvedPath: project,
      });
      expect(
        findMacDesktopApp({ homeDir: root, bundledApp: path.join(root, "missing.app") }),
      ).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("defaults an empty CLI invocation to onboard", () => {
    expect(
      createCliParseArgv({
        argv: [],
        cwd: process.cwd(),
        nodeArgv: ["node", "gravity"],
      }),
    ).toEqual(["node", "gravity", "onboard"]);
  });

  it("routes explicit root relay flags to onboard", () => {
    expect(
      createCliParseArgv({
        argv: ["--relay"],
        cwd: process.cwd(),
        nodeArgv: ["node", "gravity"],
      }),
    ).toEqual(["node", "gravity", "onboard", "--relay"]);
    expect(
      createCliParseArgv({
        argv: ["--no-relay"],
        cwd: process.cwd(),
        nodeArgv: ["node", "gravity"],
      }),
    ).toEqual(["node", "gravity", "onboard", "--no-relay"]);
  });

  it("preserves known CLI command argv", () => {
    expect(
      createCliParseArgv({
        argv: ["daemon", "set-password"],
        cwd: process.cwd(),
        nodeArgv: ["node", "gravity"],
      }),
    ).toEqual(["node", "gravity", "daemon", "set-password"]);
  });

  it("preserves the hooks command argv", () => {
    expect(
      createCliParseArgv({
        argv: ["hooks", "claude", "UserPromptSubmit"],
        cwd: process.cwd(),
        nodeArgv: ["node", "gravity"],
      }),
    ).toEqual(["node", "gravity", "hooks", "claude", "UserPromptSubmit"]);
  });

  it("classifies existing unknown directories as open-project invocations", () => {
    const root = mkdtempSync(path.join(tmpdir(), "gravity-cli-run-"));
    const project = path.join(root, "repository");
    mkdirSync(project);

    try {
      expect(
        createCliParseArgv({
          argv: ["repository"],
          cwd: root,
          nodeArgv: ["node", "gravity"],
        }),
      ).toEqual({
        kind: "open-project",
        resolvedPath: project,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
