import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ProviderCustomization } from "@gravity/protocol/provider-customizations";
import { ProviderCommandNameSchema } from "@gravity/protocol/provider-customizations";

interface CatalogOptions {
  provider: "codex" | "claude";
  cwd?: string;
  home?: string;
  configDir?: string;
}

function providerConfigDirectory(options: CatalogOptions): string {
  const home = options.home ?? os.homedir();
  return (
    options.configDir ??
    (options.provider === "codex"
      ? process.env.CODEX_HOME || path.join(home, ".codex")
      : process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"))
  );
}

export async function createProviderCommand(
  options: CatalogOptions & { name: string; content: string },
): Promise<{ status: "created" | "exists" }> {
  if (options.provider === "codex" && options.cwd)
    throw new Error("Codex commands are saved in the personal prompts directory");
  if (!ProviderCommandNameSchema.safeParse(options.name).success)
    throw new Error("Invalid command name");
  if (!options.content.trim()) throw new Error("Prompt is required");
  if (Buffer.byteLength(options.content, "utf8") > 1024 * 1024)
    throw new Error("Prompt exceeds 1 MB");
  if (options.cwd && !(await fs.stat(options.cwd)).isDirectory())
    throw new Error("Project directory is unavailable");
  const configDir = options.cwd
    ? path.join(options.cwd, options.provider === "codex" ? ".codex" : ".claude")
    : providerConfigDirectory(options);
  const directory = path.join(configDir, options.provider === "codex" ? "prompts" : "commands");
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(path.join(directory, `${options.name}.md`), options.content, { flag: "wx" });
    return { status: "created" };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST")
      return { status: "exists" };
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function isHiddenDirectory(name: string): boolean {
  return name.startsWith(".") && name !== ".system";
}

async function resolveDirectory(directory: string): Promise<string> {
  try {
    return await fs.realpath(directory);
  } catch (error) {
    if (isMissing(error)) return path.resolve(directory);
    throw error;
  }
}

function metadata(content: string, key: string): string {
  const header = content
    .replace(/^\uFEFF/, "")
    .match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!header) return "";
  const match = header.match(
    new RegExp(`^${key}:\\s*([^\\r\\n]*)(?:\\r?\\n((?:[ \\t]+[^\\r\\n]*\\r?\\n?)*))?`, "m"),
  );
  if (!match) return "";
  const value = match[1].trim();
  if (/^[>|][-+]?\s*$/.test(value)) return (match[2] ?? "").trim().replace(/\s+/g, " ");
  return value.replace(/^(["'])([\s\S]*)\1$/, "$2");
}

export async function listProviderCustomizationFiles(options: CatalogOptions): Promise<{
  entries: ProviderCustomization[];
  warnings: string[];
}> {
  const home = options.home ?? os.homedir();
  const configuredDirectory = providerConfigDirectory(options);
  const configDir = await resolveDirectory(configuredDirectory);
  const entries: ProviderCustomization[] = [];
  const warnings: string[] = [];
  const files = new Set<string>();
  const visited = new Set<string>();
  let directories = 0;

  async function readDirectory(directory: string) {
    try {
      return await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (!isMissing(error)) warnings.push(`${directory}: ${String(error)}`);
      return [];
    }
  }

  async function addFile(
    file: string,
    kind: ProviderCustomization["kind"],
    source: ProviderCustomization["source"],
    name: string,
    editable: boolean,
  ) {
    try {
      const canonical = await fs.realpath(file);
      if (files.has(canonical)) return;
      const stat = await fs.stat(canonical);
      if (!stat.isFile()) return;
      if (stat.size > 1024 * 1024) {
        warnings.push(`${file}: file exceeds 1 MB`);
        return;
      }
      const content = await fs.readFile(canonical, "utf8");
      const pluginRelative = path.relative(path.join(configDir, "plugins", "cache"), canonical);
      const isPlugin =
        !pluginRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(pluginRelative);
      const isSystem = canonical.split(path.sep).includes(".system");
      files.add(canonical);
      entries.push({
        id: canonical,
        name: kind === "skill" ? metadata(content, "name") || name : name,
        description: metadata(content, "description"),
        kind,
        source: isPlugin ? "plugin" : source,
        editable: editable && !isPlugin && !isSystem,
        file: { cwd: path.dirname(canonical), path: path.basename(canonical) },
      });
    } catch (error) {
      if (!isMissing(error)) warnings.push(`${file}: ${String(error)}`);
    }
  }

  async function scan(
    directory: string,
    kind: ProviderCustomization["kind"],
    source: ProviderCustomization["source"],
    prefix = "",
    depth = 0,
    editable = true,
  ) {
    if (depth > 12 || directories >= 4000) {
      warnings.push(`${directory}: discovery limit reached`);
      return;
    }
    let canonical: string;
    try {
      canonical = await fs.realpath(directory);
    } catch (error) {
      if (!isMissing(error)) warnings.push(`${directory}: ${String(error)}`);
      return;
    }
    const visitKey = `${kind}:${canonical}`;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);
    directories++;
    const children = await readDirectory(directory);
    if (kind === "skill" && children.some((child) => child.name === "SKILL.md")) {
      await addFile(
        path.join(directory, "SKILL.md"),
        kind,
        source,
        path.basename(directory),
        editable,
      );
      return;
    }
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(directory, child.name);
      if (
        kind === "command" &&
        child.name.endsWith(".md") &&
        (child.isFile() || child.isSymbolicLink())
      ) {
        await addFile(target, kind, source, `${prefix}${child.name.slice(0, -3)}`, editable);
      } else if (child.isDirectory() || child.isSymbolicLink()) {
        if (isHiddenDirectory(child.name)) continue;
        await scan(
          target,
          kind,
          source,
          `${prefix}${child.name}:`,
          depth + 1,
          editable && child.name !== ".system",
        );
      }
    }
  }

  async function scanConfig(directory: string, source: "personal" | "project") {
    await scan(path.join(directory, "skills"), "skill", source);
    await scan(
      path.join(directory, options.provider === "codex" ? "prompts" : "commands"),
      "command",
      source,
      options.provider === "codex" ? "prompts:" : "",
    );
  }

  if (options.cwd) {
    let directory = path.resolve(options.cwd);
    while (directory !== home && directory !== path.dirname(directory)) {
      await scanConfig(
        path.join(directory, options.provider === "codex" ? ".codex" : ".claude"),
        "project",
      );
      if (options.provider === "codex")
        await scan(path.join(directory, ".agents", "skills"), "skill", "project");
      try {
        await fs.stat(path.join(directory, ".git"));
        break;
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      directory = path.dirname(directory);
    }
  }
  await scanConfig(configDir, "personal");
  if (options.provider === "codex")
    await scan(path.join(home, ".agents", "skills"), "skill", "personal");

  const pluginVisited = new Set<string>();
  async function scanPlugins(directory: string, depth: number) {
    if (depth > 4 || directories >= 4000) return;
    let canonical: string;
    try {
      canonical = await fs.realpath(directory);
    } catch (error) {
      if (!isMissing(error)) warnings.push(`${directory}: ${String(error)}`);
      return;
    }
    if (pluginVisited.has(canonical)) return;
    pluginVisited.add(canonical);
    directories++;
    for (const child of await readDirectory(directory)) {
      if (!child.isDirectory() && !child.isSymbolicLink()) continue;
      const target = path.join(directory, child.name);
      if (child.name === "skills" || child.name === "commands") {
        await scan(target, child.name === "skills" ? "skill" : "command", "plugin", "", 0, false);
      } else if (
        !child.name.startsWith(".") &&
        !["node_modules", "assets", "scripts"].includes(child.name)
      ) {
        await scanPlugins(target, depth + 1);
      }
    }
  }
  await scanPlugins(path.join(configDir, "plugins", "cache"), 0);
  entries.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { entries, warnings };
}
