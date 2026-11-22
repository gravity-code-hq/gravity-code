import {
  normalizeRadarChannel,
  type RadarIsolation,
  type StoredRadar,
} from "@gravity/protocol/radar/types";
import type { ScheduleProjectTarget } from "@/schedules/schedule-project-targets";
import { shortenPath } from "@/utils/shorten-path";
import { toErrorMessage } from "@/utils/error-messages";

export interface RadarFormDisplay {
  label: string;
}

export interface RadarFormProjectOption {
  id: string;
  value: string;
  label: string;
  testID: string;
}

/** A model the radar's provider offers on this host. */
export interface RadarFormModelChoice {
  id: string;
  label: string;
}

export interface RadarFormModelOption {
  id: string;
  value: string;
  label: string;
  testID: string;
}

export type RadarFormRecord = Pick<
  StoredRadar,
  "id" | "channel" | "cwd" | "instructions" | "provider" | "model" | "isolation"
>;

export interface RadarFormSnapshot {
  /** The host the screen is pinned to; a radar never moves between hosts. */
  serverId: string;
  /** The radar being edited, or null to create one. */
  radar: RadarFormRecord | null;
  projectTargets: readonly ScheduleProjectTarget[];
}

export interface RadarCreateFields {
  channel: string;
  cwd: string;
  /** Left out to run on the provider's default model. */
  model?: string;
  /** Left out to run in the project's existing workspace. */
  isolation?: RadarIsolation;
  instructions?: string;
}

/** Only the fields the user changed; a `null` clears `instructions` or returns `model` to the default. */
export interface RadarUpdateFields {
  radarId: string;
  channel?: string;
  cwd?: string;
  model?: string | null;
  isolation?: RadarIsolation;
  instructions?: string | null;
}

export type RadarFormSubmission =
  | { kind: "create"; input: RadarCreateFields }
  | { kind: "update"; input: RadarUpdateFields };

export interface RadarFormState {
  mode: "create" | "edit";
  projectOptions: RadarFormProjectOption[];
  selectedProjectOptionId: string | null;
  projectDisplay: RadarFormDisplay | null;
  cwd: string;
  isolation: RadarIsolation;
  /** False for a project that is not a git checkout, which has nothing to cut a worktree from. */
  canUseWorktree: boolean;
  channel: string;
  /** Set once the typed channel cannot be a channel name, id, or link. */
  isChannelInvalid: boolean;
  modelOptions: RadarFormModelOption[];
  /** Null runs tasks on the provider's default model. */
  selectedModel: string | null;
  modelDisplay: RadarFormDisplay | null;
  instructions: string;
  pending: boolean;
  submitError: string | null;
  canSubmit: boolean;
}

export interface RadarFormModel {
  getState: () => RadarFormState;
  subscribe: (listener: () => void) => () => void;
  close: () => void;
  applyProjectTargets: (targets: readonly ScheduleProjectTarget[]) => void;
  setProject: (optionId: string, display: RadarFormDisplay) => void;
  setIsolation: (value: RadarIsolation) => void;
  setChannel: (value: string) => void;
  applyModels: (models: readonly RadarFormModelChoice[]) => void;
  setModel: (modelId: string | null, display: RadarFormDisplay | null) => void;
  setInstructions: (value: string) => void;
  submit: (save: (submission: RadarFormSubmission) => Promise<void>) => Promise<void>;
}

// A channel name or id has no whitespace and no path separators. What is left
// after normalizing a pasted link that was not a channel link still has both.
const CHANNEL_PATTERN = /^[^\s/]+$/;

function resolveChannel(input: string): string | null {
  const channel = normalizeRadarChannel(input);
  return CHANNEL_PATTERN.test(channel) ? channel : null;
}

function buildProjectOptions(
  targets: readonly ScheduleProjectTarget[],
  serverId: string,
): RadarFormProjectOption[] {
  return targets
    .filter((target) => target.serverId === serverId)
    .map((target) => ({
      id: target.optionId,
      value: target.optionId,
      label: target.projectName,
      testID: `radar-project-option-${target.projectViewKey}`,
    }));
}

function buildModelOptions(models: readonly RadarFormModelChoice[]): RadarFormModelOption[] {
  return models.map((model) => ({
    id: model.id,
    value: model.id,
    label: model.label,
    testID: `radar-model-option-${model.id}`,
  }));
}

function findTargetByCwd(
  targets: readonly ScheduleProjectTarget[],
  serverId: string,
  cwd: string,
): ScheduleProjectTarget | null {
  return targets.find((target) => target.serverId === serverId && target.cwd === cwd) ?? null;
}

