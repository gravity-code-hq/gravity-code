import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import { expectComposerVisible } from "../support/helpers/composer";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { openSettingsSection } from "../support/helpers/settings";
import { openSettings } from "../support/helpers/app";

type WebSocketMessage = string | Buffer;

const COMPACT_VIEWPORT = { width: 390, height: 520 };

function parseSessionMessage(message: WebSocketMessage): Record<string, unknown> | null {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  try {
    const envelope = JSON.parse(raw) as { type?: unknown; message?: unknown };
    return envelope.type === "session" && envelope.message && typeof envelope.message === "object"
      ? (envelope.message as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function getToolCallStatus(
  message: WebSocketMessage,
  agentId: string,
): { callId: string; status: string } | null {
  const sessionMessage = parseSessionMessage(message);
  if (sessionMessage?.type !== "agent_stream") {
    return null;
  }
  const payload = sessionMessage.payload as Record<string, unknown> | undefined;
  if (payload?.agentId !== agentId) {
    return null;
  }
  const event = payload.event as Record<string, unknown> | undefined;
  const item = event?.item as Record<string, unknown> | undefined;
  return event?.type === "timeline" &&
    item?.type === "tool_call" &&
    typeof item.callId === "string" &&
    typeof item.status === "string"
    ? { callId: item.callId, status: item.status }
    : null;
}

function cloneToolCallWithId(
  message: WebSocketMessage,
  callId: string,
  sequenceOffset: number,
): string {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  const envelope = JSON.parse(raw) as {
    message?: { payload?: { seq?: number; event?: { item?: { callId?: string } } } };
  };
  const payload = envelope.message?.payload;
  const item = payload?.event?.item;
  if (!payload || !item?.callId || typeof payload.seq !== "number") {
    throw new Error("Expected a tool-call session message");
  }
  item.callId = callId;
  payload.seq += sequenceOffset;
  return JSON.stringify(envelope);
}

function shiftTimelineSequence(
  message: WebSocketMessage,
  sequenceOffset: number,
): WebSocketMessage {
  if (sequenceOffset === 0) {
    return message;
  }
  const raw = typeof message === "string" ? message : message.toString("utf8");
  try {
    const envelope = JSON.parse(raw) as { message?: { payload?: { seq?: number } } };
    const payload = envelope.message?.payload;
    if (typeof payload?.seq !== "number") {
      return message;
    }
    payload.seq += sequenceOffset;
    return JSON.stringify(envelope);
  } catch {
    return message;
  }
}

async function holdStreamAfterFirstCompletedToolCall(page: Page, agentId: string) {
  let firstCallId: string | null = null;
  let firstCompletedMessage: WebSocketMessage | null = null;
  let isHolding = false;
  let sequenceOffset = 0;
  const heldMessages: WebSocketMessage[] = [];
  let sendToPage: ((message: WebSocketMessage) => void) | null = null;
  let resolveFirstCompleted!: () => void;
  const firstCompleted = new Promise<void>((resolve) => {
    resolveFirstCompleted = resolve;
  });

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    sendToPage = (message) => ws.send(message);
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (isHolding) {
        heldMessages.push(message);
        return;
      }

      ws.send(shiftTimelineSequence(message, sequenceOffset));
      const toolCall = getToolCallStatus(message, agentId);
      firstCallId ??= toolCall?.callId ?? null;
      if (toolCall?.callId === firstCallId && toolCall.status === "completed") {
        firstCompletedMessage = message;
        isHolding = true;
        resolveFirstCompleted();
      }
    });
  });

  return {
    waitForFirstCompleted: () => firstCompleted,
    release(extraCompletedCalls = 0) {
      isHolding = false;
      if (extraCompletedCalls > 0 && (!firstCallId || !firstCompletedMessage)) {
        throw new Error("Expected the first completed tool call before release");
      }
      for (let index = 0; index < extraCompletedCalls; index += 1) {
        sendToPage?.(
          cloneToolCallWithId(
            firstCompletedMessage as WebSocketMessage,
            `${firstCallId}:${index}`,
            index + 1,
          ),
        );
      }
      sequenceOffset = extraCompletedCalls;
      for (const message of heldMessages.splice(0)) {
        sendToPage?.(shiftTimelineSequence(message, sequenceOffset));
      }
    },
  };
}

