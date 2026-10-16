/**
 * Default automations. The daemon seeds every one of these as a paused
 * schedule on first start (`ScheduleService.seedDefaultTemplates`), and the
 * app offers the same list as starting points in the create form. A template
 * only fixes name, prompt, and cadence; host, project, and model stay the
 * user's choice. Prompts avoid repo-specific assumptions because the same
 * template is offered for every project. The inbox digest relies on whatever
 * Slack and mail tools the chosen provider already has (for Claude Code, its
 * claude.ai connectors); the prompt tells the agent to say so when they are
 * missing instead of guessing.
 */
export interface ScheduleTemplate {
  id: string;
  label: string;
  description: string;
  name: string;
  prompt: string;
  cronExpression: string;
}

export const SCHEDULE_TEMPLATES: readonly ScheduleTemplate[] = [
  {
    id: "inbox-digest",
    label: "Daily inbox digest",
    description: "Summarize yesterday's Slack and email, and list what needs a reply.",
    name: "Daily inbox digest",
    prompt: [
      "Go through my Slack messages and email from the last 24 hours using the tools you have for them.",
      "Write a short digest grouped by topic: what happened, decisions made, and anything blocked.",
      "Then list follow-ups I owe: who is waiting on me, what they asked, and how long they have been waiting.",
      "Put time-sensitive items first. If you cannot reach Slack or email, say which one and stop.",
    ].join("\n"),
    cronExpression: "0 8 * * 1-5",
  },
  {
    id: "repo-health",
    label: "Weekday repo health check",
    description: "Dependencies, failing checks, and risky open changes each morning.",
    name: "Weekday repo health check",
    prompt: [
      "Check the health of this repository.",
      "Run the project's typecheck, lint, and test commands and report anything failing.",
      "Flag outdated or vulnerable dependencies and open branches or pull requests that look risky.",
      "End with the single most useful next action. Do not change code.",
    ].join("\n"),
    cronExpression: "0 9 * * 1-5",
  },
  {
    id: "change-review",
    label: "Daily change review",
    description: "Review the day's commits for correctness, missing tests, and loose ends.",
    name: "Daily change review",
    prompt: [
      "Review every commit on the default branch from the last 24 hours.",
      "Call out correctness risks, behavior changes without tests, and TODOs or follow-ups left behind.",
      "Keep the report short and concrete, with file paths. Do not change code.",
    ].join("\n"),
    cronExpression: "0 17 * * *",
  },
];

export function findScheduleTemplate(id: string): ScheduleTemplate | null {
  return SCHEDULE_TEMPLATES.find((template) => template.id === id) ?? null;
}
