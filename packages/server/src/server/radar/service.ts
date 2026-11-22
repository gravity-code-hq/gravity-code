import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "pino";
import {
  RADAR_DEFAULT_PROVIDER,
  RADAR_LOOK_BACK_MS,
  RADAR_POLL_INTERVAL_MS,
  normalizeRadarChannel,
  type CreateRadarInput,
  type RadarCheck,
  type RadarCheckMessage,
  type RadarStatus,
  type RadarTask,
  type RadarTaskStep,
  type StoredRadar,
  type UpdateRadarInput,
} from "@gravity/protocol/radar/types";
import {
  buildFollowUpPrompt,
  buildMergedPrompt,
  buildTaskPrompt,
  buildTriagePrompt,
  compareSlackTs,
  parseRadarOutcome,
  slackTsFromDate,
  type RadarKnownThread,
  type RadarTriageResult,
} from "./prompts.js";
import { RadarCheckStore, RadarStore } from "./store.js";

const RADAR_TICK_INTERVAL_MS = 15_000;
// An alert storm should not turn into thirty agents at once. Messages past
// either cap wait: the cursor stops before them, so the next check reads them
// again once the queue has drained.
const MAX_NEW_TASKS_PER_CHECK = 3;
const MAX_QUEUED_TASKS = 6;
// Tasks of one radar run side by side, each in its own conversation. The
// checkout is shared, so the prompt keeps every code change in a git worktree.
export const RADAR_MAX_RUNNING_TASKS = 10;
const MAX_KNOWN_THREADS = 8;
const KNOWN_THREAD_WINDOW_MS = 48 * 60 * 60 * 1000;

export type RadarPullRequestState = "open" | "merged" | "closed" | "unknown";

export interface RadarTriageInput {
  cwd: string;
  provider: string;
  prompt: string;
}
export type RadarTriage = (input: RadarTriageInput) => Promise<RadarTriageResult>;

export interface RadarTaskAgentIds {
  agentId: string;
  workspaceId: string | null;
}

export interface RadarTaskRunInput {
  radar: StoredRadar;
  task: RadarTask;
  prompt: string;
  /** Called as soon as the conversation exists, so the app can link to a running task. */
  onAgent: (ids: RadarTaskAgentIds) => Promise<void>;
}

export interface RadarTaskRunResult extends RadarTaskAgentIds {
  finalText: string;
}
export type RadarTaskRunner = (input: RadarTaskRunInput) => Promise<RadarTaskRunResult>;

