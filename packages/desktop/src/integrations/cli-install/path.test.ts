import { describe, expect, it } from "vitest";
import { resolveCliInstallSourcePath, shouldAutoInstallMacCli } from "./path";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readlink,
  rm,
  chmod,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { installMacCli } from "./macos";

it.each([
  ["darwin", true, "/Applications/Gravity.app/Contents/MacOS/Gravity", true],
  ["darwin", false, "/Applications/Gravity.app/Contents/MacOS/Gravity", false],
  ["darwin", true, "/Volumes/Gravity/Gravity.app/Contents/MacOS/Gravity", false],
  [
    "darwin",
    true,
    "/private/var/folders/x/AppTranslocation/id/d/Gravity.app/Contents/MacOS/Gravity",
    false,
  ],
  ["linux", true, "/opt/Gravity/Gravity", false],
] as const)(
  "auto-install eligibility: %s packaged=%s %s",
  (platform, isPackaged, executablePath, expected) => {
    expect(shouldAutoInstallMacCli({ platform, isPackaged, executablePath })).toBe(expected);
  },
);

it("repairs a moved app's link and honors ZDOTDIR", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "gravity-move-"));
  const shimPath = path.join(
    homeDir,
    "Custom Apps",
    "Gravity.app",
    "Contents",
    "Resources",
    "bin",
    "gravity",
  );
  const target = path.join(homeDir, ".local", "bin", "gravity");
  const zdotdir = path.join(homeDir, "shell");
  try {
    await mkdir(path.dirname(shimPath), { recursive: true });
    await writeFile(shimPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await mkdir(path.dirname(target), { recursive: true });
    await symlink("/old/Gravity.app/Contents/Resources/bin/gravity", target);
    await installMacCli({ homeDir, shimPath, shell: "/bin/zsh", env: { ZDOTDIR: zdotdir } });
    expect(await readlink(target)).toBe(shimPath);
    expect(await readFile(path.join(zdotdir, ".zshrc"), "utf8")).toContain(
      'export PATH="$HOME/.local/bin:$PATH"',
    );
    await expect(readFile(path.join(homeDir, ".zshrc"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

it("preserves an existing unrelated command and shell configuration", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "gravity-conflict-"));
  const shimPath = path.join(homeDir, "shim");
  const target = path.join(homeDir, ".local", "bin", "gravity");
  const rc = path.join(homeDir, ".zshrc");
  try {
    await writeFile(shimPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "user command");
    await writeFile(rc, "# user configuration\n");
    const options = { homeDir, shimPath, shell: "/bin/zsh", env: {} };
    await expect(installMacCli(options)).rejects.toThrow("already exists");
    expect(await readFile(target, "utf8")).toBe("user command");
    await rm(target);
    await symlink("/another/command", target);
    await expect(installMacCli(options)).rejects.toThrow("unrelated command");
    expect(await readlink(target)).toBe("/another/command");
    expect(await readFile(rc, "utf8")).toBe("# user configuration\n");
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

it.each([
  ["/bin/bash", ".profile", 'export PATH="$HOME/.local/bin:$PATH"'],
  ["/opt/homebrew/bin/fish", ".config/fish/config.fish", "fish_add_path $HOME/.local/bin"],
])("configures %s without replacing existing shell settings", async (shell, rcPath, line) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "gravity-shell-"));
  const shimPath = path.join(homeDir, "shim");
  const rc = path.join(homeDir, rcPath);
  try {
    await writeFile(shimPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await mkdir(path.dirname(rc), { recursive: true });
    await writeFile(rc, "# user configuration\n");
    await installMacCli({ homeDir, shimPath, shell, env: {} });
    expect(await readFile(rc, "utf8")).toBe(
      `# user configuration\n\n# Added by Gravity\n${line}\n`,
    );
    await expect(readFile(path.join(homeDir, ".bash_profile"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

it("installs gravity and configures a fresh zsh once across repeated launches", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "gravity-install-"));
  const shimPath = path.join(
    homeDir,
    "Applications",
    "Gravity.app",
    "Contents",
    "Resources",
    "bin",
    "gravity",
  );
  try {
    await mkdir(path.dirname(shimPath), { recursive: true });
    await writeFile(shimPath, "#!/bin/sh\nexit 0\n");
    await chmod(shimPath, 0o755);
    await writeFile(path.join(homeDir, ".zshrc"), "# .local/bin mentioned in a comment\n");
    const options = { homeDir, shimPath, shell: "/bin/zsh", env: {} };
    await installMacCli(options);
    const firstRc = await readFile(path.join(homeDir, ".zshrc"), "utf8");
    await installMacCli(options);
    expect(await readlink(path.join(homeDir, ".local", "bin", "gravity"))).toBe(shimPath);
    expect(firstRc).toContain('export PATH="$HOME/.local/bin:$PATH"');
    expect(await readFile(path.join(homeDir, ".zshrc"), "utf8")).toBe(firstRc);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

describe("cli-install-path", () => {
  it("uses the bundled shim for packaged macOS installs", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "darwin",
        isPackaged: true,
        executablePath: "/Applications/Gravity.app/Contents/MacOS/Gravity",
        shimPath: "/Applications/Gravity.app/Contents/Resources/bin/gravity",
      }),
    ).toBe("/Applications/Gravity.app/Contents/Resources/bin/gravity");
  });

  it("prefers the original AppImage path on linux", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: true,
        executablePath: "/tmp/.mount_gravity123/gravity",
        shimPath: "/tmp/.mount_gravity123/resources/bin/gravity",
        appImagePath: "/home/user/Applications/Gravity.AppImage",
      }),
    ).toBe("/home/user/Applications/Gravity.AppImage");
  });

  it("uses the bundled shim for packaged linux installs outside an AppImage", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: true,
        executablePath: "/opt/Gravity/Gravity",
        shimPath: "/opt/Gravity/resources/bin/gravity",
      }),
    ).toBe("/opt/Gravity/resources/bin/gravity");
  });

  it("falls back to the shim on windows and in development", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "win32",
        isPackaged: true,
        executablePath: "C:\\Users\\user\\AppData\\Local\\Programs\\Gravity\\Gravity.exe",
        shimPath: "C:\\Users\\user\\AppData\\Local\\Programs\\Gravity\\resources\\bin\\gravity.cmd",
      }),
    ).toBe("C:\\Users\\user\\AppData\\Local\\Programs\\Gravity\\resources\\bin\\gravity.cmd");

    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: false,
        executablePath: "/opt/Gravity/gravity",
        shimPath: "/opt/Gravity/resources/bin/gravity",
      }),
    ).toBe("/opt/Gravity/resources/bin/gravity");
  });
});
