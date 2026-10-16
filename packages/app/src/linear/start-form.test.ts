import { describe, expect, it } from "vitest";
import { openLinearStartForm } from "./start-form";

describe("Linear start form", () => {
  it("requires a repo and explicit submission, starts in the checkout without a workspace, and clears the workspace when the repo changes", async () => {
    const form = openLinearStartForm("Full issue prompt");
    const submissions: string[] = [];
    await form.submit(async (draft) => {
      submissions.push(draft.prompt);
    });
    expect(submissions).toEqual([]);
    form.setProject("repo-a", { label: "Repo A" });
    expect(form.getState().workspaceKind).toBe("existing");
    expect(form.getState().canSubmit).toBe(true);
    form.setWorkspace("workspace-a", { label: "Main" });
    form.setPrompt("Edited full prompt");
    expect(submissions).toEqual([]);
    await form.submit(async (draft) => {
      submissions.push(draft.prompt);
    });
    expect(submissions).toEqual(["Edited full prompt"]);
    form.setProject("repo-b", { label: "Repo B" });
    expect(form.getState().workspace).toBeNull();
    expect(form.getState().canSubmit).toBe(true);
    form.setPrompt("  ");
    expect(form.getState().canSubmit).toBe(false);
  });

  it("keeps failures visible, prevents duplicate submits, and opens fresh", async () => {
    const form = openLinearStartForm("Task");
    form.setProject("repo-a", { label: "Repo A" });
    form.setWorkspaceKind("new");
    let attempts = 0;
    const start = async () => {
      attempts++;
      throw new Error("Host disconnected");
    };
    const submission = form.submit(start);
    await form.submit(start);
    await submission;
    expect(attempts).toBe(1);
    expect(form.getState().error).toBe("Host disconnected");
    expect(form.getState().canSubmit).toBe(true);
    form.close();
    expect(openLinearStartForm("Next task").getState()).toMatchObject({
      prompt: "Next task",
      project: null,
      workspaceKind: "existing",
      workspace: null,
      error: null,
    });
  });
});
