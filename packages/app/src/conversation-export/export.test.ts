import { describe, expect, it } from "vitest";
import type { FetchAgentTimelinePayload } from "@gravity/client/internal/daemon-client";
import { ConversationExportError, fetchConversationExport } from "./export";

function page(seq: number, hasOlder: boolean): FetchAgentTimelinePayload {
  return {
    requestId: "request",
    agentId: "agent",
    agent: null,
    direction: "tail",
    projection: "projected",
    epoch: "epoch",
    reset: false,
    staleCursor: false,
    gap: false,
    window: { minSeq: 1, maxSeq: 3, nextSeq: 4 },
    startCursor: { epoch: "epoch", seq },
    endCursor: { epoch: "epoch", seq },
    hasOlder,
    hasNewer: false,
    error: null,
    entries: [
      {
        provider: "claude",
        timestamp: "2026-09-19T00:00:00.000Z",
        seqStart: seq,
        seqEnd: seq,
        sourceSeqRanges: [{ startSeq: seq, endSeq: seq }],
        collapsed: [],
        item: { type: "assistant_message", text: `Message ${seq}` },
      },
    ],
  };
}

describe("conversation export", () => {
  it.each([
    { epoch: "reloaded" },
    { reset: true },
    { staleCursor: true },
    { gap: true },
    { startCursor: { epoch: "epoch", seq: 3 } },
  ])("refuses a partial or inconsistent download: %j", async (change) => {
    const pages = [page(3, true), { ...page(1, false), ...change }];
    await expect(
      fetchConversationExport({
        agentId: "agent",
        client: { fetchAgentTimeline: async () => pages.shift()! },
      }),
    ).rejects.toBeInstanceOf(ConversationExportError);
  });

  it("propagates a failed older page instead of saving a partial conversation", async () => {
    let calls = 0;
    await expect(
      fetchConversationExport({
        agentId: "agent",
        client: {
          fetchAgentTimeline: async () => {
            if (calls++ === 0) return page(3, true);
            throw new Error("Disconnected");
          },
        },
      }),
    ).rejects.toThrow("Disconnected");
  });

  it("exports an empty conversation", async () => {
    const empty = { ...page(0, false), entries: [], startCursor: null, endCursor: null };
    const content = await fetchConversationExport({
      agentId: "agent",
      client: { fetchAgentTimeline: async () => empty },
    });
    expect(JSON.parse(content)).toMatchObject({ version: 1, agentId: "agent", entries: [] });
  });

  it("downloads every history page in chronological order without dropping tool details", async () => {
    const oldest = page(1, false);
    const middle = page(2, true);
    middle.entries[0]!.item = {
      type: "tool_call",
      callId: "call",
      name: "Shell",
      status: "completed",
      error: null,
      detail: { type: "plain_text", label: "Shell", text: "command input and full output\n```" },
    };
    const newest = page(3, true);
    const pages = [newest, middle, oldest];
    const requests: unknown[] = [];
    const result = await fetchConversationExport({
      agentId: "agent",
      client: {
        fetchAgentTimeline: async (agentId, options) => {
          requests.push({ agentId, ...options });
          return pages.shift()!;
        },
      },
    });
    expect(JSON.parse(result).entries).toEqual([
      ...oldest.entries,
      ...middle.entries,
      ...newest.entries,
    ]);
    expect(requests).toEqual([
      { agentId: "agent", direction: "tail", limit: 100, projection: "projected" },
      {
        agentId: "agent",
        direction: "before",
        cursor: { epoch: "epoch", seq: 3 },
        limit: 100,
        projection: "projected",
      },
      {
        agentId: "agent",
        direction: "before",
        cursor: { epoch: "epoch", seq: 2 },
        limit: 100,
        projection: "projected",
      },
    ]);
  });
});
