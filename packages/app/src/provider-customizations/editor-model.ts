import type { FileWriteResult } from "@gravity/protocol/messages";

interface EditorSnapshot {
  content: string;
  modifiedAt: string;
  revision?: string;
}

type SaveState =
  | { status: "idle" | "saving" | "saved" }
  | { status: "error"; error: string }
  | { status: "conflict" };

export function openCustomizationEditor(
  snapshot: EditorSnapshot,
  write: (input: {
    content: string;
    expectedModifiedAt: string;
    expectedRevision?: string;
  }) => Promise<FileWriteResult>,
) {
  let baseline = snapshot;
  let state = { content: snapshot.content, dirty: false, save: { status: "idle" } as SaveState };
  let closed = false;
  const listeners = new Set<() => void>();
  function publish(next: typeof state) {
    if (closed) return;
    state = next;
    for (const listener of listeners) listener();
  }
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setContent(content: string) {
      if (state.save.status === "saving") return;
      publish({ content, dirty: content !== baseline.content, save: { status: "idle" } });
    },
    async save() {
      if (!state.dirty || state.save.status === "saving" || closed) return;
      const content = state.content;
      publish({ ...state, save: { status: "saving" } });
      try {
        const result = await write({
          content,
          expectedModifiedAt: baseline.modifiedAt,
          expectedRevision: baseline.revision,
        });
        if (result.status === "written") {
          baseline = { content, modifiedAt: result.modifiedAt, revision: result.revision };
          publish({ content, dirty: false, save: { status: "saved" } });
        } else if (result.status === "conflict") {
          publish({ ...state, save: { status: "conflict" } });
        } else {
          publish({ ...state, save: { status: "error", error: result.error } });
        }
      } catch (error) {
        publish({
          ...state,
          save: { status: "error", error: error instanceof Error ? error.message : String(error) },
        });
      }
    },
    close() {
      closed = true;
      listeners.clear();
    },
  };
}
