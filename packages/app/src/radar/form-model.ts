import { normalizeRadarChannel, type StoredRadar } from "@gravity/protocol/radar/types";
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

export type RadarFormRecord = Pick<StoredRadar, "id" | "channel" | "cwd" | "instructions">;

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
  instructions?: string;
}

/** Only the fields the user changed; `instructions: null` clears them. */
export interface RadarUpdateFields {
  radarId: string;
  channel?: string;
  cwd?: string;
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
  channel: string;
  /** Set once the typed channel cannot be a channel name, id, or link. */
  isChannelInvalid: boolean;
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
  setChannel: (value: string) => void;
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
    channel: radar ? `#${radar.channel}` : "",
    isChannelInvalid: false,
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
      });
    },
    setProject(optionId, display) {
      const target = projectTargets.find((entry) => entry.optionId === optionId);
      if (!target) {
        return;
      }
      publish({ selectedProjectOptionId: optionId, projectDisplay: display, cwd: target.cwd });
    },
    setChannel(value) {
      publish({ channel: value });
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
