import type {
  DaemonClient,
  FetchAgentTimelinePayload,
} from "@gravity/client/internal/daemon-client";

export class ConversationExportError extends Error {
  constructor() {
    super("Conversation history changed during export. Download the conversation again.");
    this.name = "ConversationExportError";
  }
}

interface ConversationExportInput {
  agentId: string;
  client: Pick<DaemonClient, "fetchAgentTimeline">;
}

export async function fetchConversationExport({
  agentId,
  client,
}: ConversationExportInput): Promise<string> {
  const latest = await client.fetchAgentTimeline(agentId, {
    direction: "tail",
    limit: 100,
    projection: "projected",
  });
  const pages: FetchAgentTimelinePayload["entries"][] = [];
  let page = latest;
  while (true) {
    if (page.error) throw new Error(page.error);
    const historyChanged =
      page.epoch !== latest.epoch || page.reset || page.staleCursor || page.gap;
    if (historyChanged) throw new ConversationExportError();
    pages.push(page.entries);
    if (!page.hasOlder) break;
    const cursor = page.startCursor;
    if (!cursor) throw new ConversationExportError();
    page = await client.fetchAgentTimeline(agentId, {
      direction: "before",
      cursor,
      limit: 100,
      projection: "projected",
    });
    if (page.startCursor && page.startCursor.seq >= cursor.seq) {
      throw new ConversationExportError();
    }
  }
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      agentId,
      agent: latest.agent,
      epoch: latest.epoch,
      // Capture the tail once so an actively running agent cannot make the export endless.
      throughSeq: latest.window.maxSeq,
      entries: pages.toReversed().flat(),
    },
    null,
    2,
  );
}
