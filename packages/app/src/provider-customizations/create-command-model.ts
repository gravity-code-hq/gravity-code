import { ProviderCommandNameSchema } from "@gravity/protocol/provider-customizations";

type SaveState = { status: "idle" | "saving" | "exists" } | { status: "error"; error: string };

export function openCreateCommandForm(
  create: (input: { name: string; content: string }) => Promise<{ status: "created" | "exists" }>,
) {
  let state = {
    name: "",
    content: "",
    invalidName: false,
    canSave: false,
    dirty: false,
    save: { status: "idle" } as SaveState,
  };
  let closed = false;
  const listeners = new Set<() => void>();
  function publish(next: typeof state) {
    if (closed) return;
    const validName = ProviderCommandNameSchema.safeParse(next.name.trim()).success;
    state = {
      ...next,
      invalidName: next.name.length > 0 && !validName,
      canSave: validName && next.content.trim().length > 0 && next.save.status !== "saving",
      dirty: next.name.length > 0 || next.content.length > 0,
    };
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
    setName(name: string) {
      if (state.save.status !== "saving") publish({ ...state, name, save: { status: "idle" } });
    },
    setContent(content: string) {
      if (state.save.status !== "saving") publish({ ...state, content, save: { status: "idle" } });
    },
    async save(): Promise<boolean> {
      if (!state.canSave || closed) return false;
      publish({ ...state, save: { status: "saving" } });
      try {
        const result = await create({ name: state.name.trim(), content: state.content });
        if (closed) return false;
        if (result.status === "created") return true;
        publish({ ...state, save: { status: "exists" } });
      } catch (error) {
        publish({
          ...state,
          save: { status: "error", error: error instanceof Error ? error.message : String(error) },
        });
      }
      return false;
    },
    close() {
      closed = true;
      listeners.clear();
    },
  };
}
