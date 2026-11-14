import type {
  RadarStatus,
  RadarTask,
  RadarTaskStatus,
  StoredRadar,
} from "@gravity/protocol/radar/types";
import type { StatusBadgeVariant } from "@/components/ui/status-badge";

/** Tasks a radar card shows before the user asks for the rest. */
export const RADAR_TASK_PREVIEW_COUNT = 5;

const MS_PER_MINUTE = 60_000;

export interface RadarBadge {
  labelKey: string;
  variant: StatusBadgeVariant;
}

const RADAR_STATUS_BADGES: Record<RadarStatus, RadarBadge> = {
  active: { labelKey: "radar.status.watching", variant: "success" },
  paused: { labelKey: "radar.status.paused", variant: "muted" },
};

const RADAR_TASK_STATUS_BADGES: Record<RadarTaskStatus, RadarBadge> = {
  queued: { labelKey: "radar.task.status.queued", variant: "muted" },
  running: { labelKey: "radar.task.status.running", variant: "warning" },
  pr_open: { labelKey: "radar.task.status.prOpen", variant: "warning" },
  done: { labelKey: "radar.task.status.done", variant: "success" },
  skipped: { labelKey: "radar.task.status.skipped", variant: "muted" },
  failed: { labelKey: "radar.task.status.failed", variant: "error" },
};

// `kind` is an open string on the wire so a newer daemon can add kinds.
const RADAR_TASK_KIND_LABEL_KEYS: Record<string, string> = {
  error: "radar.task.kind.error",
  ticket: "radar.task.kind.ticket",
  linear: "radar.task.kind.linear",
};

export function radarStatusBadge(status: RadarStatus): RadarBadge {
  return RADAR_STATUS_BADGES[status];
}

export function radarTaskStatusBadge(status: RadarTaskStatus): RadarBadge {
  return RADAR_TASK_STATUS_BADGES[status];
}

/** Null for a kind this app version does not know; render the raw kind then. */
export function radarTaskKindLabelKey(kind: string): string | null {
  return RADAR_TASK_KIND_LABEL_KEYS[kind] ?? null;
}

export type RadarNextCheck =
  | { kind: "none" }
  | { kind: "soon" }
  | { kind: "minutes"; minutes: number };

/** A paused radar has no next check, whatever `nextPollAt` still says. */
export function resolveRadarNextCheck(
  radar: Pick<StoredRadar, "status" | "nextPollAt">,
  now: number,
): RadarNextCheck {
  if (radar.status === "paused" || !radar.nextPollAt) {
    return { kind: "none" };
  }
  const dueAt = Date.parse(radar.nextPollAt);
  if (Number.isNaN(dueAt)) {
    return { kind: "none" };
  }
  const remainingMs = dueAt - now;
  if (remainingMs < MS_PER_MINUTE) {
    return { kind: "soon" };
  }
  return { kind: "minutes", minutes: Math.round(remainingMs / MS_PER_MINUTE) };
}

export function sortRadarsNewestFirst<T extends Pick<StoredRadar, "createdAt">>(
  radars: readonly T[],
): T[] {
  return [...radars].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export interface RadarTaskPreview {
  tasks: RadarTask[];
  /** Tasks left out of the preview; zero once the user asked for all of them. */
  hiddenCount: number;
}

export function selectRadarTasks(
  tasks: readonly RadarTask[],
  options: { showAll: boolean },
): RadarTaskPreview {
  const newestFirst = [...tasks].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  if (options.showAll || newestFirst.length <= RADAR_TASK_PREVIEW_COUNT) {
    return { tasks: newestFirst, hiddenCount: 0 };
  }
  return {
    tasks: newestFirst.slice(0, RADAR_TASK_PREVIEW_COUNT),
    hiddenCount: newestFirst.length - RADAR_TASK_PREVIEW_COUNT,
  };
}

export interface RadarTaskNote {
  text: string;
  /** A skip is a decision, not a failure, so its reason stays muted. */
  tone: "danger" | "muted";
}

/** The daemon's reason for a task that failed or was skipped. */
export function resolveRadarTaskNote(
  task: Pick<RadarTask, "status" | "error">,
): RadarTaskNote | null {
  if (!task.error) {
    return null;
  }
  if (task.status === "failed") {
    return { text: task.error, tone: "danger" };
  }
  if (task.status === "skipped") {
    return { text: task.error, tone: "muted" };
  }
  return null;
}
