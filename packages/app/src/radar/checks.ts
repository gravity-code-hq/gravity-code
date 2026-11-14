import type { RadarCheck, RadarCheckMessage } from "@gravity/protocol/radar/types";
import type { StatusBadgeVariant } from "@/components/ui/status-badge";

/** Checks the history sheet asks for. A radar checks every five minutes, so this is about eight hours. */
export const RADAR_CHECK_HISTORY_PAGE_SIZE = 100;

/**
 * One fragment of a check's outcome line. `label` is client copy to translate;
 * `raw` is the daemon's own text (an error, or a status this app version does
 * not know) and is shown as is.
 */
export type RadarCheckOutcomePart =
  | { kind: "label"; labelKey: string; count?: number }
  | { kind: "raw"; text: string };

export interface RadarCheckOutcome {
  tone: "muted" | "danger";
  parts: RadarCheckOutcomePart[];
}

const FAILED_STATUS_LABEL_KEYS: Record<string, string> = {
  unreachable: "radar.checks.outcome.unreachable",
  failed: "radar.checks.outcome.failed",
};

// `decision` is an open string on the wire so a newer daemon can add decisions.
const DECISION_BADGES: Record<string, { labelKey: string; variant: StatusBadgeVariant }> = {
  task: { labelKey: "radar.checks.decision.task", variant: "success" },
  not_actionable: { labelKey: "radar.checks.decision.notActionable", variant: "muted" },
  human: { labelKey: "radar.checks.decision.human", variant: "muted" },
  tracked: { labelKey: "radar.checks.decision.tracked", variant: "muted" },
  handled: { labelKey: "radar.checks.decision.handled", variant: "muted" },
  over_limit: { labelKey: "radar.checks.decision.overLimit", variant: "warning" },
};

export interface RadarCheckDecisionBadge {
  /** Null for a decision this app version does not know; render the raw decision then. */
  labelKey: string | null;
  variant: StatusBadgeVariant;
}

export function radarCheckDecisionBadge(decision: string): RadarCheckDecisionBadge {
  return DECISION_BADGES[decision] ?? { labelKey: null, variant: "muted" };
}

export function countRadarCheckTasks(messages: readonly Pick<RadarCheckMessage, "decision">[]) {
  return messages.filter((message) => message.decision === "task").length;
}

// Locales disagree on plural forms, so the count picks between two explicit
// keys and the `many` copy is phrased to read with any number.
function countPart(count: number, oneKey: string, manyKey: string): RadarCheckOutcomePart {
  return count === 1
    ? { kind: "label", labelKey: oneKey }
    : { kind: "label", labelKey: manyKey, count };
}

function describeActivity(
  check: Pick<RadarCheck, "messages" | "followUps" | "merged">,
): RadarCheckOutcomePart[] {
  const parts: RadarCheckOutcomePart[] = [];
  if (check.messages.length === 0) {
    parts.push({ kind: "label", labelKey: "radar.checks.outcome.noMessages" });
  } else {
    parts.push(
      countPart(
        check.messages.length,
        "radar.checks.outcome.messagesOne",
        "radar.checks.outcome.messagesMany",
      ),
      countPart(
        countRadarCheckTasks(check.messages),
        "radar.checks.outcome.tasksOne",
        "radar.checks.outcome.tasksMany",
      ),
    );
  }
  if (check.followUps > 0) {
    parts.push(
      countPart(
        check.followUps,
        "radar.checks.outcome.followUpsOne",
        "radar.checks.outcome.followUpsMany",
      ),
    );
  }
  if (check.merged > 0) {
    parts.push(
      countPart(check.merged, "radar.checks.outcome.mergedOne", "radar.checks.outcome.mergedMany"),
    );
  }
  return parts;
}

/**
 * The one line under a check's time. A check that read Slack reports what it
 * found; one that could not reports the daemon's error, falling back to a
 * local sentence only when the daemon sent none.
 */
export function resolveRadarCheckOutcome(
  check: Pick<RadarCheck, "status" | "error" | "messages" | "followUps" | "merged">,
): RadarCheckOutcome {
  if (check.status === "ok") {
    return { tone: "muted", parts: describeActivity(check) };
  }
  if (check.error) {
    return { tone: "danger", parts: [{ kind: "raw", text: check.error }] };
  }
  const labelKey = FAILED_STATUS_LABEL_KEYS[check.status];
  if (labelKey) {
    return { tone: "danger", parts: [{ kind: "label", labelKey }] };
  }
  return { tone: "muted", parts: [{ kind: "raw", text: check.status }] };
}

/** A Slack `ts` is seconds since the epoch with a microsecond suffix. Null when unreadable. */
export function slackTsToDate(ts: string): Date | null {
  const seconds = Number(ts.split(".")[0]);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return new Date(seconds * 1000);
}

export type RadarChecksView =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; checks: RadarCheck[]; isLimited: boolean };

/**
 * A history that loaded once stays on screen when a later refetch fails; the
 * error state is only for a sheet with nothing to show.
 */
export function resolveRadarChecksView(input: {
  checks: RadarCheck[] | undefined;
  error: Error | null;
}): RadarChecksView {
  if (input.checks) {
    return {
      kind: "loaded",
      checks: input.checks,
      isLimited: input.checks.length >= RADAR_CHECK_HISTORY_PAGE_SIZE,
    };
  }
  if (input.error) {
    return { kind: "error", message: input.error.message };
  }
  return { kind: "loading" };
}