async function configureOverviewToolCalls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      "@gravity:app-settings",
      JSON.stringify({ toolCallDetailLevel: "overview" }),
    );
  });
}

async function createOverviewAgent(page: Page, title: string) {
  await configureOverviewToolCalls(page);
  return seedMockAgentWorkspace({
    repoPrefix: "tool-call-overview-sheet-",
    title,
    model: "ten-second-stream",
  });
}

async function openOverviewAgent(
  page: Page,
  agent: Awaited<ReturnType<typeof seedMockAgentWorkspace>>,
): Promise<void> {
  await openAgentRoute(page, {
    workspaceId: agent.workspaceId,
    agentId: agent.agentId,
  });
  await expectComposerVisible(page);
}

function hasScrolledToLatest(root: HTMLElement): boolean {
  for (const node of root.querySelectorAll<HTMLElement>("*")) {
    if (node.scrollHeight <= node.clientHeight) {
      continue;
    }
    const maximumScrollTop = node.scrollHeight - node.clientHeight;
    return maximumScrollTop > 0 && Math.abs(node.scrollTop - maximumScrollTop) <= 1;
  }
  return false;
}

function readScrollMetrics(root: HTMLElement) {
  const badgeElements = root.querySelectorAll<HTMLElement>("[data-testid=tool-call-badge]");
  const latestBadge = badgeElements.item(badgeElements.length - 1);
  const scrollables = [];
  for (const node of root.querySelectorAll<HTMLElement>("*")) {
    if (node.scrollHeight <= node.clientHeight) {
      continue;
    }
    scrollables.push({
      className: node.className,
      clientHeight: node.clientHeight,
      rect: node.getBoundingClientRect().toJSON(),
      scrollHeight: node.scrollHeight,
      scrollTop: node.scrollTop,
      tagName: node.tagName,
    });
  }
  return {
    latestBadgeRect: latestBadge?.getBoundingClientRect().toJSON(),
    rootRect: root.getBoundingClientRect().toJSON(),
    scrollables,
    viewport: { height: window.innerHeight, width: window.innerWidth },
  };
}

test.describe("compact overview tool calls", () => {
  test.use({ viewport: COMPACT_VIEWPORT, hasTouch: true });

  test("keeps a live group sheet current and stacks individual details above it", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const agent = await createOverviewAgent(page, "Compact overview tool calls");

    try {
      const gate = await holdStreamAfterFirstCompletedToolCall(page, agent.agentId);
      await openOverviewAgent(page, agent);
      await agent.client.sendAgentMessage(agent.agentId, "Exercise the overview tool-call sheet.");
      await gate.waitForFirstCompleted();

      const group = page.getByTestId("tool-call-group").first();
      await expect(group).toBeVisible();
      await group.click();

      const sheet = page.getByTestId("tool-call-group-sheet");
      const summary = page.getByTestId("tool-call-group-sheet-summary");
      await expect(sheet).toBeVisible();
      const initialSummary = await summary.innerText();

      gate.release(10);
      const badges = sheet.getByTestId("tool-call-badge");
      await expect.poll(() => badges.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(11);
      await expect(summary).not.toHaveText(initialSummary);
      await expect.poll(() => sheet.evaluate(hasScrolledToLatest)).toBe(true);
      const scrollMetrics = await sheet.evaluate(readScrollMetrics);
      await testInfo.attach("compact-overview-scroll-metrics", {
        body: JSON.stringify(scrollMetrics, null, 2),
        contentType: "application/json",
      });

      await badges.last().click();
      const detailClose = page.getByTestId("tool-call-sheet-close");
      await expect(detailClose).toBeVisible();

      await detailClose.click();
      await expect(detailClose).toBeHidden();
      await expect(sheet).toBeVisible();

      await testInfo.attach("compact-overview-tool-call-group", {
        body: await page.screenshot(),
        contentType: "image/png",
      });

      await page.getByTestId("tool-call-group-sheet-close").click();
      await expect(sheet).toBeHidden();
      await expect(group).toBeVisible();
    } finally {
      await agent.cleanup();
    }
  });
});

