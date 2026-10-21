import { z } from "zod";
import type { AgentTimelineItem } from "../agent-sdk-types.js";

// The next message follows from the last exchange, so a short tail carries
// nearly all the signal and keeps the generation call cheap.
export const PROMPT_SUGGESTION_CONTEXT_CHARS = 8_000;
export const PROMPT_SUGGESTION_MAX_CHARS = 160;

export const PromptSuggestionResponseSchema = z.object({ suggestion: z.string() });
export type PromptSuggestionResponse = z.infer<typeof PromptSuggestionResponseSchema>;

const INSTRUCTIONS = [
  "You predict the next message a developer will send to their coding agent.",
  "The agent has just finished its turn and the developer's input box is empty.",
  "Below is the tail of their conversation.",
  "",
  "Rules:",
  "- Write as the developer, addressing the agent: imperative, first person.",
  `- One line, at most ${PROMPT_SUGGESTION_MAX_CHARS} characters, no quotes.`,
  "- Be specific to this conversation: name the file, test, branch or error in it.",
  "- If the agent asked the developer a question, answer it.",
  "- Never ask for work the agent already finished.",
  "- No filler like 'continue', 'thanks' or 'looks good'.",
  "- Write in the language the developer has been using.",
].join("\n");

// Only user and assistant messages go into the prompt. Tool calls carry shell
// commands, file contents and fetched pages, which have no business in a
// side request whose only job is guessing a one-line reply.
export function buildPromptSuggestionPrompt(
  items: readonly AgentTimelineItem[],
  maxContextChars = PROMPT_SUGGESTION_CONTEXT_CHARS,
): string | null {
  const lines: string[] = [];
  for (const item of items) {
    if (item.type === "user_message" && item.text.trim()) {
      lines.push(`Developer: ${item.text.trim()}`);
    } else if (item.type === "assistant_message" && item.text.trim()) {
      lines.push(`Agent: ${item.text.trim()}`);
    }
  }
  if (!lines.some((line) => line.startsWith("Agent: "))) {
    return null;
  }

  const conversation = takeTail(lines.join("\n\n"), maxContextChars);
  return [
    INSTRUCTIONS,
    "",
    `<conversation>\n${conversation}\n</conversation>`,
    "",
    'Return JSON only: {"suggestion": "..."}',
  ].join("\n");
}

// Null when the model produced nothing usable: an empty composer beats a
// broken suggestion.
export function normalizePromptSuggestion(raw: string): string | null {
  const firstLine = raw.trim().split("\n")[0]?.trim() ?? "";
  const unquoted = firstLine.replace(/^["'`]+|["'`]+$/g, "").trim();
  if (!unquoted) {
    return null;
  }
  return unquoted.length > PROMPT_SUGGESTION_MAX_CHARS
    ? unquoted.slice(0, PROMPT_SUGGESTION_MAX_CHARS).trimEnd()
    : unquoted;
}

function takeTail(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  const tail = text.slice(text.length - limit);
  const firstBreak = tail.indexOf("\n");
  return firstBreak >= 0 ? tail.slice(firstBreak + 1) : tail;
}
