import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "../support/fixtures";
import { gotoWorkspace } from "../support/helpers/launcher";
import { seedWorkspace } from "../support/helpers/seed-client";
import {
  openChangesTreePanel,
  waitForWorkspaceTabsVisible,
} from "../support/helpers/workspace-tabs";

const CHANGES_SHORTCUT = `${process.platform === "darwin" ? "Meta" : "Control"}+Shift+G`;
const DIFF_SHORTCUT = `${process.platform === "darwin" ? "Meta" : "Control"}+D`;

test("Diff shortcut opens uncommitted changes and reuses the tab", async ({
  page,
  withWorkspace,
}) => {
  const workspace = await withWorkspace({ prefix: "diff-shortcut-" });
  const gitOptions = { cwd: workspace.repoPath, stdio: "ignore" as const };
  execFileSync("git", ["checkout", "-b", "feature"], gitOptions);
  await writeFile(path.join(workspace.repoPath, "committed.txt"), "branch change\n");
  execFileSync("git", ["add", "committed.txt"], gitOptions);
  execFileSync("git", ["commit", "-m", "Add branch change"], gitOptions);
  await writeFile(path.join(workspace.repoPath, "uncommitted.txt"), "working change\n");

  await page.setViewportSize({ width: 1400, height: 900 });
  await workspace.navigateTo();
  await openChangesTreePanel(page);
  const tree = page.getByTestId("changes-tree-panel").filter({ visible: true });
  const mode = tree.getByTestId("changes-diff-mode-control").locator('[aria-selected="true"]');
  await expect(mode).toContainText("Uncommitted");
  await expect(page.getByTestId("workspace-tab-working_diff")).toHaveCount(0);

  await page.keyboard.press(DIFF_SHORTCUT);

  const panel = page.getByTestId("working-diff-panel").filter({ visible: true });
  await expect(panel).toBeVisible();
  await expect(mode).toContainText("Uncommitted");
  await expect(panel.getByTestId("diff-file-0")).toHaveAccessibleName("uncommitted.txt, +1, -0");
  await expect(page.getByTestId("workspace-tab-working_diff")).toHaveCount(1);

  await page.getByTestId("changes-diff-mode-committed").click();
  await expect(mode).toContainText("Committed");
  await expect(panel.getByTestId("diff-file-0")).toHaveAccessibleName("committed.txt, +1, -0");
  await page.keyboard.press(DIFF_SHORTCUT);
  await expect(mode).toContainText("Uncommitted");
  await expect(panel.getByTestId("diff-file-0")).toHaveAccessibleName("uncommitted.txt, +1, -0");
  await expect(page.getByTestId("workspace-tab-working_diff")).toHaveCount(1);
});

test("Diff shortcut opens committed changes for a clean checkout", async ({
  page,
  withWorkspace,
}) => {
  const workspace = await withWorkspace({ prefix: "diff-shortcut-clean-" });
  const gitOptions = { cwd: workspace.repoPath, stdio: "ignore" as const };
  execFileSync("git", ["checkout", "-b", "feature"], gitOptions);
  await writeFile(path.join(workspace.repoPath, "committed.txt"), "branch change\n");
  execFileSync("git", ["add", "committed.txt"], gitOptions);
  execFileSync("git", ["commit", "-m", "Add branch change"], gitOptions);

  await page.setViewportSize({ width: 1400, height: 900 });
  await workspace.navigateTo();
  await openChangesTreePanel(page);
  const tree = page.getByTestId("changes-tree-panel").filter({ visible: true });
  await expect(
    tree.getByTestId("changes-diff-mode-control").locator('[aria-selected="true"]'),
  ).toContainText("Committed");

  await page.keyboard.press(DIFF_SHORTCUT);

  const panel = page.getByTestId("working-diff-panel").filter({ visible: true });
  await expect(panel.getByTestId("diff-file-0")).toHaveAccessibleName("committed.txt, +1, -0");
});

test("Changes shortcut reveals the Changes tree in Explorer", async ({ page }) => {
  const workspace = await seedWorkspace({ repoPrefix: "changes-shortcut-explorer-" });

  try {
    await page.setViewportSize({ width: 1400, height: 900 });
    await gotoWorkspace(page, workspace.workspaceId);
    await waitForWorkspaceTabsVisible(page);

    await page.keyboard.press(CHANGES_SHORTCUT);

    const explorer = page.getByTestId("workspace-explorer-sidebar").filter({ visible: true });
    await expect(explorer.getByTestId("explorer-sidebar-tab-changes_tree")).toBeVisible({
      timeout: 30_000,
    });
    await expect(explorer.getByTestId("changes-tree-panel")).toBeVisible();
    await expect(page.getByTestId("workspace-tab-working_diff")).toHaveCount(0);
  } finally {
    await workspace.cleanup();
  }
});
