import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Locator } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import { openChangesPanel, openChangesTreePanel } from "../support/helpers/workspace-tabs";

const COMMIT_SUBJECT = "Show commit timestamps";

test("commit history explains when the workspace has no commits ahead of its base", async ({
  page,
  withWorkspace,
}) => {
  const workspace = await withWorkspace({ prefix: "commit-history-empty-workspace-" });
  execFileSync("git", ["checkout", "-b", "feature"], { cwd: workspace.repoPath, stdio: "ignore" });
  await workspace.navigateTo();

  await openChangesTreePanel(page);
  const commitsSection = page.getByRole("button", { name: /Commits/i });
  await expect(commitsSection).toBeVisible({ timeout: 30_000 });
  await commitsSection.click();

  await expect(page.getByTestId("commits-section-no-workspace-commits")).toHaveText(
    "No commits ahead of main yet",
    { timeout: 30_000 },
  );
});

test("commit history shows dates and shares diff layout preferences", async ({
  page,
  withWorkspace,
}) => {
  const workspace = await withWorkspace({ prefix: "commit-diff-panel-" });
  await createFeatureCommit(workspace.repoPath);
  await page.setViewportSize({ width: 1400, height: 900 });
  await workspace.navigateTo();

  await openChangesTreePanel(page);
  const commitsSection = page.getByRole("button", { name: /Commits/i });
  await expect(commitsSection).toBeVisible({ timeout: 30_000 });
  await commitsSection.click();

  const commitRow = page.locator('[data-testid^="commit-row-"]').filter({
    hasText: COMMIT_SUBJECT,
  });
  await expect(commitRow).toContainText(COMMIT_SUBJECT, { timeout: 30_000 });
  await expect(page.locator('[data-testid^="commit-row-"]')).toHaveCount(1);
  await expect(commitRow).toContainText("Jan 15");
  await commitRow.click();

  const panel = page.getByTestId("commit-diff-panel").filter({ visible: true });
  await expect(panel.getByTestId("commit-diff-toolbar")).toBeVisible({ timeout: 30_000 });
  const layoutToggle = panel.getByTestId("commit-diff-toggle-layout");
  const [commitToolbarBox, layoutToggleBox, layoutToggleGlyphBox] = await Promise.all([
    panel.getByTestId("commit-diff-header").boundingBox(),
    layoutToggle.boundingBox(),
    layoutToggle.locator("svg").boundingBox(),
  ]);
  if (!commitToolbarBox || !layoutToggleBox || !layoutToggleGlyphBox) {
    throw new Error("Commit-diff toolbar geometry could not be measured");
  }
  expect(commitToolbarBox.height).toBe(36);
  expect(layoutToggleBox.width).toBe(20);
  expect(layoutToggleBox.height).toBe(20);
  expect(layoutToggleGlyphBox.width).toBe(14);
  expect(layoutToggleGlyphBox.height).toBe(14);
  await expect(layoutToggle).toHaveAccessibleName("Switch to side-by-side diff");
  await expect(panel.getByTestId("git-diff-canvas")).toBeVisible({ timeout: 30_000 });
  await expectCommitDiffHeaderGeometry(panel);
  await panel.getByTestId("diff-file-0-toggle").click();
  await expect(panel.getByTestId("diff-file-0-toggle")).toHaveAttribute("aria-expanded", "false");
  await panel.getByTestId("diff-file-0-toggle").click();
  await expect(panel.getByTestId("diff-file-0-toggle")).toHaveAttribute("aria-expanded", "true");

  await layoutToggle.click();
  await expect(layoutToggle).toHaveAccessibleName("Switch to unified diff");
  await expect(panel.locator('[data-testid^="diff-code-row-"]')).toHaveCount(0);
  await expect(panel.getByTestId("diff-file-0-body")).toBeVisible();

  await page.getByTestId(/^workspace-tab-commit_diff_/).hover();
  await page.getByTestId(/^workspace-commit-diff-close-/).click();
  await expect(panel).toHaveCount(0);
  await commitRow.click();
  await expect(panel.getByTestId("commit-diff-toggle-layout")).toHaveAccessibleName(
    "Switch to unified diff",
    { timeout: 30_000 },
  );

  await page.setViewportSize({ width: 480, height: 900 });
  await expect(panel.getByTestId("commit-diff-toolbar")).toHaveCount(0);
  await expect(panel.getByTestId("git-diff-canvas")).toBeVisible();
});

