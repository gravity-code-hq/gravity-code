import { describe, expect, it } from "vitest";
import type { FileWriteResult } from "@gravity/protocol/messages";
import { openCustomizationEditor } from "./editor-model";
import { buildCustomizationPrompt } from "./prompt";
import { openCreateCommandForm } from "./create-command-model";

describe("customization editing", () => {
  it("retains a new command after a failed creation and retries with the same prompt", async () => {
    const attempts: Array<{ name: string; content: string }> = [];
    const form = openCreateCommandForm(async (input) => {
      attempts.push(input);
      if (attempts.length === 1) throw new Error("Disconnected");
      return { status: "created" };
    });
    form.setName("../invalid");
    form.setContent("Review the changes");
    expect(form.getState().canSave).toBe(false);
    expect(await form.save()).toBe(false);
    expect(attempts).toEqual([]);
    form.setName(" review ");
    expect(await form.save()).toBe(false);
    expect(form.getState()).toMatchObject({
      name: " review ",
      content: "Review the changes",
      canSave: true,
      save: { status: "error", error: "Disconnected" },
    });
    expect(await form.save()).toBe(true);
    expect(attempts).toEqual([
      { name: "review", content: "Review the changes" },
      { name: "review", content: "Review the changes" },
    ]);
    form.close();
  });

  it("saves with the read revision and uses the returned revision for the next edit", async () => {
    const writes: unknown[] = [];
    const editor = openCustomizationEditor(
      { content: "before", modifiedAt: "old", revision: "r1" },
      async (input) => {
        writes.push(input);
        return { status: "written", modifiedAt: "new", revision: "r2", size: input.content.length };
      },
    );
    editor.setContent("after");
    await editor.save();
    expect(editor.getState()).toEqual({
      content: "after",
      dirty: false,
      save: { status: "saved" },
    });
    editor.setContent("again");
    await editor.save();
    expect(writes).toEqual([
      { content: "after", expectedModifiedAt: "old", expectedRevision: "r1" },
      { content: "again", expectedModifiedAt: "new", expectedRevision: "r2" },
    ]);
  });

  it("retains edits after a failed save and allows retry", async () => {
    let fail = true;
    const editor = openCustomizationEditor({ content: "before", modifiedAt: "old" }, async () => {
      if (fail) throw new Error("Disconnected");
      return { status: "written", modifiedAt: "new", size: 5 };
    });
    editor.setContent("after");
    await editor.save();
    expect(editor.getState()).toEqual({
      content: "after",
      dirty: true,
      save: { status: "error", error: "Disconnected" },
    });
    fail = false;
    await editor.save();
    expect(editor.getState().save).toEqual({ status: "saved" });
  });

  it("retains errors returned by the host and prevents duplicate saves", async () => {
    let finish: (result: FileWriteResult) => void = () => {};
    let writes = 0;
    const editor = openCustomizationEditor(
      { content: "before", modifiedAt: "old", revision: "r1" },
      () => {
        writes++;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    );
    editor.setContent("after");
    const saving = editor.save();
    await editor.save();
    expect(writes).toBe(1);
    finish({ status: "error", error: "Permission denied" });
    await saving;
    expect(editor.getState()).toEqual({
      content: "after",
      dirty: true,
      save: { status: "error", error: "Permission denied" },
    });
  });

  it("keeps unsaved text when the host detects an external edit", async () => {
    const editor = openCustomizationEditor(
      { content: "before", modifiedAt: "old", revision: "r1" },
      async () => ({
        status: "conflict",
        version: {
          status: "ready",
          cwd: "/skills/review",
          path: "SKILL.md",
          size: 8,
          modifiedAt: "new",
          revision: "r2",
        },
      }),
    );
    editor.setContent("my edits");
    await editor.save();
    expect(editor.getState()).toEqual({
      content: "my edits",
      dirty: true,
      save: { status: "conflict" },
    });
  });

  it("includes the exact skill file and preserves plugin ownership in the chat prompt", () => {
    const prompt = buildCustomizationPrompt({
      id: "skill",
      name: "review",
      description: "Review",
      kind: "skill",
      source: "plugin",
      editable: false,
      file: { cwd: "/plugins/review", path: "SKILL.md" },
    });
    expect(prompt).toContain("Location: /plugins/review/SKILL.md");
    expect(prompt).toContain("Ask me what I want to improve before making changes.");
    expect(prompt).toContain("Do not modify its installed files.");
  });
});
