import path from "node:path";
import { execFileSync } from "node:child_process";
import { test, expect } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";

function workspaceRowTestId(workspaceId: string): string {
  return `sidebar-workspace-row-${getServerId()}:${workspaceId}`;
}

test.describe("Workspace names follow repository and branch", () => {
  test("ignores a saved chat title and follows branch changes in the sidebar and header", async ({
    page,
  }, testInfo) => {
    const workspace = await seedWorkspace({ repoPrefix: "workspace-name-" });
    try {
      const created = await workspace.client.createWorkspace({
        source: { kind: "directory", path: workspace.repoPath, projectId: workspace.projectId },
        title: "Review uncommitted changes",
      });
      if (!created.workspace) throw new Error(created.error ?? "Workspace missing");
      const id = created.workspace.id;
      const projectName = path.basename(workspace.repoPath);
      await gotoAppShell(page);
      const row = page.getByTestId(workspaceRowTestId(id));
      await expect(row).toContainText(`${projectName}: main`);
      await row.click();
      const header = page.getByTestId("workspace-header-title");
      await expect(header).toHaveText(`${projectName}: main`);
      await expect(page.getByText("Review uncommitted changes", { exact: true })).toHaveCount(0);
      await row.hover();
      await page.getByTestId(`sidebar-workspace-kebab-${getServerId()}:${id}`).click();
      await expect(
        page.getByTestId(`sidebar-workspace-menu-rename-${getServerId()}:${id}`),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
      execFileSync("git", ["checkout", "-b", "feature/sidebar"], { cwd: workspace.repoPath });
      await workspace.client.checkoutRefresh(workspace.repoPath);
      await expect(row).toContainText(`${projectName}: feature/sidebar`);
      await expect(header).toHaveText(`${projectName}: feature/sidebar`);
      await page.reload();
      await expect(header).toHaveText(`${projectName}: feature/sidebar`);
      await page.screenshot({ path: testInfo.outputPath("repo-branch-name.png") });
    } finally {
      await workspace.cleanup();
    }
  });

  test("a worktree inside a repository keeps the repository name and uses its own branch", async ({
    page,
  }, testInfo) => {
    const workspace = await seedWorkspace({ repoPrefix: "workspace-worktree-name-" });
    const worktreePath = path.join(workspace.repoPath, ".worktrees", "sidebar");
    try {
      execFileSync("git", ["worktree", "add", "-b", "feature/sidebar", worktreePath, "main"], {
        cwd: workspace.repoPath,
      });
      const created = await workspace.client.createWorkspace({
        source: { kind: "directory", path: worktreePath, projectId: workspace.projectId },
        title: "Old generated worktree title",
      });
      if (!created.workspace) throw new Error(created.error ?? "Worktree workspace missing");
      await gotoAppShell(page);
      const row = page.getByTestId(workspaceRowTestId(created.workspace.id));
      const label = `${path.basename(workspace.repoPath)}: feature/sidebar`;
      await expect(row).toContainText(label);
      await row.click();
      await expect(page.getByTestId("workspace-header-title")).toHaveText(label);
      await page.screenshot({ path: testInfo.outputPath("worktree-branch-name.png") });
    } finally {
      await workspace.cleanup();
    }
  });
});
