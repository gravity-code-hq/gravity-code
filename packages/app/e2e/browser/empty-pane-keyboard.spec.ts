import { expect, type Locator, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "../support/fixtures";
import { runWorkspaceActionFromCommandCenter } from "../support/helpers/command-center-workspace-actions";
import { gotoWorkspace } from "../support/helpers/launcher";
import { seedWorkspace } from "../support/helpers/seed-client";
import {
  ensureExplorerSidebar,
  waitForWorkspaceTabsVisible,
} from "../support/helpers/workspace-tabs";

function visibleNewTabPanel(page: Page): Locator {
  return page.getByTestId("workspace-new-tab-panel").filter({ visible: true });
}

async function expectLauncherSelection(launcher: Locator, name: string): Promise<void> {
  await expect(launcher.getByRole("button", { name, exact: true })).toBeFocused();
}

async function openExplorerWithKeyboard(page: Page): Promise<Locator> {
  const shortcut = process.platform === "darwin" ? "Meta+M" : "Control+E";
  await page.keyboard.press(shortcut);
  const explorer = page.getByTestId("workspace-explorer-sidebar").filter({ visible: true });
  await expect(explorer).toBeVisible({ timeout: 30_000 });
  return explorer;
}

test.describe("New tab keyboard launcher", () => {
  test("Cmd+D shows uncommitted changes on main and reuses the tab", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "diff-keyboard-" });
    const modifier = process.platform === "darwin" ? "Meta" : "Control";

    try {
      await writeFile(path.join(workspace.repoPath, "uncommitted.txt"), "Uncommitted change\n");
      await workspace.client.checkoutRefresh(workspace.repoPath);

      await gotoWorkspace(page, workspace.workspaceId);
      await waitForWorkspaceTabsVisible(page);
      const explorer = await ensureExplorerSidebar(page);
      const mode = explorer
        .getByTestId("changes-diff-mode-control")
        .locator('[aria-selected="true"]');
      await expect(mode).toHaveText("Uncommitted");
      await page.keyboard.press(`${modifier}+d`);

      const diff = page.getByTestId("working-diff-panel").filter({ visible: true });
      await expect(diff).toBeVisible({ timeout: 30_000 });
      await expect(mode).toHaveText("Uncommitted");
      await expect(diff.getByTestId("diff-file-0")).toHaveAccessibleName("uncommitted.txt, +1, -0");

      await expect(page.getByTestId("changes-diff-mode-committed")).toHaveAccessibleName(
        "Committed",
      );
      await page.getByTestId("changes-diff-mode-committed").click();
      await expect(mode).toHaveText("Committed");
      await expect(diff.getByText("No changes to display", { exact: true })).toBeVisible();

      await page.keyboard.press(`${modifier}+d`);
      await expect(mode).toHaveText("Uncommitted");
      await expect(diff.getByTestId("diff-file-0")).toHaveAccessibleName("uncommitted.txt, +1, -0");
      await expect(page.getByTestId("workspace-tab-working_diff")).toHaveCount(1);
    } finally {
      await workspace.cleanup();
    }
  });

  test("Explorer shortcut shows and hides the repository Changes tree", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "explorer-keyboard-" });

    try {
      await gotoWorkspace(page, workspace.workspaceId);
      await waitForWorkspaceTabsVisible(page);

      const explorer = await openExplorerWithKeyboard(page);
      await expect(explorer.getByTestId("explorer-sidebar-tab-changes_tree")).toBeVisible();
      await expect(explorer.getByTestId("changes-tree-panel")).toBeVisible();
      await page.keyboard.press(process.platform === "darwin" ? "Meta+M" : "Control+E");
      await expect(explorer).not.toBeVisible();
      await openExplorerWithKeyboard(page);
      await expect(explorer.getByTestId("changes-tree-panel")).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });

  test("a new split pane focuses its launcher and supports arrow navigation", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "empty-pane-split-keyboard-" });

    try {
      await gotoWorkspace(page, workspace.workspaceId);
      await waitForWorkspaceTabsVisible(page);
      await runWorkspaceActionFromCommandCenter(page, "Split pane right");

      const launcher = visibleNewTabPanel(page);
      await expect(launcher).toBeVisible({ timeout: 30_000 });
      await expectLauncherSelection(launcher, "Agent");

      await page.keyboard.press("ArrowDown");
      await expectLauncherSelection(launcher, "Terminal");
      await page.keyboard.press("ArrowDown");
      await expectLauncherSelection(launcher, "Diff");
      await page.keyboard.press("Enter");

      await expect(
        page.getByTestId("workspace-tab-working_diff").filter({ visible: true }),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await workspace.cleanup();
    }
  });
});
