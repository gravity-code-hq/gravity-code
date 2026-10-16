import {
  buildLinearIssuePrompt,
  buildLinearIssueWorkspaceName,
} from "../../src/linear/issue-prompt";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { DaemonClient } from "@gravity/client/internal/daemon-client";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { seedWorkspace } from "../support/helpers/seed-client";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";

// Run against a Linear account with multiple teams, at least 100 issues, and 100 matches for "a".
// The key is copied into the isolated test daemon; no Linear issues are modified.
test("Linear pages, retries failures, and resets pagination when the query changes", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const sourceHome = path.resolve(
    process.env.E2E_FORK_GRAVITY_HOME_FROM ?? "../../.dev/gravity-home",
  );
  const connection = z
    .object({ apiKey: z.string() })
    .parse(JSON.parse(await readFile(path.join(sourceHome, "linear.json"), "utf8")));
  const workspace = await seedWorkspace({ repoPrefix: "linear-pagination-" });
  const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "linear-pagination" });
  try {
    await client.linearConnect({ apiKey: connection.apiKey });
    await page.emulateMedia({ colorScheme: "dark" });
    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await page.getByTestId("sidebar-linear").click();
    await page.getByTestId("linear-filter-all").click();

    const rows = page.getByTestId(/^linear-issue-row-/);
    const previous = page.getByTestId("linear-page-previous");
    const next = page.getByTestId("linear-page-next");
    const range = page.getByTestId("linear-page-range");
    const pageNumber = page.getByTestId("linear-page-number");
    await expect(rows).toHaveCount(50);
    await expect(pageNumber).toHaveText("Page 1");
    await expect(previous).toBeDisabled();
    await expect(range).toHaveText("1–50 issues");
    const firstIds = await rows.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-testid")),
    );

    await client.linearDisconnect();
    await next.click();
    await expect(pageNumber).toHaveText("Page 2");
    await expect(page.getByText("Unable to load issues", { exact: true })).toBeVisible();
    await expect(previous).toBeEnabled();
    await expect(next).toBeDisabled();
    await expect(range).toHaveText("—");
    await client.linearConnect({ apiKey: connection.apiKey });
    await page.getByTestId("linear-issues-retry").click();
    await expect(rows).toHaveCount(50);
    await expect(range).toHaveText("51–100 issues");
    const secondIds = await rows.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-testid")),
    );
    expect(secondIds.filter((id) => firstIds.includes(id))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("linear-page-2.png") });

    await previous.click();
    await expect(pageNumber).toHaveText("Page 1");
    await expect(rows).toHaveCount(50);
    expect(
      await rows.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-testid")),
      ),
    ).toEqual(firstIds);
    await next.click();
    await expect(pageNumber).toHaveText("Page 2");
    await page.getByTestId("linear-filter-created").click();
    await expect(pageNumber).toHaveText("Page 1");
    await expect(previous).toBeDisabled();

    await page.getByTestId("linear-filter-all").click();
    await expect(next).toBeEnabled();
    await next.click();
    await expect(pageNumber).toHaveText("Page 2");
    const teams = await client.linearListTeams();
    await page.getByTestId("linear-team-filter-trigger").click();
    await page.getByTestId(`linear-team-filter-${teams.teams[0].key}`).click();
    await expect(pageNumber).toHaveText("Page 1");
    await expect(previous).toBeDisabled();
    await page.getByTestId("linear-team-filter-trigger").click();
    await page.getByTestId("linear-team-filter-all").click();
    await expect(next).toBeEnabled();
    await next.click();
    await expect(pageNumber).toHaveText("Page 2");

    await page.getByTestId("linear-search").fill("a");
    await expect(pageNumber).toHaveText("Page 1");
    await expect(rows).toHaveCount(50);
    await expect(next).toBeEnabled();
    await next.click();
    await expect(pageNumber).toHaveText("Page 2");
    await expect(rows).toHaveCount(50);

    await page.getByTestId("linear-search").fill("zzzzxqvjqkz938271");
    await expect(pageNumber).toHaveText("Page 1");
    await expect(page.getByText("No issues match your search", { exact: true })).toBeVisible();
    await expect(range).toHaveText("No issues");
    await expect(previous).toBeDisabled();
    await expect(next).toBeDisabled();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId("linear-search").fill("");
    await expect(rows).toHaveCount(50);
    await expect(page.getByTestId("linear-pagination")).toBeInViewport();
    await expect(range).toHaveText("1–50 issues");
    await expect(previous).toBeInViewport();
    await expect(next).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("linear-pagination-compact.png") });
  } finally {
    await client.close();
    await workspace.cleanup();
  }
});

