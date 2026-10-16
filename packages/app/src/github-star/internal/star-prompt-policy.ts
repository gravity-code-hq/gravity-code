/**
 * When to ask for a GitHub star. The ask waits until the user has created a
 * meaningful number of agents from this app, doubles that bar every time they
 * put it off, and stays quiet for a cooldown in between. Starring, or finding
 * the host already starred, ends it for good.
 */
export const STAR_PROMPT_INITIAL_THRESHOLD = 35;
export const STAR_PROMPT_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

export interface StarPromptSchedule {
  agentsCreated: number;
  /** App version the countdown below was started for. */
  appVersion: string | null;
  baselineAgents: number | null;
  nextThreshold: number;
  deferredUntil: number | null;
  completed: boolean;
}

export const INITIAL_STAR_PROMPT_SCHEDULE: StarPromptSchedule = {
  agentsCreated: 0,
  appVersion: null,
  baselineAgents: null,
  nextThreshold: STAR_PROMPT_INITIAL_THRESHOLD,
  deferredUntil: null,
  completed: false,
};

/**
 * After an update, users who have not starred get a fresh countdown from their
 * current agent total instead of an immediate ask.
 */
export function syncStarPromptVersion(
  schedule: StarPromptSchedule,
  appVersion: string | null,
): StarPromptSchedule {
  if (schedule.appVersion === appVersion && schedule.baselineAgents !== null) {
    return schedule;
  }
  return {
    ...schedule,
    appVersion,
    baselineAgents: schedule.agentsCreated,
    nextThreshold: STAR_PROMPT_INITIAL_THRESHOLD,
  };
}

export function isStarPromptDue(schedule: StarPromptSchedule, now: number): boolean {
  if (schedule.completed || schedule.baselineAgents === null) {
    return false;
  }
  if (schedule.deferredUntil !== null && schedule.deferredUntil > now) {
    return false;
  }
  return schedule.agentsCreated - schedule.baselineAgents >= schedule.nextThreshold;
}

export function recordStarPromptAgentCreated(schedule: StarPromptSchedule): StarPromptSchedule {
  return { ...schedule, agentsCreated: schedule.agentsCreated + 1 };
}

/**
 * Later, close, and opening GitHub in a browser all put the ask off. Opening
 * GitHub is only a handoff, so it does not count as a star.
 */
export function deferStarPrompt(schedule: StarPromptSchedule, now: number): StarPromptSchedule {
  return {
    ...schedule,
    baselineAgents: schedule.agentsCreated,
    nextThreshold: schedule.nextThreshold * 2,
    deferredUntil: now + STAR_PROMPT_COOLDOWN_MS,
  };
}

export function completeStarPrompt(schedule: StarPromptSchedule): StarPromptSchedule {
  return { ...schedule, completed: true, deferredUntil: null };
}
