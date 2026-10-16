import type { ScheduleRun } from "@gravity/protocol/schedule/types";
import { describe, expect, it } from "vitest";
import type { AggregatedSchedule } from "./aggregated-schedules";
import {
  buildScheduleRunEntries,
  countScheduleRunOutcomes,
  fetchScheduleRuns,
  filterScheduleRunEntries,
} from "./schedule-runs";

function makeSchedule(overrides: Partial<AggregatedSchedule> = {}): AggregatedSchedule {
  return {
    id: "schedule-1",
    name: "Nightly",
    prompt: "Run the task",
    cadence: { type: "every", everyMs: 60_000 },
    target: { type: "new-agent", config: { provider: "codex", cwd: "/tmp/project" } },
    status: "active",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    nextRunAt: null,
    lastRunAt: null,
    pausedAt: null,
    expiresAt: null,
    maxRuns: null,
    serverId: "host-a",
    serverName: "Host A",
    ...overrides,
  };
}

function makeRun(overrides: Partial<ScheduleRun> = {}): ScheduleRun {
  return {
    id: "run-1",
    scheduledFor: "2026-07-02T00:00:00.000Z",
    startedAt: "2026-07-02T00:00:00.000Z",
    endedAt: "2026-07-02T00:05:00.000Z",
    status: "succeeded",
    agentId: null,
    output: null,
    error: null,
    ...overrides,
  };
}

describe("buildScheduleRunEntries", () => {
  it("flattens runs across automations newest first and numbers them per automation", () => {
    const nightly = makeSchedule();
    const weekly = makeSchedule({ id: "schedule-2", name: "Weekly" });
    const entries = buildScheduleRunEntries(
      [nightly, weekly],
      new Map([
        [
          "host-a:schedule-1",
          [
            makeRun({ id: "b", startedAt: "2026-07-03T00:00:00.000Z" }),
            makeRun({ id: "a", startedAt: "2026-07-01T00:00:00.000Z" }),
          ],
        ],
        ["host-a:schedule-2", [makeRun({ id: "c", startedAt: "2026-07-02T00:00:00.000Z" })]],
      ]),
    );

    expect(entries.map((entry) => [entry.title, entry.run.id, entry.runNumber])).toEqual([
      ["Nightly", "b", 2],
      ["Weekly", "c", 1],
      ["Nightly", "a", 1],
    ]);
  });
});

describe("filterScheduleRunEntries", () => {
  const entries = buildScheduleRunEntries(
    [makeSchedule(), makeSchedule({ id: "schedule-2", name: "Weekly" })],
    new Map([
      [
        "host-a:schedule-1",
        [
          makeRun({ status: "failed", error: "Provider Timeout" }),
          makeRun({ id: "run-3", startedAt: "2026-07-03T00:00:00.000Z", status: "running" }),
        ],
      ],
      ["host-a:schedule-2", [makeRun({ id: "run-2" })]],
    ]),
  );
  const ids = (result: typeof entries) => result.map((entry) => entry.run.id);

  it("matches the automation title and the run error, case-insensitively", () => {
    expect(ids(filterScheduleRunEntries(entries, { query: "weekly" }))).toEqual(["run-2"]);
    expect(ids(filterScheduleRunEntries(entries, { query: " timeout " }))).toEqual(["run-1"]);
    expect(filterScheduleRunEntries(entries, { query: "" })).toHaveLength(3);
  });

  it("narrows by run status and by automation", () => {
    expect(ids(filterScheduleRunEntries(entries, { status: "running" }))).toEqual(["run-3"]);
    expect(ids(filterScheduleRunEntries(entries, { scheduleKey: "host-a:schedule-1" }))).toEqual([
      "run-3",
      "run-1",
    ]);
    expect(
      ids(
        filterScheduleRunEntries(entries, {
          scheduleKey: "host-a:schedule-1",
          status: "succeeded",
        }),
      ),
    ).toEqual([]);
  });
});

describe("countScheduleRunOutcomes", () => {
  it("counts succeeded and failed runs inside the 24h and 7d windows", () => {
    const now = Date.parse("2026-07-10T12:00:00.000Z");
    const entries = buildScheduleRunEntries(
      [makeSchedule()],
      new Map([
        [
          "host-a:schedule-1",
          [
            makeRun({ id: "1", startedAt: "2026-07-10T11:00:00.000Z", status: "succeeded" }),
            makeRun({ id: "2", startedAt: "2026-07-10T10:00:00.000Z", status: "failed" }),
            makeRun({ id: "3", startedAt: "2026-07-10T09:00:00.000Z", status: "running" }),
            makeRun({ id: "4", startedAt: "2026-07-06T00:00:00.000Z", status: "succeeded" }),
            makeRun({ id: "5", startedAt: "2026-07-01T00:00:00.000Z", status: "failed" }),
            makeRun({ id: "6", startedAt: "2026-07-11T00:00:00.000Z", status: "succeeded" }),
          ],
        ],
      ]),
    );

    expect(countScheduleRunOutcomes(entries, now)).toEqual({
      succeeded24h: 1,
      failed24h: 1,
      succeeded7d: 2,
      failed7d: 1,
    });
  });
});

describe("fetchScheduleRuns", () => {
  it("keeps the runs that loaded and reports the automations that failed", async () => {
    const ok = makeSchedule();
    const broken = makeSchedule({ id: "schedule-2", name: "Broken" });
    const result = await fetchScheduleRuns({
      schedules: [ok, broken],
      client: {
        scheduleLogs: async ({ id }) =>
          id === ok.id
            ? { requestId: "r", runs: [makeRun()], error: null }
            : { requestId: "r", runs: [], error: "Schedule not found" },
      },
    });

    expect(result.entries.map((entry) => entry.title)).toEqual(["Nightly"]);
    expect(result.failures).toEqual([{ schedule: broken, message: "Schedule not found" }]);
  });
});
