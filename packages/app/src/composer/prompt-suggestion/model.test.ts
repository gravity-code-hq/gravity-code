import { describe, expect, test } from "vitest";
import {
  dismissPromptSuggestionTurn,
  isPromptSuggestionTurnDismissed,
  resolvePromptSuggestionKeyAction,
} from "./model";

const EMPTY = { text: "", selection: { start: 0, end: 0 } };

describe("resolvePromptSuggestionKeyAction", () => {
  test("Tab accepts and Escape dismisses while the suggestion shows", () => {
    expect(resolvePromptSuggestionKeyAction({ key: "Tab", input: EMPTY }, "Run the tests")).toBe(
      "accept",
    );
    expect(resolvePromptSuggestionKeyAction({ key: "Escape", input: EMPTY }, "Run the tests")).toBe(
      "dismiss",
    );
  });

  test("leaves keys alone once the user has typed", () => {
    const typed = { text: "R", selection: { start: 1, end: 1 } };
    expect(resolvePromptSuggestionKeyAction({ key: "Tab", input: typed }, "Run the tests")).toBe(
      null,
    );
  });

  test("leaves keys alone when there is no suggestion", () => {
    expect(resolvePromptSuggestionKeyAction({ key: "Tab", input: EMPTY }, null)).toBe(null);
  });

  test("leaves other keys alone", () => {
    expect(resolvePromptSuggestionKeyAction({ key: "Enter", input: EMPTY }, "Run the tests")).toBe(
      null,
    );
  });
});

describe("dismissed turns", () => {
  test("stay dismissed for that turn only", () => {
    dismissPromptSuggestionTurn("server", "agent", "epoch:3");

    expect(isPromptSuggestionTurnDismissed("server", "agent", "epoch:3")).toBe(true);
    expect(isPromptSuggestionTurnDismissed("server", "agent", "epoch:5")).toBe(false);
    expect(isPromptSuggestionTurnDismissed("server", "other-agent", "epoch:3")).toBe(false);
  });
});
