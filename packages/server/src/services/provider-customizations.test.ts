import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createProviderCommand,
  listProviderCustomizationFiles,
} from "./provider-customizations.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), "provider-customizations-")));
  roots.push(home);
  async function file(relative: string, content: string) {
    const target = path.join(home, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
    return target;
  }
  return { home, file };
}

describe("provider customization discovery", () => {
  it.each(["codex", "claude"] as const)(
    "creates %s commands without overwriting existing files",
    async (provider) => {
      const { home } = await fixture();
      const options = {
        provider,
        home,
        configDir: path.join(home, "custom"),
        name: "review",
        content: "Review the diff\n",
      };
      expect(await createProviderCommand(options)).toEqual({ status: "created" });
      const file = path.join(
        options.configDir,
        provider === "codex" ? "prompts" : "commands",
        "review.md",
      );
      expect(await readFile(file, "utf8")).toBe(options.content);
      expect(await createProviderCommand({ ...options, content: "Replacement" })).toEqual({
        status: "exists",
      });
      expect(await readFile(file, "utf8")).toBe(options.content);
      await expect(createProviderCommand({ ...options, name: "../escape" })).rejects.toThrow(
        "Invalid command name",
      );
      await expect(
        createProviderCommand({ ...options, name: "blank", content: "  " }),
      ).rejects.toThrow("Prompt is required");
    },
  );

  it("creates project commands for Claude and rejects unsupported Codex project prompts", async () => {
    const { home } = await fixture();
    const cwd = path.join(home, "project");
    await mkdir(cwd);
    const options = { cwd, name: "review", content: "Review the diff" };
    expect(await createProviderCommand({ ...options, provider: "claude" })).toEqual({
      status: "created",
    });
    expect(await readFile(path.join(cwd, ".claude/commands/review.md"), "utf8")).toBe(
      options.content,
    );
    await expect(createProviderCommand({ ...options, provider: "codex" })).rejects.toThrow(
      "Codex commands are saved in the personal prompts directory",
    );
  });

  it("lists Codex prompts, shared skills, project skills, and read-only plugin/system skills", async () => {
    const { home, file } = await fixture();
    await file(
      ".codex/prompts/review.md",
      "---\ndescription: Review changes\n---\nReview $ARGUMENTS",
    );
    await file(
      ".agents/skills/shared/SKILL.md",
      "---\nname: shared\ndescription: >\n  A shared\n  skill\n---\nInstructions",
    );
    await file("repo/.git/HEAD", "ref: refs/heads/main");
    await file(
      "repo/.agents/skills/local/SKILL.md",
      "---\nname: local\ndescription: 'Local skill'\n---\nInstructions",
    );
    await file(".codex/skills/.system/builder/SKILL.md", "---\nname: builder\n---\nInstructions");
    await file(
      ".codex/plugins/cache/vendor/plugin/1/skills/plugin-skill/SKILL.md",
      "---\nname: plugin-skill\n---\nInstructions",
    );
    const result = await listProviderCustomizationFiles({
      provider: "codex",
      home,
      configDir: path.join(home, ".codex"),
      cwd: path.join(home, "repo"),
    });
    expect(result.warnings).toEqual([]);
    expect(
      result.entries.map(({ name, kind, source, editable, description }) => ({
        name,
        kind,
        source,
        editable,
        description,
      })),
    ).toEqual([
      { name: "builder", kind: "skill", source: "personal", editable: false, description: "" },
      {
        name: "local",
        kind: "skill",
        source: "project",
        editable: true,
        description: "Local skill",
      },
      { name: "plugin-skill", kind: "skill", source: "plugin", editable: false, description: "" },
      {
        name: "prompts:review",
        kind: "command",
        source: "personal",
        editable: true,
        description: "Review changes",
      },
      {
        name: "shared",
        kind: "skill",
        source: "personal",
        editable: true,
        description: "A shared skill",
      },
    ]);
  });

  it("keeps same-named personal and project commands distinct and respects a custom Claude directory", async () => {
    const { home, file } = await fixture();
    const personal = await file(
      "custom/commands/team/review.md",
      "---\ndescription: Personal review\n---\nReview",
    );
    const project = await file(
      "repo/.claude/commands/team/review.md",
      "---\ndescription: Project review\n---\nReview",
    );
    await file("repo/.git/HEAD", "ref: refs/heads/main");
    await file(".claude/commands/ignored.md", "Ignored");
    const result = await listProviderCustomizationFiles({
      provider: "claude",
      home,
      configDir: path.join(home, "custom"),
      cwd: path.join(home, "repo"),
    });
    expect(
      result.entries.map((entry) => ({ name: entry.name, source: entry.source, file: entry.file })),
    ).toEqual([
      {
        name: "team:review",
        source: "personal",
        file: { cwd: path.dirname(personal), path: "review.md" },
      },
      {
        name: "team:review",
        source: "project",
        file: { cwd: path.dirname(project), path: "review.md" },
      },
    ]);
  });

  it("deduplicates linked skills and terminates on symlink cycles", async () => {
    const { home, file } = await fixture();
    await file(".agents/skills/shared/SKILL.md", "---\nname: shared\n---\nInstructions");
    await mkdir(path.join(home, ".codex/skills"), { recursive: true });
    await symlink(
      path.join(home, ".agents/skills/shared"),
      path.join(home, ".codex/skills/shared"),
      "junction",
    );
    await symlink(
      path.join(home, ".codex/skills"),
      path.join(home, ".codex/skills/loop"),
      "junction",
    );
    const result = await listProviderCustomizationFiles({
      provider: "codex",
      home,
      configDir: path.join(home, ".codex"),
    });
    expect(result.warnings).toEqual([]);
    expect(result.entries.map((entry) => entry.name)).toEqual(["shared"]);
  });

  it("keeps linked plugin skills read-only through a symlinked provider home", async () => {
    const { home, file } = await fixture();
    await file(
      "config/plugins/cache/vendor/plugin/1/skills/review/SKILL.md",
      "---\nname: review\n---\nReview",
    );
    await mkdir(path.join(home, "config/skills"));
    await symlink(
      path.join(home, "config/plugins/cache/vendor/plugin/1/skills/review"),
      path.join(home, "config/skills/review"),
      "junction",
    );
    await symlink(path.join(home, "config"), path.join(home, ".codex"), "junction");
    const result = await listProviderCustomizationFiles({
      provider: "codex",
      home,
      configDir: path.join(home, ".codex"),
    });
    expect(
      result.entries.map(({ name, source, editable }) => ({ name, source, editable })),
    ).toEqual([{ name: "review", source: "plugin", editable: false }]);
  });
});