test("Linear Start agent reviews the full prompt and workspace before creating anything", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const sourceHome = path.resolve(
    process.env.E2E_FORK_GRAVITY_HOME_FROM ?? "../../.dev/gravity-home",
  );
  const connection = z
    .object({ apiKey: z.string() })
    .parse(JSON.parse(await readFile(path.join(sourceHome, "linear.json"), "utf8")));
  const workspace = await seedWorkspace({ repoPrefix: "linear-start-" });
  const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "linear-start" });
  try {
    await client.linearConnect({ apiKey: connection.apiKey });
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.emulateMedia({ colorScheme: "dark" });
    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await page.getByTestId("sidebar-linear").click();
    await page.getByTestId("linear-filter-all").click();
    const row = page.getByTestId(/^linear-issue-row-/).first();
    await expect(row).toBeVisible();
    const identifier = (await row.getAttribute("data-testid"))!.replace("linear-issue-row-", "");
    const issues = await client.linearListIssues({ filter: "all", limit: 50 });
    const issue = issues.issues.find((entry) => entry.identifier === identifier)!;
    const detail = await client.linearGetIssue({ issueId: issue.id });
    const before = await client.fetchWorkspaces({ filter: { projectId: workspace.projectId } });
    await row.getByTestId(`linear-issue-start-agent-${identifier}`).click();
    const sheet = page.getByTestId("linear-start-sheet");
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId("linear-start-existing")).toBeVisible();
    await expect(page.getByTestId("linear-start-new-worktree")).toHaveText("New worktree");
    await expect(page.getByTestId("linear-start-workspace")).toBeVisible();
    await expect(page.getByTestId("linear-start-workspace")).toBeDisabled();
    await page.getByTestId("linear-start-new-worktree").click();
    await expect(page.getByTestId("linear-start-workspace")).not.toBeVisible();
    await page.getByTestId("linear-start-existing").click();
    await expect(page.getByTestId("linear-start-workspace")).toBeVisible();
    const dialog = sheet.getByRole("dialog");
    const initialBounds = await dialog.boundingBox();
    const labelColor = await sheet
      .getByText("Repository", { exact: true })
      .evaluate((element) => getComputedStyle(element).color);
    await expect(page.getByTestId("linear-start-issue-identifier")).toHaveCSS("color", labelColor);
    await expect(page.getByTestId("linear-issue-sheet")).not.toBeVisible();
    await expect(page.getByTestId("linear-start-submit")).toBeDisabled();
    await expect(page.getByTestId("linear-start-prompt")).toHaveValue(
      buildLinearIssuePrompt(detail.issue),
    );
    await page.getByTestId("linear-start-prompt").fill("Review this task without making changes.");
    await page.getByTestId("linear-start-repo").click();
    await page
      .getByTestId(/^linear-start-repo-/)
      .filter({ hasText: workspace.projectDisplayName })
      .click();
    await expect(page.getByTestId("linear-start-new-worktree")).toBeVisible();
    await expect(page.getByTestId("linear-start-workspace")).toBeVisible();
    await expect(page.getByTestId("linear-start-workspace")).toBeEnabled();
    await expect.poll(() => dialog.boundingBox()).toEqual(initialBounds);
    // No workspace picked starts in the repository checkout.
    await expect(page.getByTestId("linear-start-workspace")).toContainText(
      "Repository checkout (current branch)",
    );
    await expect(page.getByTestId("linear-start-submit")).toBeEnabled();
    await page.getByTestId("linear-start-workspace").click();
    await page.getByTestId(`linear-start-workspace-${workspace.workspaceId}`).click();
    await expect(page.getByTestId("linear-start-workspace")).toContainText(workspace.workspaceName);
    await expect.poll(() => dialog.boundingBox()).toEqual(initialBounds);
    await page.getByTestId("linear-start-new-worktree").click();
    await expect(page.getByTestId("linear-start-workspace")).not.toBeVisible();
    await expect.poll(() => dialog.boundingBox()).toEqual(initialBounds);
    await page.getByTestId("linear-start-existing").click();
    await expect(page.getByTestId("linear-start-workspace")).toBeVisible();
    await expect.poll(() => dialog.boundingBox()).toEqual(initialBounds);
    await expect(page.getByTestId("linear-start-prompt")).toHaveValue(
      "Review this task without making changes.",
    );
    await page.screenshot({ path: testInfo.outputPath("linear-start-existing-workspace.png") });
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
    await expect(sheet).not.toBeVisible();
    const after = await client.fetchWorkspaces({ filter: { projectId: workspace.projectId } });
    expect(after.entries.map((entry) => entry.id)).toEqual(before.entries.map((entry) => entry.id));
    await row.getByTestId(`linear-issue-start-agent-${identifier}`).click();
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId("linear-start-prompt")).toHaveValue(
      buildLinearIssuePrompt(detail.issue),
    );
    await expect(page.getByTestId("linear-start-repo")).toContainText("Choose a repo");
    await page.screenshot({ path: testInfo.outputPath("linear-start-setup.png") });
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
    await row.getByTestId(`linear-issue-menu-${identifier}`).click();
    await page.getByTestId(`linear-issue-menu-start-${identifier}`).hover();
    await expect(
      page
        .getByTestId(new RegExp(`^linear-issue-menu-start-${identifier}-`))
        .filter({ hasText: workspace.projectDisplayName }),
    ).toBeVisible();
    await expect(sheet).not.toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await row.getByTestId(`linear-issue-start-agent-${identifier}`).click();
    await page.getByTestId("linear-start-repo").click();
    await page
      .getByTestId(/^linear-start-repo-/)
      .filter({ hasText: workspace.projectDisplayName })
      .click();
    await page.getByTestId("linear-start-existing").click();
    await page.getByTestId("linear-start-workspace").click();
    await page.getByTestId(`linear-start-workspace-${workspace.workspaceId}`).click();
    // Use the isolated daemon's deterministic provider, never a real ticket execution.
    await page.getByTestId("linear-start-model").click();
    await page.getByText("mock · Ten second stream", { exact: true }).last().click();
    await page
      .getByTestId("linear-start-prompt")
      .fill("Verify starting in the existing workspace.");
    await page.getByTestId("linear-start-submit").click();
    await expect(page).toHaveURL(new RegExp(`/workspace/${workspace.workspaceId}`));
    await expect(sheet).not.toBeVisible();
    const afterExistingStart = await client.fetchWorkspaces({
      filter: { projectId: workspace.projectId },
    });
    expect(afterExistingStart.entries.map((entry) => entry.id)).toEqual(
      before.entries.map((entry) => entry.id),
    );

    await page.getByTestId("sidebar-linear").click();
    await page.getByTestId("linear-filter-all").click();
    await page
      .getByTestId(/^linear-issue-start-agent-/)
      .first()
      .click();
    await page.getByTestId("linear-start-repo").click();
    await page
      .getByTestId(/^linear-start-repo-/)
      .filter({ hasText: workspace.projectDisplayName })
      .click();
    await page.getByTestId("linear-start-new-worktree").click();
    await page.getByTestId("linear-start-prompt").fill("Verify starting in a new worktree.");
    await page.getByTestId("linear-start-submit").click();
    await expect(sheet).not.toBeVisible();
    const afterNewStart = await client.fetchWorkspaces({
      filter: { projectId: workspace.projectId },
    });
    expect(afterNewStart.entries).toHaveLength(before.entries.length + 1);
    const created = afterNewStart.entries.find((entry) => entry.id !== workspace.workspaceId)!;
    expect(created.workspaceKind).toBe("worktree");
    expect(path.basename(created.workspaceDirectory)).toBe(buildLinearIssueWorkspaceName(issue));
    expect(created.name).toBe(buildLinearIssueWorkspaceName(issue));
    await expect(page).toHaveURL(new RegExp(`/workspace/${created.id}`));
  } finally {
    await client.close();
    await workspace.cleanup();
  }
});