for (const layout of ["desktop", "compact"] as const) {
  test(`collapses long detailed tool runs on ${layout} and reveals earlier calls`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    if (layout === "compact") await page.setViewportSize(COMPACT_VIEWPORT);
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "detailed-tool-call-limit-",
      title: "Long tool run",
    });

    try {
      await openOverviewAgent(page, agent);
      await agent.client.sendAgentMessage(agent.agentId, "Emit 25 tool call agent stream updates");
      const group = page.getByTestId("tool-call-group");
      await expect(group).toHaveText("20 earlier tool calls");
      const badges = page.getByTestId("tool-call-badge");
      await expect(badges).toHaveCount(5);
      await expect(badges.first()).toContainText("echo tool-21");
      await expect(badges.last()).toContainText("echo tool-25");
      await page.screenshot({ path: testInfo.outputPath(`${layout}-collapsed.png`) });

      await group.click();
      const details = layout === "compact" ? page.getByTestId("tool-call-group-sheet") : group;
      await expect(details.getByTestId("tool-call-badge")).toHaveCount(20);
      await expect(details.getByTestId("tool-call-badge").first()).toContainText("echo tool-1");
      await expect(details.getByTestId("tool-call-badge").last()).toContainText("echo tool-20");
      await details.getByTestId("tool-call-badge").last().click();
      await expect(page.getByText(/echo tool-20\s+tool-20/).last()).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`${layout}-expanded.png`) });
      if (layout === "compact") {
        await page.getByTestId("tool-call-sheet-close").click();
        await page.getByTestId("tool-call-group-sheet-close").click();
      } else {
        await group.getByRole("button", { name: "20 earlier tool calls", exact: true }).click();
      }
      await expect(badges).toHaveCount(5);

      await page.reload();
      await expect(group).toHaveText("20 earlier tool calls");
      await expect(badges).toHaveCount(5);
    } finally {
      await agent.cleanup();
    }
  });
}