async function createFeatureCommit(repoPath: string): Promise<void> {
  execFileSync("git", ["checkout", "-b", "feature"], { cwd: repoPath, stdio: "ignore" });
  await writeFile(path.join(repoPath, "feature.txt"), "before\nafter\n");
  execFileSync("git", ["add", "feature.txt"], { cwd: repoPath, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", COMMIT_SUBJECT], {
    cwd: repoPath,
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2020-01-15T12:00:00Z",
      GIT_COMMITTER_DATE: "2020-01-15T12:00:00Z",
    },
  });
}

async function expectCommitDiffHeaderGeometry(panel: Locator): Promise<void> {
  const [header, canvas] = await Promise.all([
    panel.getByTestId("diff-file-0").boundingBox(),
    panel.getByTestId("git-diff-sticky-header-0").boundingBox(),
  ]);
  expect(header).not.toBeNull();
  expect(canvas).not.toBeNull();
  expect(header!.height).toBeCloseTo(40, 0);
  expect(header!.x).toBeCloseTo(canvas!.x, 0);
  expect(header!.width).toBeCloseTo(canvas!.width, 0);
  expect(header!.y).toBeCloseTo(canvas!.y, 0);
  await expect(panel.getByTestId("diff-file-0")).toHaveAccessibleName("feature.txt, +2, -0");
}

test("working diff keeps file sections aligned when collapsed and wrapped", async ({
  page,
  withWorkspace,
}, testInfo) => {
  const workspace = await withWorkspace({ prefix: "diff-sections-" });
  await mkdir(path.join(workspace.repoPath, "src"), { recursive: true });
  const before = [
    "export function screenAccounts(accounts: Account[]) {",
    "  const results = [];",
    "  for (const account of accounts) {",
    "    const result = screenAccount(account);",
    "    results.push(result);",
    "  }",
    "  return results;",
    "}",
    "",
    "export function formatResult(result: ScreeningResult) {",
    "  return result.status;",
    "}",
    "",
  ].join("\n");
  await writeFile(path.join(workspace.repoPath, "src/screening.ts"), before);
  await writeFile(path.join(workspace.repoPath, "src/config.ts"), "export const retryLimit = 2;\n");
  execFileSync("git", ["add", "."], { cwd: workspace.repoPath });
  execFileSync("git", ["commit", "-m", "Add screening"], { cwd: workspace.repoPath });
  await writeFile(
    path.join(workspace.repoPath, "src/screening.ts"),
    before
      .replace(
        "  const results = [];",
        "  const results: ScreeningResult[] = [];\n  const screened = new Set<string>();",
      )
      .replace(
        "    const result = screenAccount(account);",
        "    if (screened.has(account.id)) continue;\n    const result = screenAccount(account);\n    screened.add(account.id);",
      )
      .replace("  return result.status;", "  return `${result.status}: ${result.accountId}`;"),
  );
  await writeFile(
    path.join(workspace.repoPath, "src/config.ts"),
    "export const retryLimit = 3;\nexport const timeoutMs = 5_000;\n",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await workspace.navigateTo();
  await openChangesPanel(page);
  const panel = page.getByTestId("working-diff-panel").filter({ visible: true });
  const first = panel.getByTestId("diff-file-0-toggle");
  const second = panel.getByTestId("diff-file-1-toggle");
  await expect(second).toBeVisible();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  const expandedTop = (await second.boundingBox())!.y;
  await first.click();
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect.poll(async () => (await second.boundingBox())!.y).toBeLessThan(expandedTop);
  expect((await second.boundingBox())!.y - (await first.boundingBox())!.y).toBe(52);
  await first.click();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await expect.poll(async () => (await second.boundingBox())!.y).toBe(expandedTop);
  await page.screenshot({ path: testInfo.outputPath("diff-sections-desktop.png") });
  await panel.getByTestId("changes-toggle-wrap-lines").click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect
    .poll(() =>
      panel.getByTestId("git-diff-canvas").evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        return canvas.getContext("2d")!.getImageData(0, canvas.height - 1, 1, 1).data[0];
      }),
    )
    .toBeLessThan(100);
  await page.screenshot({ path: testInfo.outputPath("diff-sections-dark.png") });
  await page.setViewportSize({ width: 480, height: 900 });
  await expect(panel.getByTestId("git-diff-canvas")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("diff-sections-compact.png") });
});
