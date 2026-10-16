import type { ScheduleSummary } from "@gravity/protocol/schedule/types";
import { describe, expect, it } from "vitest";
import type { ScheduleDerivedState } from "./schedule-derivation";
import { filterScheduleRows } from "./schedule-list-filter";

function makeRow(
  name: string,
  state: ScheduleDerivedState,
  overrides: Partial<ScheduleSummary> = {},
): { schedule: ScheduleSummary; state: ScheduleDerivedState; targetLabel: string } {
  return {
    schedule: {
      id: name,
      name,
      prompt: "Run the task",
      cadence: { type: "every", everyMs: 3_600_000 },
      target: { type: "new-agent", config: { provider: "codex", cwd: "/tmp/project" } },
      status: "active",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
      nextRunAt: null,
      lastRunAt: null,
      pausedAt: null,
      expiresAt: null,
      maxRuns: null,
      ...overrides,
    },
    state,
    targetLabel: "gravity",
  };
}

const rows = [
  makeRow("Nightly", "active"),
  makeRow("Weekly", "paused", { prompt: "Summarize the Slack inbox" }),
  makeRow("Release", "finished"),
  makeRow("Cleanup", "expired"),
  makeRow("Heartbeat", "targetGone"),
];

function names(result: ReturnType<typeof filterScheduleRows<(typeof rows)[number]>>): string[] {
  return result.map((row) => row.schedule.name ?? "");
}

describe("filterScheduleRows", () => {
  it("groups finished, expired, and target-gone automations under ended", () => {
    expect(names(filterScheduleRows(rows, { query: "", status: "ended" }))).toEqual([
      "Release",
      "Cleanup",
      "Heartbeat",
    ]);
    expect(names(filterScheduleRows(rows, { query: "", status: "paused" }))).toEqual(["Weekly"]);
    expect(filterScheduleRows(rows, { query: "", status: "all" })).toHaveLength(5);
  });

  it("searches the title, prompt, and cadence together with the status filter", () => {
    expect(names(filterScheduleRows(rows, { query: "slack", status: "all" }))).toEqual(["Weekly"]);
    expect(names(filterScheduleRows(rows, { query: "slack", status: "active" }))).toEqual([]);
    expect(filterScheduleRows(rows, { query: "every 1 hour", status: "all" })).toHaveLength(5);
  });
});
