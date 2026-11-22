import type { RadarTask } from "@gravity/protocol/radar/types";
import { describe, expect, it } from "vitest";
import {
  RADAR_TASK_PREVIEW_COUNT,
  formatRadarChannel,
  radarStatusBadge,
  radarTaskKindLabelKey,
  radarTaskStatusBadge,
  resolveRadarNextCheck,
  resolveRadarTaskNote,
  selectRadarTasks,
  sortRadarsNewestFirst,
} from "./presentation";

function makeTask(overrides: Partial<RadarTask> = {}): RadarTask {
  return {
    id: "task-1",
    kind: "error",
    summary: "Checkout 500s on /pay",
    author: "Sentry",
    messageTs: "1700000000.000100",
    threadTs: "1700000000.000100",
    text: "TypeError: cannot read properties of undefined",
    permalink: null,
    status: "queued",
    step: "start",
    followUp: null,
    threadCursorTs: null,
    agentId: null,
    workspaceId: null,
    prUrl: null,
    error: null,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    ...overrides,
  };
}

const NOW = Date.parse("2026-11-01T10:00:00.000Z");

describe("resolveRadarNextCheck", () => {
  it("counts the minutes to the next check", () => {
    expect(
      resolveRadarNextCheck({ status: "active", nextPollAt: "2026-11-01T10:04:10.000Z" }, NOW),
    ).toEqual({ kind: "minutes", minutes: 4 });
  });

  it("says soon inside the last minute and when the check is overdue", () => {
    expect(
      resolveRadarNextCheck({ status: "active", nextPollAt: "2026-11-01T10:00:40.000Z" }, NOW),
    ).toEqual({ kind: "soon" });
    expect(
      resolveRadarNextCheck({ status: "active", nextPollAt: "2026-11-01T09:58:00.000Z" }, NOW),
    ).toEqual({ kind: "soon" });
  });

  it("has no next check while paused, even with a stale nextPollAt", () => {
    expect(
      resolveRadarNextCheck({ status: "paused", nextPollAt: "2026-11-01T10:04:00.000Z" }, NOW),
    ).toEqual({ kind: "none" });
  });

  it("has no next check when none is scheduled or the timestamp is unreadable", () => {
    expect(resolveRadarNextCheck({ status: "active", nextPollAt: null }, NOW)).toEqual({
      kind: "none",
    });
    expect(resolveRadarNextCheck({ status: "active", nextPollAt: "not a date" }, NOW)).toEqual({
      kind: "none",
    });
  });
});

describe("selectRadarTasks", () => {
  const tasks = Array.from({ length: RADAR_TASK_PREVIEW_COUNT + 2 }, (_, index) =>
    makeTask({
      id: `task-${index}`,
      createdAt: new Date(NOW + index * 60_000).toISOString(),
    }),
  );

  it("previews the newest tasks and counts the rest", () => {
    const preview = selectRadarTasks(tasks, { showAll: false });

    expect(preview.tasks.map((task) => task.id)).toEqual([
      "task-6",
      "task-5",
      "task-4",
      "task-3",
      "task-2",
    ]);
    expect(preview.hiddenCount).toBe(2);
  });

  it("returns every task newest first when asked for all", () => {
    const preview = selectRadarTasks(tasks, { showAll: true });

    expect(preview.tasks).toHaveLength(tasks.length);
    expect(preview.tasks[0]?.id).toBe("task-6");
    expect(preview.tasks.at(-1)?.id).toBe("task-0");
    expect(preview.hiddenCount).toBe(0);
  });

  it("hides nothing when the list fits the preview", () => {
    const preview = selectRadarTasks(tasks.slice(0, RADAR_TASK_PREVIEW_COUNT), { showAll: false });

    expect(preview.tasks).toHaveLength(RADAR_TASK_PREVIEW_COUNT);
    expect(preview.hiddenCount).toBe(0);
  });

  it("does not reorder the caller's array", () => {
    const original = tasks.map((task) => task.id);

    selectRadarTasks(tasks, { showAll: true });

    expect(tasks.map((task) => task.id)).toEqual(original);
  });
});

describe("sortRadarsNewestFirst", () => {
  it("puts the most recently created radar first", () => {
    const sorted = sortRadarsNewestFirst([
      { id: "old", createdAt: "2026-10-01T00:00:00.000Z" },
      { id: "new", createdAt: "2026-11-01T00:00:00.000Z" },
      { id: "mid", createdAt: "2026-10-15T00:00:00.000Z" },
    ]);

    expect(sorted.map((radar) => radar.id)).toEqual(["new", "mid", "old"]);
  });
});

describe("resolveRadarTaskNote", () => {
  it("shows a failed task's error as a failure", () => {
    expect(resolveRadarTaskNote({ status: "failed", error: "Agent exited with code 1" })).toEqual({
      text: "Agent exited with code 1",
      tone: "danger",
    });
  });

  it("shows a skipped task's reason without alarm", () => {
    expect(resolveRadarTaskNote({ status: "skipped", error: "Duplicate of an open task" })).toEqual(
      {
        text: "Duplicate of an open task",
        tone: "muted",
      },
    );
  });

  it("shows nothing without an error or for a task that is still moving", () => {
    expect(resolveRadarTaskNote({ status: "failed", error: null })).toBeNull();
    expect(resolveRadarTaskNote({ status: "running", error: "stale" })).toBeNull();
  });
});

describe("badges and kind labels", () => {
  it("labels an active radar as watching", () => {
    expect(radarStatusBadge("active")).toEqual({
      labelKey: "radar.status.watching",
      variant: "success",
    });
    expect(radarStatusBadge("paused").variant).toBe("muted");
  });

  it("maps every task status to a pill", () => {
    expect(radarTaskStatusBadge("pr_open")).toEqual({
      labelKey: "radar.task.status.prOpen",
      variant: "warning",
    });
    expect(radarTaskStatusBadge("done").variant).toBe("success");
    expect(radarTaskStatusBadge("failed").variant).toBe("error");
    expect(radarTaskStatusBadge("skipped").variant).toBe("muted");
  });

  it("knows today's kinds and returns null for one a newer daemon added", () => {
    expect(radarTaskKindLabelKey("error")).toBe("radar.task.kind.error");
    expect(radarTaskKindLabelKey("linear")).toBe("radar.task.kind.linear");
    expect(radarTaskKindLabelKey("incident")).toBeNull();
  });
});

describe("formatRadarChannel", () => {
  it("prefixes a channel name with # and leaves a channel id as it is", () => {
    expect(formatRadarChannel("dev-ripple")).toBe("#dev-ripple");
    expect(formatRadarChannel("C0TICKETS1")).toBe("C0TICKETS1");
  });
});
