import { openAgentRoute } from "../support/helpers/mock-agent";
import { expectWorkspaceAgentConfiguration } from "../support/helpers/command-center-agent-controls";
import { test, expect } from "../support/fixtures";
import { openWorkspaceWithAgents } from "../support/helpers/archive-tab";
import {
  expectNoCollapsedComposerToolbarFrame,
  recordComposerToolbarFrames,
} from "../support/helpers/composer-control-density";
import { clickNewChat, gotoWorkspace } from "../support/helpers/launcher";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";

const SETTLE_MS = 1_000;

async function seedSettledMockAgent(workspace: SeededWorkspace, title: string) {
  const agent = await workspace.client.createAgent({
    provider: "mock",
    model: "ten-second-stream",
    modeId: "load-test",
    cwd: workspace.repoPath,
    workspaceId: workspace.workspaceId,
    title,
  });
  await workspace.client.waitForAgentUpsert(
    agent.id,
    (snapshot) => snapshot.status === "idle",
    30_000,
  );
  return { id: agent.id, title, cwd: workspace.repoPath, workspaceId: workspace.workspaceId };
}

function visibleAgentTab(page: import("@playwright/test").Page, agentId: string) {
  return page.getByTestId(`workspace-tab-agent_${agentId}`).filter({ visible: true }).first();
}

test.describe("Composer control density across tab switches", () => {
  test.describe.configure({ timeout: 180_000 });

  test("moves live permissions into settings and applies a selection through the daemon", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "composer-settings-" });
    try {
      const agent = await seedSettledMockAgent(workspace, "Settings chat");
      await workspace.client.setAgentMode(agent.id, "legacy-mode");
      await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: agent.id });
      await expect(page.getByTestId("mode-control")).toHaveCount(0);
      await expect(
        page.getByTestId("agent-thinking-selector").filter({ visible: true }).first(),
      ).toBeVisible();
      const settings = page
        .getByTestId("agent-controls-settings")
        .filter({ visible: true })
        .first();
      await settings.click();
      await expect(page.getByTestId("agent-settings-permissions")).toBeVisible();
      await page.getByTestId("agent-settings-permissions").click();
      await page.getByTestId("agent-mode-load-test").click();
      await expect(settings).toHaveAttribute("aria-expanded", "false");
      await expectWorkspaceAgentConfiguration(workspace, {
        id: agent.id,
        provider: "mock",
        model: "ten-second-stream",
        modeId: "load-test",
      });
      await settings.click();
      await expect(page.getByTestId("agent-settings-permissions")).toContainText("Load test");
      await page.screenshot({
        path: test.info().outputPath("composer-settings.png"),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(
        page.getByTestId("agent-thinking-selector").filter({ visible: true }).first(),
      ).toBeVisible();
      await settings.click();
      await expect(page.getByTestId("agent-settings-permissions")).toBeVisible();
      await page.getByTestId("agent-settings-permissions").click();
      await page.getByTestId("agent-mode-load-test").click();
      await expect(settings).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByTestId("agent-settings-menu")).not.toBeVisible();
      await expect(page.getByText("More settings", { exact: true })).not.toBeVisible();
      await page.screenshot({
        path: test.info().outputPath("composer-compact.png"),
        animations: "disabled",
      });
    } finally {
      await workspace.cleanup();
    }
  });

  test("switching between agent tabs never paints a collapsed composer toolbar", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "composer-density-agents-" });
    try {
      const first = await seedSettledMockAgent(workspace, "First chat");
      const second = await seedSettledMockAgent(workspace, "Second chat");
      await openWorkspaceWithAgents(page, [first, second]);

      await recordComposerToolbarFrames(page);
      await visibleAgentTab(page, first.id).click();
      await page.waitForTimeout(SETTLE_MS);
      await visibleAgentTab(page, second.id).click();
      await page.waitForTimeout(SETTLE_MS);

      await expectNoCollapsedComposerToolbarFrame(page);
    } finally {
      await workspace.cleanup();
    }
  });

  test("switching between draft tabs never paints a collapsed composer toolbar", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "composer-density-drafts-" });
    try {
      await page.addInitScript(() => {
        localStorage.setItem(
          "@gravity:create-agent-preferences",
          JSON.stringify({
            provider: "mock",
            providerPreferences: { mock: { mode: "load-test", model: "ten-second-stream" } },
          }),
        );
      });
      await gotoWorkspace(page, workspace.workspaceId);
      await clickNewChat(page);

      const draftTabs = page
        .locator('[data-testid^="workspace-tab-draft"]')
        .filter({ visible: true });
      await expect(draftTabs).toHaveCount(2, { timeout: 30_000 });
      await expect(
        page.locator('[data-testid="agent-thinking-selector"]').filter({ visible: true }).first(),
      ).toBeVisible({ timeout: 30_000 });

      await recordComposerToolbarFrames(page);
      await draftTabs.nth(0).click();
      await page.waitForTimeout(SETTLE_MS);
      await draftTabs.nth(1).click();
      await page.waitForTimeout(SETTLE_MS);

      await expectNoCollapsedComposerToolbarFrame(page);
    } finally {
      await workspace.cleanup();
    }
  });
});
