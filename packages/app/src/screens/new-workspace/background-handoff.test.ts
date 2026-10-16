import { beforeEach, describe, expect, it } from "vitest";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import { useDraftStore } from "@/stores/draft-store";
import { useWorkspaceDraftSubmissionStore } from "@/stores/workspace-draft-submission-store";
import {
  captureWorkspaceDraftCleanup,
  createWorkspaceAgentInBackground,
} from "./background-handoff";

const DRAFT_ID = "draft_1";
const DRAFT_KEY = "new-workspace";

function saveDraft(text: string) {
  useDraftStore
    .getState()
    .saveDraftInput({ draftKey: DRAFT_KEY, draft: { text, attachments: [] } });
}

function draftText(): string | undefined {
  return useDraftStore.getState().drafts[DRAFT_KEY]?.input.text;
}

function captureCleanup() {
  return captureWorkspaceDraftCleanup({
    draftId: DRAFT_ID,
    draftKey: DRAFT_KEY,
    clearDraft: (lifecycle) =>
      useDraftStore.getState().clearDraftInput({ draftKey: DRAFT_KEY, lifecycle }),
  });
}

function run(createAgent: () => Promise<unknown>, clearConsumedDraft = captureCleanup()) {
  return createWorkspaceAgentInBackground({ createAgent, clearConsumedDraft });
}

beforeEach(() => {
  useWorkspaceDraftSubmissionStore.setState({ pendingByDraftId: {}, creationByDraftId: {} });
  useCreateFlowStore.setState({ pendingByDraftId: {} });
  saveDraft("do the thing");
});

describe("createWorkspaceAgentInBackground", () => {
  it("creates one agent and clears the consumed draft input", async () => {
    let calls = 0;

    await run(async () => {
      calls += 1;
    });

    expect(calls).toBe(1);
    expect(draftText()).toBe("");
  });

  it("leaves no pending submission behind, so no draft tab can create a second agent", async () => {
    await run(async () => undefined);

    expect(useWorkspaceDraftSubmissionStore.getState().pendingByDraftId).toEqual({});
    expect(useCreateFlowStore.getState().pendingByDraftId).toEqual({});
  });

  it("rethrows a failed creation and keeps the prompt for retry", async () => {
    const failure = new Error("daemon exploded");

    await expect(
      run(async () => {
        throw failure;
      }),
    ).rejects.toThrow(failure);

    expect(draftText()).toBe("do the thing");
  });

  it("keeps a prompt typed into the shared draft while creation was in flight", async () => {
    await run(async () => {
      saveDraft("a different idea");
    });

    expect(draftText()).toBe("a different idea");
  });
  it("keeps a newer draft written while workspace creation was pending", async () => {
    const clearConsumedDraft = captureCleanup();
    saveDraft("a newer workspace idea");
    await run(async () => undefined, clearConsumedDraft);
    expect(draftText()).toBe("a newer workspace idea");
  });
});
