import type { RadarCheck, RadarCheckMessage } from "@gravity/protocol/radar/types";
import { describe, expect, it } from "vitest";
import {
  RADAR_CHECK_HISTORY_PAGE_SIZE,
  countRadarCheckTasks,
  radarCheckDecisionBadge,
  resolveRadarCheckOutcome,
  resolveRadarChecksView,
  slackTsToDate,
} from "./checks";

function makeMessage(overrides: Partial<RadarCheckMessage> = {}): RadarCheckMessage {
  return {
    ts: "1700000000.000100",
    author: "Sentry",
    isBot: true,
    kind: "error",
    summary: "Checkout 500s on /pay",
    permalink: null,
    decision: "task",
    reason: null,
    taskId: "task-1",
    ...overrides,
  };
}

function makeCheck(overrides: Partial<RadarCheck> = {}): RadarCheck {
  return {
    id: "check-1",
    startedAt: "2026-11-01T10:00:00.000Z",
    endedAt: "2026-11-01T10:00:20.000Z",
    status: "ok",
    error: null,
    sinceTs: "1700000000.000000",
    messages: [],
    followUps: 0,
    merged: 0,
    ...overrides,
  };
}

describe("resolveRadarCheckOutcome", () => {
  it("says no new messages for a quiet check", () => {
    expect(resolveRadarCheckOutcome(makeCheck())).toEqual({
      tone: "muted",
      parts: [{ kind: "label", labelKey: "radar.checks.outcome.noMessages" }],
    });
  });

  it("counts new messages and the tasks they became", () => {
    const check = makeCheck({
      messages: [
        makeMessage(),
        makeMessage({ decision: "not_actionable", taskId: null }),
        makeMessage({ decision: "human", taskId: null }),
      ],
    });

    expect(resolveRadarCheckOutcome(check)).toEqual({
      tone: "muted",
      parts: [
        { kind: "label", labelKey: "radar.checks.outcome.messagesMany", count: 3 },
        { kind: "label", labelKey: "radar.checks.outcome.tasksOne" },
      ],
    });
  });

  it("uses the singular message copy and still reports zero tasks", () => {
    const check = makeCheck({ messages: [makeMessage({ decision: "tracked", taskId: null })] });

    expect(resolveRadarCheckOutcome(check).parts).toEqual([
      { kind: "label", labelKey: "radar.checks.outcome.messagesOne" },
      { kind: "label", labelKey: "radar.checks.outcome.tasksMany", count: 0 },
    ]);
  });

  it("adds follow-ups and merged pull requests only when there are some", () => {
    expect(resolveRadarCheckOutcome(makeCheck({ followUps: 2, merged: 1 })).parts).toEqual([
      { kind: "label", labelKey: "radar.checks.outcome.noMessages" },
      { kind: "label", labelKey: "radar.checks.outcome.followUpsMany", count: 2 },
      { kind: "label", labelKey: "radar.checks.outcome.mergedOne" },
    ]);
  });

  it("shows the daemon's error for a check that could not read Slack", () => {
    const check = makeCheck({ status: "unreachable", error: "Slack is not reachable" });

    expect(resolveRadarCheckOutcome(check)).toEqual({
      tone: "danger",
      parts: [{ kind: "raw", text: "Slack is not reachable" }],
    });
  });

  it("falls back to local copy when a failed check carries no error", () => {
    expect(resolveRadarCheckOutcome(makeCheck({ status: "unreachable" })).parts).toEqual([
      { kind: "label", labelKey: "radar.checks.outcome.unreachable" },
    ]);
    expect(resolveRadarCheckOutcome(makeCheck({ status: "failed" }))).toEqual({
      tone: "danger",
      parts: [{ kind: "label", labelKey: "radar.checks.outcome.failed" }],
    });
  });

  it("shows a status a newer daemon added as the raw string", () => {
    expect(resolveRadarCheckOutcome(makeCheck({ status: "rate_limited" }))).toEqual({
      tone: "muted",
      parts: [{ kind: "raw", text: "rate_limited" }],
    });
    expect(
      resolveRadarCheckOutcome(makeCheck({ status: "rate_limited", error: "Try again later" })),
    ).toEqual({ tone: "danger", parts: [{ kind: "raw", text: "Try again later" }] });
  });
});

describe("radarCheckDecisionBadge", () => {
  it("labels every decision the daemon makes today", () => {
    expect(radarCheckDecisionBadge("task")).toEqual({
      labelKey: "radar.checks.decision.task",
      variant: "success",
    });
    expect(radarCheckDecisionBadge("not_actionable").labelKey).toBe(
      "radar.checks.decision.notActionable",
    );
    expect(radarCheckDecisionBadge("human").labelKey).toBe("radar.checks.decision.human");
    expect(radarCheckDecisionBadge("tracked").labelKey).toBe("radar.checks.decision.tracked");
    expect(radarCheckDecisionBadge("over_limit")).toEqual({
      labelKey: "radar.checks.decision.overLimit",
      variant: "warning",
    });
  });

  it("returns no label for a decision a newer daemon added", () => {
    expect(radarCheckDecisionBadge("duplicate")).toEqual({ labelKey: null, variant: "muted" });
  });
});

describe("countRadarCheckTasks", () => {
  it("counts only the messages that became tasks", () => {
    expect(
      countRadarCheckTasks([makeMessage(), makeMessage({ decision: "over_limit" }), makeMessage()]),
    ).toBe(2);
    expect(countRadarCheckTasks([])).toBe(0);
  });
});

describe("slackTsToDate", () => {
  it("reads the seconds before the microsecond suffix", () => {
    expect(slackTsToDate("1700000000.000100")?.toISOString()).toBe("2023-11-14T22:13:20.000Z");
  });

  it("returns null for a ts it cannot read", () => {
    expect(slackTsToDate("")).toBeNull();
    expect(slackTsToDate("not-a-ts")).toBeNull();
    expect(slackTsToDate("0")).toBeNull();
  });
});

describe("resolveRadarChecksView", () => {
  it("is loading until the first answer", () => {
    expect(resolveRadarChecksView({ checks: undefined, error: null })).toEqual({ kind: "loading" });
  });

  it("reports the error only when there is no history to show", () => {
    const error = new Error("Radar not found");

    expect(resolveRadarChecksView({ checks: undefined, error })).toEqual({
      kind: "error",
      message: "Radar not found",
    });
    expect(resolveRadarChecksView({ checks: [makeCheck()], error })).toMatchObject({
      kind: "loaded",
    });
  });

  it("loads an empty history as loaded, not loading", () => {
    expect(resolveRadarChecksView({ checks: [], error: null })).toEqual({
      kind: "loaded",
      checks: [],
      isLimited: false,
    });
  });

  it("flags a history that filled the page, since older checks may exist", () => {
    const checks = Array.from({ length: RADAR_CHECK_HISTORY_PAGE_SIZE }, (_, index) =>
      makeCheck({ id: `check-${index}` }),
    );

    expect(resolveRadarChecksView({ checks, error: null })).toMatchObject({ isLimited: true });
  });
});
