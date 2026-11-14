import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  RADAR_LOOK_BACK_MS,
  RADAR_POLL_INTERVAL_MS,
  type StoredRadar,
} from "@gravity/protocol/radar/types";
import type { RadarTriageResult } from "./prompts.js";
import {
  RadarService,
  type RadarPullRequestState,
  type RadarTaskRunInput,
  type RadarTriageInput,
} from "./service.js";

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const START = new Date("2026-11-13T10:00:00.000Z");
// Slack ts for points before and after START.
const tsAfter = (seconds: number) => `${1794564000 + seconds}.000000`;
// Where a new radar starts reading: 24 hours before it was created.
const LOOK_BACK_TS = tsAfter(-86_400);

type TriageMessage = RadarTriageResult["messages"][number];

function message(overrides: Partial<TriageMessage> & { ts: string }): TriageMessage {
  return {
    threadTs: null,
    author: "Sentry",
    isBot: true,
    kind: "error",
    handled: false,
    actionable: true,
    reason: "New exception in production",
    summary: "TypeError in checkout",
    text: "TypeError: cannot read properties of undefined (reading 'total')",
    permalink: null,
    ...overrides,
  };
}

function triageResult(overrides: Partial<RadarTriageResult> = {}): RadarTriageResult {
  return {
    reachable: true,
    error: null,
    channelId: "C0ALERTS",
    messages: [],
    followUps: [],
    ...overrides,
  };
}

