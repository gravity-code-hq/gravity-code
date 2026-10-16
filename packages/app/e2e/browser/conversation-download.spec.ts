import { readFile } from "node:fs/promises";
import { expect, test } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { installDaemonWebSocketGate } from "../support/helpers/daemon-websocket-gate";
import { expectComposerVisible } from "../support/helpers/composer";

test("downloads and copies the same full conversation including older tool calls and outputs", async ({
  page,
}, testInfo) => {
  const session = await seedMockAgentWorkspace({
    repoPrefix: "conversation-download-",
    title: "Download conversation test",
    initialPrompt: "Emit 205 tool call agent stream updates with 3 output lines",
  });
  try {
    await session.client.waitForFinish(session.agentId, 45_000);
    await openAgentRoute(page, session);
    await expectComposerVisible(page);
    const tab = page.getByTestId(`workspace-tab-agent_${session.agentId}`);
    await tab.click({ button: "right" });
    const action = page.getByText("Download conversation", { exact: true });
    await expect(action).toBeVisible();
    await expect
      .poll(() =>
        action.evaluate((element) => {
          let current: Element | null = element;
          while (current) {
            if (getComputedStyle(current).opacity !== "1") return false;
            current = current.parentElement;
          }
          return true;
        }),
      )
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath("conversation-download-menu.png") });
    const downloaded = page.waitForEvent("download");
    await action.click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toBe(`conversation-${session.agentId}.json`);
    const filePath = testInfo.outputPath("conversation.json");
    await file.saveAs(filePath);
    const conversation = JSON.parse(await readFile(filePath, "utf8"));
    expect(conversation.agentId).toBe(session.agentId);
    expect(conversation.entries[0].item).toMatchObject({
      type: "user_message",
      text: "Emit 205 tool call agent stream updates with 3 output lines",
    });
    const tools = conversation.entries.filter(
      (entry: { item: { type: string } }) => entry.item.type === "tool_call",
    );
    expect(tools).toHaveLength(205);
    for (let index = 0; index < tools.length; index++) {
      expect(tools[index].item).toMatchObject({
        status: "completed",
        detail: {
          command: `echo tool-${index + 1}`,
          output: [1, 2, 3].map((line) => `tool-${index + 1} output line ${line}`).join("\n"),
        },
      });
    }
    await expect(page.getByText("Download complete", { exact: true })).toBeVisible();
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(page.url()).origin,
    });
    await tab.click({ button: "right" });
    const copyAction = page.getByText("Copy conversation", { exact: true });
    await expect(copyAction).toBeVisible();
    await copyAction.click();
    await expect(page.getByText("Conversation copied", { exact: true })).toBeVisible();
    const copiedText = await page.evaluate(() => navigator.clipboard.readText());
    const copied = JSON.parse(copiedText);
    expect({ ...copied, exportedAt: conversation.exportedAt }).toEqual(conversation);
  } finally {
    await session.cleanup();
  }
});

test("shows an actionable error when downloading offline and allows retry", async ({ page }) => {
  const gate = await installDaemonWebSocketGate(page);
  const session = await seedMockAgentWorkspace({
    repoPrefix: "conversation-download-offline-",
    title: "Offline conversation download",
  });
  try {
    await openAgentRoute(page, session);
    await expectComposerVisible(page);
    const tab = page.getByTestId(`workspace-tab-agent_${session.agentId}`);
    await gate.drop();
    await gate.waitForBlockedConnection();
    await tab.click({ button: "right" });
    await page.getByText("Download conversation", { exact: true }).click();
    await expect(page.getByText(/Could not download conversation:/)).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByText(/Try Download conversation again/)).toBeVisible();
    gate.restore();
    await page.reload();
    await expectComposerVisible(page);
    await tab.click({ button: "right" });
    const downloaded = page.waitForEvent("download", { timeout: 45_000 });
    await page.getByText("Download conversation", { exact: true }).click();
    expect((await downloaded).suggestedFilename()).toBe(`conversation-${session.agentId}.json`);
  } finally {
    gate.restore();
    await session.cleanup();
  }
});

test("shows a persistent copy error offline and copies successfully after reconnecting", async ({
  page,
}) => {
  const gate = await installDaemonWebSocketGate(page);
  const session = await seedMockAgentWorkspace({
    repoPrefix: "conversation-copy-offline-",
    title: "Offline conversation copy",
  });
  try {
    await openAgentRoute(page, session);
    await expectComposerVisible(page);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(page.url()).origin,
    });
    const tab = page.getByTestId(`workspace-tab-agent_${session.agentId}`);
    await gate.drop();
    await gate.waitForBlockedConnection();
    await tab.click({ button: "right" });
    await page.getByText("Copy conversation", { exact: true }).click();
    await expect(page.getByText(/Could not copy conversation:/)).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(/Try Copy conversation again/)).toBeVisible();
    gate.restore();
    await page.reload();
    await expectComposerVisible(page);
    await tab.click({ button: "right" });
    await page.getByText("Copy conversation", { exact: true }).click();
    await expect(page.getByText("Conversation copied", { exact: true })).toBeVisible();
    const copiedText = await page.evaluate(() => navigator.clipboard.readText());
    expect(JSON.parse(copiedText).agentId).toBe(session.agentId);
  } finally {
    gate.restore();
    await session.cleanup();
  }
});

test("reports clipboard permission failure and lets the user retry", async ({ page }) => {
  const session = await seedMockAgentWorkspace({
    repoPrefix: "conversation-copy-permission-",
    title: "Conversation clipboard permission",
  });
  try {
    await openAgentRoute(page, session);
    await expectComposerVisible(page);
    const origin = new URL(page.url()).origin;
    await page.context().grantPermissions([], { origin });
    const tab = page.getByTestId(`workspace-tab-agent_${session.agentId}`);
    await tab.click({ button: "right" });
    await page.getByText("Copy conversation", { exact: true }).click();
    await expect(page.getByText(/Could not copy conversation:/)).toBeVisible();
    await expect(page.getByText(/Try Copy conversation again/)).toBeVisible();
    await expect(page.getByText("Conversation copied", { exact: true })).toHaveCount(0);
    await page.getByTestId("app-toast-dismiss").click();
    await expect(page.getByTestId("app-toast")).toHaveCount(0);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    await tab.click({ button: "right" });
    await page.getByText("Copy conversation", { exact: true }).click();
    await expect(page.getByText("Conversation copied", { exact: true })).toBeVisible();
    const copiedText = await page.evaluate(() => navigator.clipboard.readText());
    expect(JSON.parse(copiedText).agentId).toBe(session.agentId);
  } finally {
    await session.cleanup();
  }
});
