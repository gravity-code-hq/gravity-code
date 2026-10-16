import type { AgentPromptInput, AgentTimelineItem } from "./agent-sdk-types.js";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { AgentTimelineItemPayloadSchema } from "@gravity/protocol/messages";
import type { AgentStreamEvent } from "./agent-sdk-types.js";

export const StoredForkHistorySchema = z.object({
  rows: z.array(
    z.object({
      item: AgentTimelineItemPayloadSchema,
      timestamp: z.string(),
      turnId: z.string().optional(),
    }),
  ),
  promptText: z.string(),
  clientMessageId: z.string(),
  providerMessageId: z.string().optional(),
  providerPromptDigest: z.string(),
});
export type StoredForkHistory = z.infer<typeof StoredForkHistorySchema>;

export function forkPromptDigest(prompt: AgentPromptInput): string {
  const text =
    typeof prompt === "string"
      ? prompt
      : prompt.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
  return createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex");
}

export function restoreForkHistoryEvent(
  event: Extract<AgentStreamEvent, { type: "timeline" }>,
  snapshots: readonly StoredForkHistory[] | undefined,
): Extract<AgentStreamEvent, { type: "timeline" }>[] {
  if (event.item.type !== "user_message" || !snapshots?.length) return [event];
  const item = event.item;
  const snapshot = snapshots.find(
    (entry) =>
      (entry.providerMessageId !== undefined && entry.providerMessageId === item.messageId) ||
      entry.providerPromptDigest === forkPromptDigest(item.text),
  );
  if (!snapshot) return [event];
  return [
    ...snapshot.rows.map((row) => ({
      type: "timeline" as const,
      provider: event.provider,
      item: row.item,
      timestamp: row.timestamp,
      ...(row.turnId ? { turnId: row.turnId } : {}),
    })),
    {
      ...event,
      item: { ...item, text: snapshot.promptText, clientMessageId: snapshot.clientMessageId },
    },
  ];
}

export function hasForkHistory(prompt: AgentPromptInput): boolean {
  return (
    typeof prompt !== "string" &&
    prompt.some(
      (block) => block.type === "text" && "forkHistory" in block && block.forkHistory !== undefined,
    )
  );
}

/** Copy provider identities into a separate namespace; inherited prompts cannot be rewound. */
export function forkHistoryRows(
  prompt: AgentPromptInput,
  namespace: string,
): Omit<AgentTimelineRow, "seq">[] {
  if (typeof prompt === "string") return [];
  const rows: Omit<AgentTimelineRow, "seq">[] = [];
  for (const [attachmentIndex, block] of prompt.entries()) {
    if (block.type !== "text" || !("forkHistory" in block) || !block.forkHistory) continue;
    const prefix = `fork:${namespace}:${attachmentIndex}:`;
    for (const [index, entry] of block.forkHistory.entries.entries()) {
      let item: AgentTimelineItem = structuredClone(entry.item);
      switch (item.type) {
        case "user_message":
          item = { type: "user_message", text: item.text, inherited: true };
          break;
        case "assistant_message":
          item.messageId = `${prefix}${item.messageId ?? index}`;
          break;
        case "tool_call":
          item.callId = `${prefix}${item.callId}`;
          if (item.status === "running") item = { ...item, status: "canceled", error: null };
          break;
        case "plugin":
          item.id = `${prefix}${item.id}`;
          break;
        case "compaction":
          item.status = "completed";
          break;
      }
      rows.push({
        item,
        timestamp: entry.timestamp,
        ...(entry.turnId ? { turnId: `${prefix}${entry.turnId}` } : {}),
      });
    }
    rows.push({
      item: {
        type: "notification",
        level: "info",
        message: `Forked from ${block.forkHistory.sourceTitle}`,
        forkSourceTitle: block.forkHistory.sourceTitle,
      },
      timestamp: new Date().toISOString(),
    });
  }
  return rows;
}