export interface RadarServiceOptions {
  gravityHome: string;
  logger: Logger;
  /** Reads Slack through a hidden agent run and classifies what is new. */
  triage: RadarTriage;
  /** Runs one task turn in its agent conversation, creating the conversation on the first turn. */
  runTask: RadarTaskRunner;
  getPullRequestState: (input: { url: string; cwd: string }) => Promise<RadarPullRequestState>;
  now?: () => Date;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Threads Radar already replied in, recent enough that a follow-up question is plausible. */
export function selectKnownThreads(radar: StoredRadar, now: Date): RadarKnownThread[] {
  const cutoff = now.getTime() - KNOWN_THREAD_WINDOW_MS;
  return radar.tasks
    .filter(
      (task) =>
        (task.status === "done" || task.status === "pr_open") &&
        task.agentId !== null &&
        new Date(task.updatedAt).getTime() >= cutoff,
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_KNOWN_THREADS)
    .map((task) => ({
      threadTs: task.threadTs,
      afterTs: task.threadCursorTs ?? task.messageTs,
      summary: task.summary,
    }));
}

export interface RadarTriageApplication {
  radar: StoredRadar;
  status: "ok" | "unreachable";
  error: string | null;
  /** What was decided about each message newer than the cursor. */
  messages: RadarCheckMessage[];
  /** Thread replies queued back to their task. */
  followUps: number;
}

/**
 * Folds one triage result into a radar: new tasks, follow-ups for known
 * threads, and the cursor. Pure so the rules are testable without Slack.
 */
export function applyTriageResult(
  radar: StoredRadar,
  result: RadarTriageResult,
  now: Date,
): RadarTriageApplication {
  const timestamp = now.toISOString();
  const checked = {
    ...radar,
    lastPollAt: timestamp,
    nextPollAt:
      radar.status === "active"
        ? new Date(now.getTime() + RADAR_POLL_INTERVAL_MS).toISOString()
        : null,
    updatedAt: timestamp,
  };
  if (!result.reachable) {
    // Leave the cursor alone: once Slack is reachable again the missed
    // messages are still new.
    const error = result.error?.trim() || "Slack is not reachable from this provider";
    return {
      radar: { ...checked, lastPollError: error },
      status: "unreachable",
      error,
      messages: [],
      followUps: 0,
    };
  }

  let cursorTs = radar.cursorTs;
  let tasks = [...radar.tasks];
  let added = 0;
  let deferred = false;
  const queued = tasks.filter((task) => task.status === "queued").length;
  const decisions: RadarCheckMessage[] = [];
  const messages = [...result.messages].sort((left, right) => compareSlackTs(left.ts, right.ts));
  for (const message of messages) {
    if (compareSlackTs(message.ts, radar.cursorTs) <= 0) {
      continue;
    }
    const threadTs = message.threadTs ?? message.ts;
    const existing = tasks.find(
      (task) => task.messageTs === message.ts || task.threadTs === threadTs,
    );
    const decide = (decision: string, taskId: string | null): void => {
      // A deferred message, and everything after it, stays ahead of the cursor.
      deferred ||= decision === "over_limit";
      if (!deferred && compareSlackTs(message.ts, cursorTs) > 0) {
        cursorTs = message.ts;
      }
      decisions.push({
        ts: message.ts,
        author: message.author,
        isBot: message.isBot,
        kind: message.kind,
        summary: message.summary.trim() || message.text.trim().slice(0, 100),
        permalink: message.permalink,
        decision,
        reason: message.reason.trim() || null,
        taskId,
      });
    };
    if (existing) {
      decide("tracked", existing.id);
      continue;
    }
    // Someone already answered it or marked it done in Slack.
    if (message.handled) {
      decide("handled", null);
      continue;
    }
    if (!message.actionable || message.kind === "other") {
      decide("not_actionable", null);
      continue;
    }
    // Bots only, except a message that hands Radar a Linear issue.
    if (!message.isBot && message.kind !== "linear") {
      decide("human", null);
      continue;
    }
    if (added >= MAX_NEW_TASKS_PER_CHECK || queued + added >= MAX_QUEUED_TASKS) {
      decide("over_limit", null);
      continue;
    }
    added += 1;
    const id = randomUUID();
    decide("task", id);
    tasks.push({
      id,
      kind: message.kind,
      summary: message.summary.trim() || message.text.trim().slice(0, 100),
      author: message.author,
      messageTs: message.ts,
      threadTs,
      text: message.text,
      permalink: message.permalink,
      status: "queued",
      step: "start",
      followUp: null,
      threadCursorTs: null,
      ...(radar.isolation ? { isolation: radar.isolation } : {}),
      agentId: null,
      workspaceId: null,
      prUrl: null,
      mergedAt: null,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  let followUps = 0;
  for (const followUp of result.followUps) {
    tasks = tasks.map((task) => {
      if (task.threadTs !== followUp.threadTs) {
        return task;
      }
      // A busy task keeps its thread cursor, so the reply is reported again on
      // the next check instead of being lost.
      if (task.status !== "done" && task.status !== "pr_open") {
        return task;
      }
      if (compareSlackTs(followUp.ts, task.threadCursorTs ?? task.messageTs) <= 0) {
        return task;
      }
      followUps += 1;
      return {
        ...task,
        status: "queued" as const,
        step: "follow_up" as const,
        followUp: { ts: followUp.ts, author: followUp.author, text: followUp.text },
        threadCursorTs: followUp.ts,
        updatedAt: timestamp,
      };
    });
  }

  return {
    radar: {
      ...checked,
      channelId: result.channelId ?? radar.channelId,
      cursorTs,
      lastPollError: null,
      tasks,
    },
    status: "ok",
    error: null,
    messages: decisions,
    followUps,
  };
}

function finishTask(task: RadarTask, result: RadarTaskRunResult, now: Date): RadarTask {
  const step = task.step ?? "start";
  const base: RadarTask = {
    ...task,
    agentId: result.agentId,
    workspaceId: result.workspaceId,
    step: null,
    followUp: null,
    error: null,
    updatedAt: now.toISOString(),
  };
  if (step === "merged") {
    return { ...base, status: "done" };
  }
  const outcome = parseRadarOutcome(result.finalText);
  if (outcome.type === "pr") {
    return { ...base, status: "pr_open", prUrl: outcome.url, mergedAt: null };
  }
  if (step === "follow_up") {
    // Answering a question does not change where the pull request stands.
    return { ...base, status: task.prUrl && !task.mergedAt ? "pr_open" : "done" };
  }
  if (outcome.type === "skipped") {
    return { ...base, status: "skipped", error: outcome.reason };
  }
  return { ...base, status: "done" };
}

function buildStepPrompt(radar: StoredRadar, task: RadarTask): string {
  if (task.step === "merged") {
    return buildMergedPrompt(radar, task);
  }
  if (task.step === "follow_up" && task.followUp) {
    return buildFollowUpPrompt(radar, task, task.followUp);
  }
  return buildTaskPrompt(radar, task);
}

export class RadarService {
  private readonly store: RadarStore;
  private readonly checkStore: RadarCheckStore;
  private readonly logger: Logger;
  private readonly triage: RadarTriage;
  private readonly runTask: RadarTaskRunner;
  private readonly getPullRequestState: RadarServiceOptions["getPullRequestState"];
  private readonly now: () => Date;
  private readonly checking = new Set<string>();
  private readonly recheck = new Set<string>();
  private readonly inFlight = new Set<Promise<void>>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: RadarServiceOptions) {
    this.store = new RadarStore(join(options.gravityHome, "radar"));
    this.checkStore = new RadarCheckStore(join(options.gravityHome, "radar", "checks"));
    this.logger = options.logger.child({ module: "radar-service" });
    this.triage = options.triage;
    this.runTask = options.runTask;
    this.getPullRequestState = options.getPullRequestState;
    this.now = options.now ?? (() => new Date());
  }

  async start(): Promise<void> {
    await this.recoverInterruptedTasks();
    if (this.tickTimer) {
      return;
    }
    const timer = setInterval(() => {
      void this.tick().catch((error) => {
        this.logger.error({ err: error }, "Failed to process radar tick");
      });
    }, RADAR_TICK_INTERVAL_MS);
    (timer as unknown as { unref?: () => void }).unref?.();
    this.tickTimer = timer;
  }

  async stop(): Promise<void> {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /** Resolves once every check and task started so far has settled. */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled(this.inFlight);
    }
  }

  async list(): Promise<StoredRadar[]> {
    return this.store.list();
  }

  async create(input: CreateRadarInput): Promise<StoredRadar> {
    const channel = normalizeRadarChannel(input.channel);
    if (!channel) {
      throw new Error("Slack channel is required");
    }
    const cwd = input.cwd.trim();
    await assertDirectory(cwd);
    const now = this.now();
    const timestamp = now.toISOString();
    const model = input.model?.trim();
    const instructions = input.instructions?.trim();
    return this.store.create({
      channel,
      channelId: null,
      cwd,
      provider: input.provider?.trim() || RADAR_DEFAULT_PROVIDER,
      ...(model ? { model } : {}),
      ...(input.isolation ? { isolation: input.isolation } : {}),
      ...(instructions ? { instructions } : {}),
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
      // A new radar starts with the last day of the channel. What is already
      // answered or marked done there is left alone by triage.
      cursorTs: lookBackTs(now),
      // The first check runs right away so a wrong channel or a missing Slack
      // connector shows up during setup instead of five minutes later.
      nextPollAt: timestamp,
      lastPollAt: null,
      lastPollError: null,
      tasks: [],
    });
  }

  async update(input: UpdateRadarInput): Promise<StoredRadar> {
    const cwd = input.cwd?.trim();
    if (cwd !== undefined) {
      await assertDirectory(cwd);
    }
    const updated = await this.store.update(input.id, (radar) => {
      const now = this.now();
      let next: StoredRadar = { ...radar, updatedAt: now.toISOString() };
      if (input.channel !== undefined) {
        const channel = normalizeRadarChannel(input.channel);
        if (!channel) {
          throw new Error("Slack channel is required");
        }
        if (channel !== radar.channel) {
          next = {
            ...next,
            channel,
            channelId: null,
            cursorTs: lookBackTs(now),
            lastPollError: null,
            nextPollAt: radar.status === "active" ? now.toISOString() : null,
          };
        }
      }
      if (cwd !== undefined) {
        next = { ...next, cwd };
      }
      if (input.model !== undefined) {
        const model = input.model?.trim();
        const { model: _previous, ...rest } = next;
        next = model ? { ...rest, model } : rest;
      }
      if (input.isolation !== undefined) {
        next = { ...next, isolation: input.isolation };
      }
      if (input.instructions !== undefined) {
        const instructions = input.instructions?.trim();
        const { instructions: _previous, ...rest } = next;
        next = instructions ? { ...rest, instructions } : rest;
      }
      return next;
    });
    return requireRadar(updated, input.id);
  }

  async setStatus(id: string, status: RadarStatus): Promise<StoredRadar> {
    const updated = await this.store.update(id, (radar) => {
      if (radar.status === status) {
        return radar;
      }
      const now = this.now();
      if (status === "paused") {
        return { ...radar, status, nextPollAt: null, updatedAt: now.toISOString() };
      }
      return {
        ...radar,
        status,
        // Resume where it left off, but never further back than a day.
        cursorTs:
          compareSlackTs(radar.cursorTs, lookBackTs(now)) > 0 ? radar.cursorTs : lookBackTs(now),
        nextPollAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
    });
    return requireRadar(updated, id);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
    await this.checkStore.delete(id);
  }

  /** A radar's check history, newest first. */
  async listChecks(id: string, limit?: number): Promise<RadarCheck[]> {
    requireRadar(await this.store.get(id), id);
    const checks = (await this.checkStore.list(id)).toReversed();
    return limit === undefined ? checks : checks.slice(0, limit);
  }

  /**
   * Queues a check and returns without waiting for it. `lookBackMs` first
   * rewinds the cursor, so messages from before the radar existed are read.
   */
  async checkNow(id: string, options?: { lookBackMs?: number }): Promise<StoredRadar> {
    const now = this.now();
    const lookBackMs = options?.lookBackMs;
    const updated = await this.store.update(id, (radar) => {
      if (radar.status !== "active") {
        throw new Error("Resume this radar before checking it");
      }
      if (!lookBackMs) {
        return radar;
      }
      const rewound = slackTsFromDate(new Date(now.getTime() - lookBackMs));
      if (compareSlackTs(rewound, radar.cursorTs) >= 0) {
        return radar;
      }
      return { ...radar, cursorTs: rewound, updatedAt: now.toISOString() };
    });
    const radar = requireRadar(updated, id);
    if (this.checking.has(id)) {
      // The check in flight read a different window; run again when it ends.
      this.recheck.add(id);
    } else {
      this.track(this.check(id));
    }
    return radar;
  }

  async tick(): Promise<void> {
    const now = this.now();
    const radars = await this.store.list();
    for (const radar of radars) {
      if (radar.status !== "active") {
        continue;
      }
      if (radar.nextPollAt && new Date(radar.nextPollAt).getTime() <= now.getTime()) {
        this.track(this.check(radar.id));
      }
      const queued = radar.tasks.filter((task) => task.status === "queued").length;
      const running = radar.tasks.filter((task) => task.status === "running").length;
      const starts = Math.min(queued, RADAR_MAX_RUNNING_TASKS - running);
      for (let index = 0; index < starts; index += 1) {
        this.track(this.runNextTask(radar.id));
      }
    }
  }

  /** One check: settle merged pull requests, then triage what is new in Slack. */
  async check(id: string): Promise<void> {
    if (this.checking.has(id)) {
      return;
    }
    this.checking.add(id);
    const startedAt = this.now().toISOString();
    let sinceTs = "";
    let merged = 0;
    try {
      const radar = await this.store.get(id);
      if (!radar || radar.status !== "active") {
        return;
      }
      sinceTs = radar.cursorTs;
      merged = await this.settlePullRequests(radar);
      const current = await this.store.get(id);
      if (!current || current.status !== "active") {
        return;
      }
      sinceTs = current.cursorTs;
      const result = await this.triage({
        cwd: current.cwd,
        provider: current.provider,
        prompt: buildTriagePrompt(current, selectKnownThreads(current, this.now())),
      });
      const outcome: { applied: RadarTriageApplication | null } = { applied: null };
      await this.store.update(id, (latest) => {
        // The channel or the cursor changed mid-check (an edit, a resume, a
        // look-back): this result describes a window that no longer applies.
        if (latest.channel !== current.channel || latest.cursorTs !== current.cursorTs) {
          return latest;
        }
        outcome.applied = applyTriageResult(latest, result, this.now());
        return outcome.applied.radar;
      });
      if (outcome.applied) {
        await this.recordCheck(id, {
          startedAt,
          status: outcome.applied.status,
          error: outcome.applied.error,
          sinceTs,
          messages: outcome.applied.messages,
          followUps: outcome.applied.followUps,
          merged,
        });
      }
    } catch (error) {
      this.logger.warn({ err: error, radarId: id }, "Radar check failed");
      const message = errorMessage(error);
      await this.recordCheckFailure(id, message);
      await this.recordCheck(id, {
        startedAt,
        status: "failed",
        error: message,
        sinceTs,
        messages: [],
        followUps: 0,
        merged,
      });
    } finally {
      this.checking.delete(id);
      if (this.recheck.delete(id)) {
        this.track(this.check(id));
      }
    }
  }

  /**
   * Runs the oldest queued task of a radar and resolves when that task ends.
   * Does nothing when the radar already has `RADAR_MAX_RUNNING_TASKS` running.
   */
  async runNextTask(id: string): Promise<void> {
    try {
      const claimed = await this.claimNextTask(id);
      if (!claimed) {
        return;
      }
      const { radar, task } = claimed;
      try {
        const result = await this.runTask({
          radar,
          task,
          prompt: buildStepPrompt(radar, task),
          onAgent: async (ids) => {
            await this.patchTask(id, task.id, (current) => ({ ...current, ...ids }));
          },
        });
        await this.patchTask(id, task.id, (current) => finishTask(current, result, this.now()));
      } catch (error) {
        this.logger.warn({ err: error, radarId: id, taskId: task.id }, "Radar task failed");
        await this.patchTask(id, task.id, (current) => ({
          ...current,
          status: "failed",
          step: null,
          followUp: null,
          error: errorMessage(error),
          updatedAt: this.now().toISOString(),
        }));
      }
    } catch (error) {
      this.logger.error({ err: error, radarId: id }, "Failed to run radar task");
    }
  }

  private track(work: Promise<void>): void {
    this.inFlight.add(work);
    void work.finally(() => {
      this.inFlight.delete(work);
    });
  }

  private async claimNextTask(id: string): Promise<{ radar: StoredRadar; task: RadarTask } | null> {
    let claimedId: string | null = null;
    const updated = await this.store.update(id, (radar) => {
      if (radar.status !== "active") {
        return radar;
      }
      // Store updates for one radar are serialized, so the stored statuses are
      // the count: two callers cannot both take the last free slot.
      const running = radar.tasks.filter((task) => task.status === "running").length;
      const next = radar.tasks.find((task) => task.status === "queued");
      if (!next || running >= RADAR_MAX_RUNNING_TASKS) {
        return radar;
      }
      claimedId = next.id;
      const timestamp = this.now().toISOString();
      return {
        ...radar,
        tasks: radar.tasks.map((task) =>
          task.id === next.id
            ? { ...task, status: "running" as const, updatedAt: timestamp }
            : task,
        ),
      };
    });
    const task = updated?.tasks.find((candidate) => candidate.id === claimedId);
    return updated && task ? { radar: updated, task } : null;
  }

  private async patchTask(
    id: string,
    taskId: string,
    patch: (task: RadarTask) => RadarTask,
  ): Promise<void> {
    await this.store.update(id, (radar) => ({
      ...radar,
      tasks: radar.tasks.map((task) => (task.id === taskId ? patch(task) : task)),
    }));
  }

  /** Returns how many pull requests were found merged. */
  private async settlePullRequests(radar: StoredRadar): Promise<number> {
    let merged = 0;
    const open = radar.tasks.filter((task) => task.status === "pr_open" && task.prUrl);
    for (const task of open) {
      const url = task.prUrl;
      if (!url) {
        continue;
      }
      let state: RadarPullRequestState = "unknown";
      try {
        state = await this.getPullRequestState({ url, cwd: radar.cwd });
      } catch (error) {
        this.logger.debug(
          { err: error, radarId: radar.id, url },
          "Radar pull request check failed",
        );
      }
      if (state !== "merged" && state !== "closed") {
        continue;
      }
      const timestamp = this.now().toISOString();
      await this.patchTask(radar.id, task.id, (current) => {
        if (current.status !== "pr_open") {
          return current;
        }
        if (state === "closed") {
          // Closed without merging: the work is over, and nothing earned a ✅.
          return { ...current, status: "done", updatedAt: timestamp };
        }
        merged += 1;
        const step: RadarTaskStep = "merged";
        return { ...current, status: "queued", step, mergedAt: timestamp, updatedAt: timestamp };
      });
    }
    return merged;
  }

  // History is for the user to read; failing to write it must not fail the check.
  private async recordCheck(id: string, check: Omit<RadarCheck, "id" | "endedAt">): Promise<void> {
    try {
      if (!(await this.store.get(id))) {
        return;
      }
      await this.checkStore.append(id, {
        ...check,
        id: randomUUID(),
        endedAt: this.now().toISOString(),
      });
    } catch (error) {
      this.logger.warn({ err: error, radarId: id }, "Failed to record radar check");
    }
  }

  private async recordCheckFailure(id: string, message: string): Promise<void> {
    await this.store
      .update(id, (radar) => {
        const now = this.now();
        return {
          ...radar,
          lastPollAt: now.toISOString(),
          lastPollError: message,
          nextPollAt:
            radar.status === "active"
              ? new Date(now.getTime() + RADAR_POLL_INTERVAL_MS).toISOString()
              : null,
          updatedAt: now.toISOString(),
        };
      })
      .catch((error) => {
        this.logger.error({ err: error, radarId: id }, "Failed to record radar check failure");
      });
  }

  // A task that was running when the daemon stopped may already have replied
  // in Slack. Re-running it risks a second reply, so it fails instead.
  private async recoverInterruptedTasks(): Promise<void> {
    const radars = await this.store.list();
    const timestamp = this.now().toISOString();
    await Promise.all(
      radars
        .filter((radar) => radar.tasks.some((task) => task.status === "running"))
        .map((radar) =>
          this.store.update(radar.id, (current) => ({
            ...current,
            tasks: current.tasks.map((task) =>
              task.status === "running"
                ? {
                    ...task,
                    status: "failed" as const,
                    step: null,
                    followUp: null,
                    error: "Daemon restarted before the task finished",
                    updatedAt: timestamp,
                  }
                : task,
            ),
          })),
        ),
    );
  }
}

function lookBackTs(now: Date): string {
  return slackTsFromDate(new Date(now.getTime() - RADAR_LOOK_BACK_MS));
}

function requireRadar(radar: StoredRadar | null, id: string): StoredRadar {
  if (!radar) {
    throw new Error(`Radar not found: ${id}`);
  }
  return radar;
}

async function assertDirectory(cwd: string): Promise<void> {
  if (!cwd) {
    throw new Error("Project directory is required");
  }
  let stats: Awaited<ReturnType<typeof stat>>;
  try {
    stats = await stat(cwd);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Project directory ${cwd} does not exist`, { cause: error });
    }
    throw error;
  }
  if (!stats.isDirectory()) {
    throw new Error(`Project directory ${cwd} is not a directory`);
  }
}
