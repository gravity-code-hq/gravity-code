import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  completeStarPrompt,
  deferStarPrompt,
  INITIAL_STAR_PROMPT_SCHEDULE,
  recordStarPromptAgentCreated,
  syncStarPromptVersion,
  type StarPromptSchedule,
} from "./star-prompt-policy";

/**
 * `gh` stars directly through a host's GitHub CLI. `web` opens the repository
 * in a browser, for when no host can star or tell us whether it already has.
 */
export type StarPromptMode = "gh" | "web";

/** `schedule` is the automatic ask; `manual` is the user opening it from the help menu. */
export type StarPromptSource = "schedule" | "manual";

export interface OpenStarPrompt {
  /** Changes for every prompt shown, so the sheet starts each one fresh. */
  id: number;
  source: StarPromptSource;
  mode: StarPromptMode;
  serverId: string | null;
  alreadyStarred: boolean;
}

interface StarPromptStoreState {
  schedule: StarPromptSchedule;
  prompt: OpenStarPrompt | null;
  syncVersion: (appVersion: string | null) => void;
  recordAgentCreated: (appVersion: string | null) => void;
  defer: () => void;
  complete: () => void;
  showPrompt: (prompt: Omit<OpenStarPrompt, "id">) => void;
  closePrompt: () => void;
}

let nextPromptId = 0;

const STAR_PROMPT_STORAGE_KEY = "github-star-prompt";

const StarPromptPersistedStateSchema = z.strictObject({
  schedule: z.strictObject({
    agentsCreated: z.number().int().nonnegative(),
    appVersion: z.string().nullable(),
    baselineAgents: z.number().int().nonnegative().nullable(),
    nextThreshold: z.number().int().positive(),
    deferredUntil: z.number().nullable(),
    completed: z.boolean(),
  }),
});

export const useStarPromptStore = create<StarPromptStoreState>()(
  persist(
    (set) => ({
      schedule: INITIAL_STAR_PROMPT_SCHEDULE,
      prompt: null,
      syncVersion: (appVersion) =>
        set((state) => {
          const schedule = syncStarPromptVersion(state.schedule, appVersion);
          return schedule === state.schedule ? state : { schedule };
        }),
      recordAgentCreated: (appVersion) =>
        set((state) => ({
          schedule: recordStarPromptAgentCreated(syncStarPromptVersion(state.schedule, appVersion)),
        })),
      defer: () => set((state) => ({ schedule: deferStarPrompt(state.schedule, Date.now()) })),
      complete: () => set((state) => ({ schedule: completeStarPrompt(state.schedule) })),
      showPrompt: (prompt) => {
        nextPromptId += 1;
        set({ prompt: { ...prompt, id: nextPromptId } });
      },
      closePrompt: () => set({ prompt: null }),
    }),
    {
      name: STAR_PROMPT_STORAGE_KEY,
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, StarPromptPersistedStateSchema),
      partialize: (state) => ({ schedule: state.schedule }),
    },
  ),
);
