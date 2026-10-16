import { constants, promises as fs } from "node:fs";
import path from "node:path";

interface MacCliInstallOptions {
  homeDir: string;
  shimPath: string;
  shell: string;
  env: NodeJS.ProcessEnv;
}

async function readOptionalFile(filename: string): Promise<string> {
  try {
    return await fs.readFile(filename, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
}

async function shellConfig(
  options: MacCliInstallOptions,
): Promise<{ filename: string; line: string }> {
  const { homeDir, env } = options;
  switch (path.basename(options.shell)) {
    case "zsh":
      return {
        filename: path.join(env.ZDOTDIR || homeDir, ".zshrc"),
        line: 'export PATH="$HOME/.local/bin:$PATH"',
      };
    case "bash": {
      // Creating .bash_profile would hide an existing .bash_login or .profile.
      for (const name of [".bash_profile", ".bash_login", ".profile"]) {
        const filename = path.join(homeDir, name);
        try {
          await fs.access(filename);
          return { filename, line: 'export PATH="$HOME/.local/bin:$PATH"' };
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        }
      }
      return {
        filename: path.join(homeDir, ".bash_profile"),
        line: 'export PATH="$HOME/.local/bin:$PATH"',
      };
    }
    case "fish":
      return {
        filename: path.join(
          env.XDG_CONFIG_HOME || path.join(homeDir, ".config"),
          "fish",
          "config.fish",
        ),
        line: "fish_add_path $HOME/.local/bin",
      };
    default:
      throw new Error(`Automatic gravity setup does not support ${options.shell}.`);
  }
}

export async function installMacCli(options: MacCliInstallOptions): Promise<void> {
  await fs.access(options.shimPath, constants.X_OK);
  const binDir = path.join(options.homeDir, ".local", "bin");
  const target = path.join(binDir, "gravity");
  let installedSource: string | null = null;
  try {
    const stat = await fs.lstat(target);
    if (!stat.isSymbolicLink())
      throw new Error(`Cannot install gravity: ${target} already exists.`);
    installedSource = await fs.readlink(target);
    const isBundledLauncher = installedSource.endsWith(".app/Contents/Resources/bin/gravity");
    if (!isBundledLauncher) throw new Error(`Cannot replace an unrelated command at ${target}.`);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }

  const config = await shellConfig(options);
  const contents = await readOptionalFile(config.filename);
  const hasExport = contents.split("\n").some((line) => line.trim() === config.line);
  if (!hasExport) {
    await fs.mkdir(path.dirname(config.filename), { recursive: true });
    await fs.appendFile(config.filename, `\n# Added by Gravity\n${config.line}\n`);
  }

  if (installedSource === options.shimPath) return;
  await fs.mkdir(binDir, { recursive: true });
  if (installedSource === null) {
    await fs.symlink(options.shimPath, target);
    return;
  }
  // Replace our old link atomically when the app moves; never leave a missing command.
  const stagingDir = await fs.mkdtemp(path.join(binDir, ".gravity-"));
  try {
    const stagedLink = path.join(stagingDir, "gravity");
    await fs.symlink(options.shimPath, stagedLink);
    await fs.rename(stagedLink, target);
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }
}