test("previews complete tool output after a sustained hover and keeps it scrollable", async ({
  page,
}, testInfo) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const expectedCopy =
    "$ echo tool-1\n\n" +
    Array.from({ length: 120 }, (_, index) => `tool-1 output line ${index + 1}`).join("\n");
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "tool-call-hover-",
    title: "Tool output hover preview",
  });
  try {
    await openOverviewAgent(page, agent);
    await agent.client.sendAgentMessage(
      agent.agentId,
      "Emit 1 tool call agent stream updates with 120 output lines",
    );
    const badge = page.getByTestId("tool-call-badge");
    const popup = page.getByTestId("tool-call-hover-preview");
    await expect(badge).toContainText("echo tool-1");

    await badge.hover();
    await page.waitForTimeout(1_000);
    await expect(popup).toHaveCount(0);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(1_200);
    await expect(popup).toHaveCount(0);

    await badge.hover();
    await expect(popup).toBeVisible({ timeout: 5_000 });
    await expect(popup).toContainText("echo tool-1");
    await expect(popup).toContainText("tool-1 output line 120");
    const bounds = await popup.boundingBox();
    if (!bounds) throw new Error("Expected the output preview bounds");
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { steps: 20 });
    await page.mouse.wheel(0, 2_000);
    await expect.poll(() => popup.evaluate(hasScrolledToLatest)).toBe(true);
    await expect(popup).toBeVisible();
    await popup.getByTestId("tool-call-copy").click();
    await expect(popup.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expectedCopy);
    await expect(popup).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("tool-output-hover.png") });

    await page.getByTestId("tool-call-hover-preview-close").click();
    await expect(popup).toHaveCount(0);
    await badge.hover();
    await expect(popup).toBeVisible({ timeout: 5_000 });
    await page.mouse.move(5, 5);
    await expect(popup).toHaveCount(0);

    await badge.click();
    await expect(badge).toContainText("tool-1 output line 120");
    await expect(popup).toHaveCount(0);
    await badge.getByTestId("tool-call-copy").click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expectedCopy);
    await expect(badge.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
    await expect(badge).toContainText("tool-1 output line 120");
    await page.screenshot({ path: testInfo.outputPath("tool-output-inline-copy.png") });

    const cdp = await page.context().newCDPSession(page);
    try {
      const { targetInfo } = await cdp.send("Target.getTargetInfo");
      const permission = {
        browserContextId: targetInfo.browserContextId,
        permission: { name: "clipboard-write" },
        origin: new URL(page.url()).origin,
      };
      await cdp.send("Browser.setPermission", { ...permission, setting: "denied" });
      await badge.getByTestId("tool-call-copy").click();
      await expect(page.getByText("Unable to copy", { exact: true })).toBeVisible();
      await expect(badge).toContainText("tool-1 output line 120");
      await cdp.send("Browser.setPermission", { ...permission, setting: "granted" });
      await badge.getByTestId("tool-call-copy").click();
      await expect(badge.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
    } finally {
      await cdp.detach();
    }
  } finally {
    await agent.cleanup();
  }
});

test("enables collapsed tool calls with bounded scrolling from settings", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "tool-call-collapse-",
    title: "Desktop collapsed tool calls",
    model: "ten-second-stream",
  });

  try {
    await openOverviewAgent(page, agent);
    await openSettings(page);
    await openSettingsSection(page, "appearance");
    const toggle = page.getByRole("switch", { name: "Collapse tool calls", exact: true });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await page.reload();
    await expect(toggle).toBeChecked();
    await page.screenshot({ path: testInfo.outputPath("collapse-tool-calls-setting.png") });

    const gate = await holdStreamAfterFirstCompletedToolCall(page, agent.agentId);
    await openOverviewAgent(page, agent);
    await agent.client.sendAgentMessage(agent.agentId, "Exercise desktop overview tool calls.");
    await gate.waitForFirstCompleted();
    const group = page.getByTestId("tool-call-group").first();
    await expect(group).toBeVisible();
    await expect(group.getByTestId("tool-call-badge")).toHaveCount(0);

    await group.click();
    await expect(page.getByTestId("tool-call-group-sheet")).toHaveCount(0);
    await expect(group.getByTestId("tool-call-badge").first()).toBeVisible();
    gate.release(20);
    await expect
      .poll(() => group.getByTestId("tool-call-badge").count())
      .toBeGreaterThanOrEqual(21);
    await expect.poll(() => group.evaluate(hasScrolledToLatest)).toBe(true);
    const metrics = await group.evaluate(readScrollMetrics);
    const scrollingSection = metrics.scrollables.find((node) => node.clientHeight > 0);
    expect(scrollingSection?.clientHeight).toBe(400);
    const screenshotPath = testInfo.outputPath("collapsed-tool-calls.png");
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach("collapsed-tool-calls", {
      path: screenshotPath,
      contentType: "image/png",
    });

    await openSettings(page);
    await openSettingsSection(page, "appearance");
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await page.reload();
    await expect(toggle).not.toBeChecked();
    await openOverviewAgent(page, agent);
    await expect(page.getByTestId("tool-call-group")).toHaveCount(0);
    await expect(page.getByTestId("tool-call-badge").first()).toBeVisible();
  } finally {
    await agent.cleanup();
  }
});