describe("RadarService", () => {
  let home: string;
  let projectDir: string;
  let now: Date;
  let triageResults: RadarTriageResult[];
  let triageInputs: RadarTriageInput[];
  let runInputs: RadarTaskRunInput[];
  let finalTexts: string[];
  let pullRequestStates: Map<string, RadarPullRequestState>;
  let service: RadarService;

  function createService(): RadarService {
    return new RadarService({
      gravityHome: home,
      logger: pino({ level: "silent" }),
      now: () => now,
      triage: async (input) => {
        triageInputs.push(input);
        const next = triageResults.shift();
        if (!next) {
          throw new Error("unexpected triage call");
        }
        return next;
      },
      runTask: async (input) => {
        runInputs.push(input);
        await input.onAgent({ agentId: AGENT_ID, workspaceId: "ws-radar" });
        const finalText = finalTexts.shift();
        if (finalText === undefined) {
          throw new Error("agent crashed");
        }
        return { agentId: AGENT_ID, workspaceId: "ws-radar", finalText };
      },
      getPullRequestState: async ({ url }) => pullRequestStates.get(url) ?? "unknown",
    });
  }

  async function createRadar(): Promise<StoredRadar> {
    return service.create({ channel: "#alerts", cwd: projectDir });
  }

  async function onlyRadar(): Promise<StoredRadar> {
    const radars = await service.list();
    expect(radars).toHaveLength(1);
    return radars[0];
  }

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "radar-service-home-"));
    projectDir = await mkdtemp(join(tmpdir(), "radar-service-project-"));
    now = START;
    triageResults = [];
    triageInputs = [];
    runInputs = [];
    finalTexts = [];
    pullRequestStates = new Map();
    service = createService();
  });

  afterEach(async () => {
    await service.stop();
    await rm(home, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  });

  test("a new radar starts 24 hours back, defaults to Claude, and is due for its first check", async () => {
    const radar = await createRadar();

    expect(radar).toMatchObject({
      channel: "alerts",
      channelId: null,
      provider: "claude",
      status: "active",
      cursorTs: LOOK_BACK_TS,
      nextPollAt: START.toISOString(),
      tasks: [],
    });
  });

  test("rejects a project directory that does not exist", async () => {
    await expect(
      service.create({ channel: "alerts", cwd: join(projectDir, "missing") }),
    ).rejects.toThrow("does not exist");
  });

  test("a check turns an actionable bot message into one queued task and advances the cursor", async () => {
    const radar = await createRadar();
    triageResults.push(
      triageResult({
        messages: [
          message({ ts: tsAfter(10) }),
          message({ ts: tsAfter(20), actionable: false, summary: "Deploy finished" }),
        ],
      }),
    );

    await service.check(radar.id);

    const checked = await onlyRadar();
    expect(triageInputs[0]).toMatchObject({ cwd: projectDir, provider: "claude" });
    expect(triageInputs[0].prompt).toContain(`ts greater than ${LOOK_BACK_TS}`);
    expect(checked.channelId).toBe("C0ALERTS");
    expect(checked.cursorTs).toBe(tsAfter(20));
    expect(checked.lastPollError).toBeNull();
    expect(checked.nextPollAt).toBe(
      new Date(START.getTime() + RADAR_POLL_INTERVAL_MS).toISOString(),
    );
    expect(checked.tasks).toHaveLength(1);
    expect(checked.tasks[0]).toMatchObject({
      kind: "error",
      status: "queued",
      step: "start",
      messageTs: tsAfter(10),
      threadTs: tsAfter(10),
    });
  });

  test("ignores human messages unless they hand over a Linear issue", async () => {
    const radar = await createRadar();
    triageResults.push(
      triageResult({
        messages: [
          message({ ts: tsAfter(10), isBot: false, author: "Dana", summary: "Prod looks down?" }),
          message({
            ts: tsAfter(20),
            isBot: false,
            author: "Dana",
            kind: "linear",
            summary: "ENG-42 Fix checkout total",
          }),
        ],
      }),
    );

    await service.check(radar.id);

    const checked = await onlyRadar();
    expect(checked.tasks.map((task) => task.summary)).toEqual(["ENG-42 Fix checkout total"]);
  });

  test("does not create a second task for a message it already tracks", async () => {
    const radar = await createRadar();
    triageResults.push(triageResult({ messages: [message({ ts: tsAfter(10) })] }));
    await service.check(radar.id);
    // A sloppy triage run reports the old message again along with a reply in its thread.
    triageResults.push(
      triageResult({
        messages: [
          message({ ts: tsAfter(10) }),
          message({ ts: tsAfter(30), threadTs: tsAfter(10) }),
        ],
      }),
    );

    await service.check(radar.id);

    expect((await onlyRadar()).tasks).toHaveLength(1);
  });

  test("messages past the per-check cap wait for the next check", async () => {
    const radar = await createRadar();
    const storm = [1, 2, 3, 4, 5].map((index) =>
      message({ ts: tsAfter(index), summary: `Error ${index}` }),
    );
    triageResults.push(triageResult({ messages: storm }));

    await service.check(radar.id);

    let checked = await onlyRadar();
    expect(checked.tasks.map((task) => task.summary)).toEqual(["Error 1", "Error 2", "Error 3"]);
    // The cursor stops before the first message that had to wait.
    expect(checked.cursorTs).toBe(tsAfter(3));

    triageResults.push(triageResult({ messages: storm.slice(3) }));
    await service.check(radar.id);

    checked = await onlyRadar();
    expect(checked.tasks.map((task) => task.summary)).toEqual([
      "Error 1",
      "Error 2",
      "Error 3",
      "Error 4",
      "Error 5",
    ]);
    expect(checked.cursorTs).toBe(tsAfter(5));
  });

  test("no new task is queued while six are already waiting", async () => {
    const radar = await createRadar();
    triageResults.push(
      triageResult({ messages: [1, 2, 3].map((index) => message({ ts: tsAfter(index) })) }),
      triageResult({ messages: [4, 5, 6].map((index) => message({ ts: tsAfter(index) })) }),
      triageResult({ messages: [message({ ts: tsAfter(7), summary: "Seventh" })] }),
    );
    await service.check(radar.id);
    await service.check(radar.id);

    await service.check(radar.id);

    const checked = await onlyRadar();
    expect(checked.tasks).toHaveLength(6);
    expect(checked.cursorTs).toBe(tsAfter(6));
    expect((await service.listChecks(radar.id))[0].messages[0]).toMatchObject({
      summary: "Seventh",
      decision: "over_limit",
    });
  });

  test("a message already answered or marked done in Slack is left alone", async () => {
    const radar = await createRadar();
    triageResults.push(
      triageResult({
        messages: [
          message({
            ts: tsAfter(-3600),
            handled: true,
            reason: "Has a white_check_mark reaction",
            summary: "Old error",
          }),
          message({ ts: tsAfter(-1800), summary: "Unanswered error" }),
        ],
      }),
    );

    await service.check(radar.id);

    const checked = await onlyRadar();
    expect(checked.tasks.map((task) => task.summary)).toEqual(["Unanswered error"]);
    expect(
      (await service.listChecks(radar.id))[0].messages.map((entry) => [
        entry.decision,
        entry.reason,
      ]),
    ).toEqual([
      ["handled", "Has a white_check_mark reaction"],
      ["task", "New exception in production"],
    ]);
  });

  test("an unreachable Slack is reported and the cursor stays put", async () => {
    const radar = await createRadar();
    triageResults.push(
      triageResult({ reachable: false, error: "No Slack tools are connected", channelId: null }),
    );

    await service.check(radar.id);

    const checked = await onlyRadar();
    expect(checked.lastPollError).toBe("No Slack tools are connected");
    expect(checked.cursorTs).toBe(LOOK_BACK_TS);
    expect(checked.lastPollAt).toBe(START.toISOString());
  });

  test("a failed triage run is recorded and the next check is still scheduled", async () => {
    const radar = await createRadar();

    await service.check(radar.id);

    const checked = await onlyRadar();
    expect(checked.lastPollError).toBe("unexpected triage call");
    expect(checked.nextPollAt).toBe(
      new Date(START.getTime() + RADAR_POLL_INTERVAL_MS).toISOString(),
    );
  });

  test("a task that opens a pull request waits for the merge, then gets its ✅ turn", async () => {
    const radar = await createRadar();
    const prUrl = "https://github.com/acme/shop/pull/7";
    triageResults.push(triageResult({ messages: [message({ ts: tsAfter(10) })] }));
    await service.check(radar.id);

    finalTexts.push(`Fixed the null total.\nRADAR: pr ${prUrl}`);
    await service.runNextTask(radar.id);

    let task = (await onlyRadar()).tasks[0];
    expect(runInputs[0].prompt).toContain("at most 160 characters");
    expect(runInputs[0].prompt).toContain(`thread under ts ${tsAfter(10)}`);
    expect(task).toMatchObject({
      status: "pr_open",
      prUrl,
      agentId: AGENT_ID,
      workspaceId: "ws-radar",
      step: null,
    });

    // Still open: the next check leaves it alone.
    pullRequestStates.set(prUrl, "open");
    triageResults.push(triageResult());
    await service.check(radar.id);
    expect((await onlyRadar()).tasks[0].status).toBe("pr_open");

    pullRequestStates.set(prUrl, "merged");
    triageResults.push(triageResult());
    await service.check(radar.id);
    task = (await onlyRadar()).tasks[0];
    expect(task).toMatchObject({ status: "queued", step: "merged" });

    finalTexts.push("RADAR: done");
    await service.runNextTask(radar.id);

    task = (await onlyRadar()).tasks[0];
    expect(runInputs[1].task.agentId).toBe(AGENT_ID);
    expect(runInputs[1].prompt).toContain("white_check_mark");
    expect(runInputs[1].prompt).toContain("Do not post a message");
    expect(task).toMatchObject({ status: "done", prUrl, step: null });
  });

  test("a pull request closed without merging ends the task without a ✅ turn", async () => {
    const radar = await createRadar();
    const prUrl = "https://github.com/acme/shop/pull/8";
    triageResults.push(triageResult({ messages: [message({ ts: tsAfter(10) })] }));
    await service.check(radar.id);
    finalTexts.push(`RADAR: pr ${prUrl}`);
    await service.runNextTask(radar.id);

    pullRequestStates.set(prUrl, "closed");
    triageResults.push(triageResult());
    await service.check(radar.id);
    await service.runNextTask(radar.id);

    expect((await onlyRadar()).tasks[0]).toMatchObject({ status: "done", step: null });
    expect(runInputs).toHaveLength(1);
  });

  test("a skipped task records the agent's reason", async () => {
    const radar = await createRadar();
    triageResults.push(triageResult({ messages: [message({ ts: tsAfter(10) })] }));
    await service.check(radar.id);

    finalTexts.push("RADAR: skipped already resolved in thread");
    await service.runNextTask(radar.id);

    expect((await onlyRadar()).tasks[0]).toMatchObject({
      status: "skipped",
      error: "already resolved in thread",
    });
  });

  test("a crashed agent fails the task and keeps the conversation link", async () => {
    const radar = await createRadar();
    triageResults.push(triageResult({ messages: [message({ ts: tsAfter(10) })] }));
    await service.check(radar.id);

    await service.runNextTask(radar.id);

    expect((await onlyRadar()).tasks[0]).toMatchObject({
      status: "failed",
      error: "agent crashed",
      agentId: AGENT_ID,
    });
  });

  test("a question in a handled thread goes back to the same conversation once", async () => {
    const radar = await createRadar();
    triageResults.push(triageResult({ messages: [message({ ts: tsAfter(10) })] }));
    await service.check(radar.id);
    finalTexts.push("RADAR: done");
    await service.runNextTask(radar.id);

    const followUp = {
      threadTs: tsAfter(10),
      ts: tsAfter(60),
      author: "Dana",
      text: "Can you explain why this started today?",
    };
    triageResults.push(triageResult({ followUps: [followUp] }));
    await service.check(radar.id);

    expect(triageInputs[1].prompt).toContain(`thread_ts ${tsAfter(10)}`);
    expect((await onlyRadar()).tasks[0]).toMatchObject({ status: "queued", step: "follow_up" });

    finalTexts.push("RADAR: done");
    await service.runNextTask(radar.id);

    expect(runInputs[1].task.agentId).toBe(AGENT_ID);
    expect(runInputs[1].prompt).toContain("Can you explain why this started today?");
    expect((await onlyRadar()).tasks[0]).toMatchObject({ status: "done", followUp: null });

    // The same reply reported again is not a new follow-up.
    triageResults.push(triageResult({ followUps: [followUp] }));
    await service.check(radar.id);
    expect((await onlyRadar()).tasks[0].status).toBe("done");
  });

  test("runs one task at a time, oldest first", async () => {
    const radar = await createRadar();
    triageResults.push(
      triageResult({
        messages: [
          message({ ts: tsAfter(10), summary: "First" }),
          message({ ts: tsAfter(20), summary: "Second" }),
        ],
      }),
    );
    await service.check(radar.id);

    finalTexts.push("RADAR: done");
    await service.runNextTask(radar.id);

    const tasks = (await onlyRadar()).tasks;
    expect(runInputs.map((input) => input.task.summary)).toEqual(["First"]);
    expect(tasks.map((task) => task.status)).toEqual(["done", "queued"]);
  });

  test("tick checks due radars and starts queued tasks, and skips paused ones", async () => {
    const radar = await createRadar();
    triageResults.push(triageResult({ messages: [message({ ts: tsAfter(10) })] }));

    await service.tick();
    await service.idle();
    expect((await onlyRadar()).tasks[0].status).toBe("queued");

    finalTexts.push("RADAR: done");
    await service.tick();
    await service.idle();
    expect((await onlyRadar()).tasks[0].status).toBe("done");

    await service.setStatus(radar.id, "paused");
    now = new Date(START.getTime() + RADAR_POLL_INTERVAL_MS * 2);
    await service.tick();
    await service.idle();
    expect(triageInputs).toHaveLength(1);
  });

  test("resuming picks up where it left off, at most 24 hours back", async () => {
    const radar = await createRadar();
    triageResults.push(triageResult({ messages: [message({ ts: tsAfter(10) })] }));
    await service.check(radar.id);
    await service.setStatus(radar.id, "paused");
    expect((await onlyRadar()).nextPollAt).toBeNull();

    now = new Date(START.getTime() + 3_600_000);
    const afterAnHour = await service.setStatus(radar.id, "active");
    expect(afterAnHour.cursorTs).toBe(tsAfter(10));
    expect(afterAnHour.nextPollAt).toBe(now.toISOString());

    await service.setStatus(radar.id, "paused");
    now = new Date(START.getTime() + 3 * 86_400_000);
    const afterThreeDays = await service.setStatus(radar.id, "active");
    expect(afterThreeDays.cursorTs).toBe(tsAfter(2 * 86_400));
  });

  test("changing the channel resets the resolved id and the cursor", async () => {
    const radar = await createRadar();
    triageResults.push(triageResult());
    await service.check(radar.id);

    now = new Date(START.getTime() + 60_000);
    const updated = await service.update({
      id: radar.id,
      channel: "https://acme.slack.com/archives/C0TICKETS",
      instructions: "Ignore deploy notices",
    });

    expect(updated).toMatchObject({
      channel: "C0TICKETS",
      channelId: null,
      cursorTs: tsAfter(60 - 86_400),
      instructions: "Ignore deploy notices",
    });
  });

  test("the check history says what happened to every new message and why", async () => {
    const radar = await createRadar();
    triageResults.push(triageResult({ messages: [message({ ts: tsAfter(5), summary: "Known" })] }));
    await service.check(radar.id);
    triageResults.push(
      triageResult({
        messages: [
          message({ ts: tsAfter(6), threadTs: tsAfter(5), summary: "Known again" }),
          message({
            ts: tsAfter(10),
            actionable: false,
            reason: "Deploy succeeded, nothing to fix",
            summary: "Deploy finished",
          }),
          message({ ts: tsAfter(20), isBot: false, author: "Dana", summary: "Is prod down?" }),
          message({ ts: tsAfter(30), summary: "Error A" }),
          message({ ts: tsAfter(40), summary: "Error B" }),
          message({ ts: tsAfter(50), summary: "Error C" }),
          message({ ts: tsAfter(60), summary: "Error D" }),
          message({ ts: tsAfter(70), summary: "Error E" }),
        ],
      }),
    );
    now = new Date(START.getTime() + 90_000);

    await service.check(radar.id);

    const [latest, first] = await service.listChecks(radar.id);
    const tasks = (await onlyRadar()).tasks;
    expect(first.messages.map((entry) => entry.decision)).toEqual(["task"]);
    expect(latest).toMatchObject({
      status: "ok",
      error: null,
      sinceTs: tsAfter(5),
      followUps: 0,
      merged: 0,
      startedAt: now.toISOString(),
    });
    expect(
      latest.messages.map((entry) => [entry.summary, entry.decision, entry.reason, entry.taskId]),
    ).toEqual([
      ["Known again", "tracked", "New exception in production", tasks[0].id],
      ["Deploy finished", "not_actionable", "Deploy succeeded, nothing to fix", null],
      ["Is prod down?", "human", "New exception in production", null],
      ["Error A", "task", "New exception in production", tasks[1].id],
      ["Error B", "task", "New exception in production", tasks[2].id],
      ["Error C", "task", "New exception in production", tasks[3].id],
      ["Error D", "over_limit", "New exception in production", null],
      ["Error E", "over_limit", "New exception in production", null],
    ]);
  });

  test("unreachable and failed checks are kept in the history with their error", async () => {
    const radar = await createRadar();
    triageResults.push(
      triageResult({ reachable: false, error: "No Slack tools are connected", channelId: null }),
    );
    await service.check(radar.id);
    await service.check(radar.id);

    const checks = await service.listChecks(radar.id);

    expect(checks.map((check) => [check.status, check.error])).toEqual([
      ["failed", "unexpected triage call"],
      ["unreachable", "No Slack tools are connected"],
    ]);
    expect(await service.listChecks(radar.id, 1)).toHaveLength(1);
  });

  test("a look-back check picks up a message from before the radar existed, once", async () => {
    const radar = await createRadar();
    triageResults.push(triageResult());
    await service.check(radar.id);
    const linearMessage = message({
      ts: tsAfter(-6000),
      isBot: false,
      author: "Michelle",
      kind: "linear",
      summary: "ENG-42 List the Persona KYB case number",
    });

    triageResults.push(triageResult({ messages: [linearMessage] }));
    await service.checkNow(radar.id, { lookBackMs: RADAR_LOOK_BACK_MS });
    await service.idle();

    expect(triageInputs[1].prompt).toContain(`ts greater than ${LOOK_BACK_TS}`);
    expect((await onlyRadar()).tasks.map((task) => task.summary)).toEqual([
      "ENG-42 List the Persona KYB case number",
    ]);

    // Looking back again sees the same message and leaves it alone.
    triageResults.push(triageResult({ messages: [linearMessage] }));
    await service.checkNow(radar.id, { lookBackMs: RADAR_LOOK_BACK_MS });
    await service.idle();

    expect((await onlyRadar()).tasks).toHaveLength(1);
    expect((await service.listChecks(radar.id))[0].messages[0].decision).toBe("tracked");
  });

  test("deleting a radar deletes its check history", async () => {
    const radar = await createRadar();
    triageResults.push(triageResult());
    await service.check(radar.id);
    expect(await service.listChecks(radar.id)).toHaveLength(1);

    await service.delete(radar.id);

    await expect(service.listChecks(radar.id)).rejects.toThrow("Radar not found");
  });

  test("a task left running by a daemon restart is failed on start", async () => {
    const radar = await createRadar();
    triageResults.push(triageResult({ messages: [message({ ts: tsAfter(10) })] }));
    await service.check(radar.id);
    let release: () => void = () => {};
    const blocked = new RadarService({
      gravityHome: home,
      logger: pino({ level: "silent" }),
      now: () => now,
      triage: async () => triageResult(),
      runTask: (input) =>
        new Promise((resolve) => {
          release = () =>
            resolve({ agentId: AGENT_ID, workspaceId: null, finalText: "RADAR: done" });
          void input;
        }),
      getPullRequestState: async () => "unknown",
    });
    const running = blocked.runNextTask(radar.id);
    await expect.poll(async () => (await onlyRadar()).tasks[0].status).toBe("running");

    const restarted = createService();
    await restarted.start();
    await restarted.stop();

    expect((await onlyRadar()).tasks[0]).toMatchObject({
      status: "failed",
      error: "Daemon restarted before the task finished",
    });
    release();
    await running;
  });
});
