import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";

interface RadarSeedClient {
  radarList(): Promise<{ radars: Array<{ id: string; channel: string; cwd: string }> }>;
  radarDelete(input: { radarId: string }): Promise<unknown>;
}

async function deleteAllRadars(workspace: SeededWorkspace): Promise<void> {
  const client = workspace.client as unknown as RadarSeedClient;
  const { radars } = await client.radarList();
  await Promise.all(
    radars.map((radar) => client.radarDelete({ radarId: radar.id }).catch(() => undefined)),
  );
}

test.describe("Radar", () => {
  let workspace: SeededWorkspace | null = null;

  test.afterEach(async () => {
    if (workspace) {
      await deleteAllRadars(workspace).catch(() => undefined);
    }
    await workspace?.cleanup();
    workspace = null;
  });

  test("setup takes a project and a channel, then the radar pauses and deletes", async ({
    page,
  }) => {
    workspace = await seedWorkspace({ repoPrefix: "radar-setup-" });

    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await page.getByTestId("sidebar-radar").click();
    await expect(page).toHaveURL(/\/radar$/);
    await expect(page.getByTestId("radar-empty")).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("radar-empty-new").click();
    await expect(page.getByTestId("radar-form-sheet")).toBeVisible({ timeout: 30_000 });
    const submit = page.getByTestId("radar-form-submit");
    await expect(submit).toBeDisabled();

    await page.getByTestId("radar-project-trigger").click();
    await page.locator('[data-testid^="radar-project-option-"]').first().click();

    // A git project offers both places to run and starts in the current directory.
    await expect(page.getByTestId("radar-isolation-trigger")).toContainText("Current directory");
    await page.getByTestId("radar-isolation-trigger").click();
    await expect(page.getByTestId("radar-isolation-option-worktree")).toBeVisible();
    await page.getByTestId("radar-isolation-option-local").click();

    // Tasks run on the provider's default model unless one is picked.
    await expect(page.getByTestId("radar-model-trigger")).toContainText("Default model");

    // A value that is not a channel keeps the form closed to submit.
    const channelInput = page.getByTestId("radar-channel-input");
    await channelInput.fill("not a channel");
    await expect(submit).toBeDisabled();
    // Keep this a channel that does not exist. On a machine with Claude Code
    // signed in, the daemon's first check reads Slack for real; a real channel
    // name here could put agents on real messages.
    await channelInput.fill("#radar-e2e");
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page.getByTestId("radar-form-sheet")).toHaveCount(0, { timeout: 30_000 });
    const row = page.locator('[data-testid^="radar-row-"]');
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    await expect(row).toContainText("#radar-e2e");
    await expect(row).toContainText("Watching");

    const client = workspace.client as unknown as RadarSeedClient;
    const { radars } = await client.radarList();
    expect(radars.map((radar) => radar.channel)).toEqual(["radar-e2e"]);
    const radarId = radars[0].id;

    // The first check may or may not have finished, so this waits for the
    // loaded history, which renders the same container with or without rows.
    // The card's own button opens history without also opening the row's editor.
    await page.getByTestId(`radar-history-${radarId}`).click();
    const history = page.getByTestId("radar-check-history-sheet");
    await expect(history).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("radar-form-sheet")).toHaveCount(0);
    await expect(history).toContainText("#radar-e2e");
    await expect(history.getByTestId("radar-check-history-list")).toBeVisible({ timeout: 30_000 });
    await history.getByRole("button", { name: "Close", exact: true }).click();
    await expect(history).toHaveCount(0, { timeout: 30_000 });

    // The Checks view lists every radar's checks in place of the radar cards.
    await page.getByTestId("radar-view-checks").click();
    const allChecks = page.getByTestId("radar-all-checks");
    await expect(allChecks.getByTestId("radar-check-history-list")).toBeVisible({
      timeout: 30_000,
    });
    await expect(row).toHaveCount(0);
    await page.getByTestId("radar-view-radars").click();
    await expect(row).toHaveCount(1, { timeout: 30_000 });

    await page.getByTestId(`radar-kebab-${radarId}`).click();
    await page.getByTestId(`radar-menu-pause-${radarId}`).click();
    await expect(row).toContainText("Paused", { timeout: 30_000 });

    page.once("dialog", (dialog) => {
      expect(dialog.message()).toContain("#radar-e2e");
      void dialog.accept();
    });
    await page.getByTestId(`radar-kebab-${radarId}`).click();
    await page.getByTestId(`radar-menu-delete-${radarId}`).click();

    await expect(page.getByTestId("radar-empty")).toBeVisible({ timeout: 30_000 });
    expect((await client.radarList()).radars).toEqual([]);
  });
});
