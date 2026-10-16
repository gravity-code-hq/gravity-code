interface SelectionDisplay {
  label: string;
}

interface Selection {
  id: string;
  display: SelectionDisplay;
}

export interface LinearStartDraft {
  prompt: string;
  project: Selection | null;
  workspaceKind: "new" | "existing";
  workspace: Selection | null;
}

interface LinearStartFormState extends LinearStartDraft {
  pending: boolean;
  error: string | null;
  canSubmit: boolean;
}

export function openLinearStartForm(initialPrompt: string) {
  let closed = false;
  let state: LinearStartFormState = {
    prompt: initialPrompt,
    project: null,
    workspaceKind: "existing",
    workspace: null,
    pending: false,
    error: null,
    canSubmit: false,
  };
  const listeners = new Set<() => void>();
  function publish(patch: Partial<LinearStartFormState>) {
    if (closed) return;
    state = { ...state, ...patch };
    // An existing-workspace start with no workspace picked runs in the repository checkout.
    state.canSubmit = !state.pending && state.project !== null && state.prompt.trim().length > 0;
    listeners.forEach((listener) => listener());
  }
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      closed = true;
      listeners.clear();
    },
    setPrompt(prompt: string) {
      publish({ prompt });
    },
    setProject(id: string, display: SelectionDisplay) {
      publish({ project: { id, display }, workspace: null });
    },
    setWorkspaceKind(workspaceKind: LinearStartDraft["workspaceKind"]) {
      publish({ workspaceKind, workspace: null });
    },
    setWorkspace(id: string, display: SelectionDisplay) {
      publish({ workspace: { id, display } });
    },
    async submit(start: (draft: LinearStartDraft) => Promise<void>) {
      if (closed || !state.canSubmit) return;
      const draft = state;
      publish({ pending: true, error: null });
      try {
        await start(draft);
      } catch (error) {
        publish({ error: error instanceof Error ? error.message : String(error) });
      } finally {
        publish({ pending: false });
      }
    },
  };
}
