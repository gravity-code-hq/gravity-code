import { describe, expect, test } from "vitest";

import { buildPromptSuggestionPrompt, normalizePromptSuggestion } from "./prompt.js";

describe("buildPromptSuggestionPrompt", () => {
  test("keeps the newest messages when the conversation is longer than the budget", () => {
    const prompt = buildPromptSuggestionPrompt(
      [
        { type: "user_message", text: "old request ".repeat(20) },
        { type: "assistant_message", text: "old reply" },
        { type: "user_message", text: "Run the migration" },
        { type: "assistant_message", text: "Migration done." },
      ],
      60,
    );

    expect(prompt).toContain("Developer: Run the migration\n\nAgent: Migration done.");
    expect(prompt).not.toContain("old request");
  });

  test("returns null before the agent has said anything", () => {
    expect(buildPromptSuggestionPrompt([{ type: "user_message", text: "Hi" }])).toBeNull();
  });
});

describe("normalizePromptSuggestion", () => {
  test("strips quotes and keeps only the first line", () => {
    expect(normalizePromptSuggestion('"Run the e2e suite"\nand then deploy')).toBe(
      "Run the e2e suite",
    );
  });

  test("returns null for an empty suggestion", () => {
    expect(normalizePromptSuggestion('  ""  ')).toBeNull();
  });
});
