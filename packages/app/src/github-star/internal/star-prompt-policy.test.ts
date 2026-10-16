import { describe, expect, it } from "vitest";
import {
  completeStarPrompt,
  deferStarPrompt,
  INITIAL_STAR_PROMPT_SCHEDULE,
  isStarPromptDue,
  recordStarPromptAgentCreated,
  STAR_PROMPT_COOLDOWN_MS,
  STAR_PROMPT_INITIAL_THRESHOLD,
  syncStarPromptVersion,
  type StarPromptSchedule,
} from "./star-prompt-policy";

const NOW = 1_000_000;

function createAgents(schedule: StarPromptSchedule, count: number): StarPromptSchedule {
  let next = schedule;
  for (let index = 0; index < count; index += 1) {
    next = recordStarPromptAgentCreated(next);
  }
  return next;
}

describe("star prompt policy", () => {
  it("is due once the user creates the threshold number of agents", () => {
    const synced = syncStarPromptVersion(INITIAL_STAR_PROMPT_SCHEDULE, "1.0.0");

    expect(isStarPromptDue(createAgents(synced, STAR_PROMPT_INITIAL_THRESHOLD - 1), NOW)).toBe(
      false,
    );
    expect(isStarPromptDue(createAgents(synced, STAR_PROMPT_INITIAL_THRESHOLD), NOW)).toBe(true);
  });

  it("is never due before a version has been synced", () => {
    const unsynced = createAgents(INITIAL_STAR_PROMPT_SCHEDULE, STAR_PROMPT_INITIAL_THRESHOLD);

    expect(isStarPromptDue(unsynced, NOW)).toBe(false);
  });

  it("starts a fresh countdown from the current total after an update", () => {
    const due = createAgents(
      syncStarPromptVersion(INITIAL_STAR_PROMPT_SCHEDULE, "1.0.0"),
      STAR_PROMPT_INITIAL_THRESHOLD,
    );
    const updated = syncStarPromptVersion(due, "1.1.0");

    expect(updated.baselineAgents).toBe(STAR_PROMPT_INITIAL_THRESHOLD);
    expect(isStarPromptDue(updated, NOW)).toBe(false);
    expect(syncStarPromptVersion(updated, "1.1.0")).toBe(updated);
  });

  it("doubles the threshold and waits out the cooldown after a deferral", () => {
    const due = createAgents(
      syncStarPromptVersion(INITIAL_STAR_PROMPT_SCHEDULE, "1.0.0"),
      STAR_PROMPT_INITIAL_THRESHOLD,
    );
    const deferred = deferStarPrompt(due, NOW);
    const nextThreshold = STAR_PROMPT_INITIAL_THRESHOLD * 2;

    expect(deferred.nextThreshold).toBe(nextThreshold);
    expect(isStarPromptDue(createAgents(deferred, nextThreshold), NOW)).toBe(false);
    expect(
      isStarPromptDue(createAgents(deferred, nextThreshold), NOW + STAR_PROMPT_COOLDOWN_MS + 1),
    ).toBe(true);
    expect(
      isStarPromptDue(createAgents(deferred, nextThreshold - 1), NOW + STAR_PROMPT_COOLDOWN_MS + 1),
    ).toBe(false);
  });

  it("is never due again once completed, even across updates", () => {
    const due = createAgents(
      syncStarPromptVersion(INITIAL_STAR_PROMPT_SCHEDULE, "1.0.0"),
      STAR_PROMPT_INITIAL_THRESHOLD,
    );
    const completed = completeStarPrompt(due);
    const updated = createAgents(syncStarPromptVersion(completed, "2.0.0"), 1_000);

    expect(isStarPromptDue(completed, NOW)).toBe(false);
    expect(isStarPromptDue(updated, NOW)).toBe(false);
  });
});