function buildSubmission(
  state: RadarFormState,
  radar: RadarFormRecord | null,
): RadarFormSubmission | null {
  const channel = resolveChannel(state.channel);
  if (!channel || !state.cwd) {
    return null;
  }
  const instructions = state.instructions.trim();
  if (!radar) {
    const created: RadarCreateFields = { channel, cwd: state.cwd };
    if (state.selectedModel) {
      created.model = state.selectedModel;
    }
    if (state.isolation === "worktree") {
      created.isolation = state.isolation;
    }
    if (instructions) {
      created.instructions = instructions;
    }
    return { kind: "create", input: created };
  }
  const changed: RadarUpdateFields = { radarId: radar.id };
  if (channel !== radar.channel) {
    changed.channel = channel;
  }
  if (state.cwd !== radar.cwd) {
    changed.cwd = state.cwd;
  }
  if (state.selectedModel !== (radar.model ?? null)) {
    changed.model = state.selectedModel;
  }
  if (state.isolation !== (radar.isolation ?? "local")) {
    changed.isolation = state.isolation;
  }
  if (instructions !== (radar.instructions ?? "").trim()) {
    changed.instructions = instructions || null;
  }
  return { kind: "update", input: changed };
}

function withDerived(state: RadarFormState): RadarFormState {
  const hasChannelText = state.channel.trim() !== "";
  const channel = resolveChannel(state.channel);
  return {
    ...state,
    isChannelInvalid: hasChannelText && channel === null,
    canSubmit: !state.pending && channel !== null && state.cwd !== "",
  };
}

function buildInitialState(snapshot: RadarFormSnapshot): RadarFormState {
  const { radar, serverId, projectTargets } = snapshot;
  const cwd = radar?.cwd.trim() ?? "";
  const target = cwd ? findTargetByCwd(projectTargets, serverId, cwd) : null;
  const storedDisplay = cwd ? { label: shortenPath(cwd) } : null;
  return withDerived({
    mode: radar ? "edit" : "create",
    projectOptions: buildProjectOptions(projectTargets, serverId),
    selectedProjectOptionId: target?.optionId ?? null,
    projectDisplay: target ? { label: target.projectName } : storedDisplay,
    cwd,
    isolation: radar?.isolation ?? "local",
    // A stored folder whose project is not known yet is given the benefit of the doubt.
    canUseWorktree: target?.isGit !== false,
    channel: radar ? `#${radar.channel}` : "",
    isChannelInvalid: false,
    modelOptions: [],
    selectedModel: radar?.model ?? null,
    // The stored id stands in until the host's model list names it.
    modelDisplay: radar?.model ? { label: radar.model } : null,
    instructions: radar?.instructions ?? "",
    pending: false,
    submitError: null,
    canSubmit: false,
  });
}

export function openRadarForm(snapshot: RadarFormSnapshot): RadarFormModel {
  const listeners = new Set<() => void>();
  const { serverId, radar } = snapshot;
  let closed = false;
  let projectTargets = snapshot.projectTargets;
  let state = buildInitialState(snapshot);

  function publish(patch: Partial<RadarFormState>): void {
    if (closed) {
      return;
    }
    state = withDerived({ ...state, ...patch });
    for (const listener of listeners) {
      listener();
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      closed = true;
      listeners.clear();
    },
    applyProjectTargets(nextTargets) {
      if (closed || projectTargets === nextTargets) {
        return;
      }
      projectTargets = nextTargets;
      const projectOptions = buildProjectOptions(nextTargets, serverId);
      // A stored cwd opened before its project was known shows as a path. Name
      // it once the project arrives; a project the user picked is never touched.
      const lateTarget =
        state.selectedProjectOptionId === null && state.cwd
          ? findTargetByCwd(nextTargets, serverId, state.cwd)
          : null;
      if (!lateTarget) {
        publish({ projectOptions });
        return;
      }
      publish({
        projectOptions,
        selectedProjectOptionId: lateTarget.optionId,
        projectDisplay: { label: lateTarget.projectName },
        canUseWorktree: lateTarget.isGit,
      });
    },
    setProject(optionId, display) {
      const target = projectTargets.find((entry) => entry.optionId === optionId);
      if (!target) {
        return;
      }
      publish({
        selectedProjectOptionId: optionId,
        projectDisplay: display,
        cwd: target.cwd,
        canUseWorktree: target.isGit,
        isolation: target.isGit ? state.isolation : "local",
      });
    },
    setIsolation(value) {
      if (value === "worktree" && !state.canUseWorktree) {
        return;
      }
      publish({ isolation: value });
    },
    setChannel(value) {
      publish({ channel: value });
    },
    applyModels(models) {
      if (closed) {
        return;
      }
      const modelOptions = buildModelOptions(models);
      const selected = models.find((entry) => entry.id === state.selectedModel);
      // Name a model that so far showed as its raw id. A label the user picked
      // is already the model's own label, so this never overwrites a choice.
      if (selected && state.modelDisplay?.label === selected.id) {
        publish({ modelOptions, modelDisplay: { label: selected.label } });
        return;
      }
      publish({ modelOptions });
    },
    setModel(modelId, display) {
      publish({ selectedModel: modelId, modelDisplay: modelId ? display : null });
    },
    setInstructions(value) {
      publish({ instructions: value });
    },
    async submit(save) {
      const submission = buildSubmission(state, radar);
      if (closed || state.pending || !submission) {
        return;
      }
      publish({ pending: true, submitError: null });
      try {
        await save(submission);
      } catch (error) {
        publish({ submitError: toErrorMessage(error) });
      } finally {
        publish({ pending: false });
      }
    },
  };
}
