import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { addScheduleHostAndReload, createScheduleHost } from "../support/helpers/schedule-host";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { projectEquivalenceViewKey } from "../support/helpers/project-view-key";
import { escapeRegex } from "../support/helpers/regex";
import { expectSettled, expectStableHeight } from "../support/helpers/settled";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";
import { buildSchedulesRoute } from "../../src/utils/host-routes";

const MOBILE_SHEET_VIEWPORT = { width: 390, height: 844 };

interface ScheduleListItem {
  id: string;
  name: string | null;
  cadence?: { type: "cron"; expression: string };
  target: {
    type: string;
    config?: {
      cwd?: string;
      archiveOnFinish?: boolean;
      isolation?: "local" | "worktree";
    };
  };
}

interface ScheduleSeedClient {
  scheduleList(): Promise<{ schedules: ScheduleListItem[]; error: string | null }>;
  scheduleDelete(input: { id: string }): Promise<{ error: string | null }>;
}

async function selectModelByLabel(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: /select model/i }).click();
  const popup = page.getByTestId("combobox-desktop-container");
  await expect(popup).toBeVisible({ timeout: 30_000 });
  const searchInput = page.getByTestId("model-search-input").first();
  await expect(searchInput).toBeVisible({ timeout: 30_000 });
  await searchInput.fill(label);
  const option = popup.getByText(new RegExp(`^${escapeRegex(label)}$`, "i")).first();
  await expect(option).toBeVisible({ timeout: 30_000 });
  await option.click();
  await expect(popup).toHaveCount(0, { timeout: 30_000 });
}

async function deleteScheduleByName(workspace: SeededWorkspace, name: string): Promise<void> {
  const client = workspace.client as unknown as ScheduleSeedClient;
  const list = await client.scheduleList();
  const schedule = list.schedules.find((candidate) => candidate.name === name);
  if (schedule) {
    await client.scheduleDelete({ id: schedule.id }).catch(() => undefined);
  }
}

async function expectScheduleCreatedForProject(input: {
  workspace: SeededWorkspace;
  name: string;
  cadenceExpression: string;
}): Promise<void> {
  const client = input.workspace.client as unknown as ScheduleSeedClient;
  const list = await client.scheduleList();
  const schedule = list.schedules.find((candidate) => candidate.name === input.name);
  expect(schedule).toEqual(
    expect.objectContaining({
      name: input.name,
      cadence: expect.objectContaining({
        type: "cron",
        expression: input.cadenceExpression,
      }),
      target: expect.objectContaining({
        type: "new-agent",
        config: expect.objectContaining({
          cwd: input.workspace.repoPath,
        }),
      }),
    }),
  );
}

async function expectScheduleKnobs(input: {
  workspace: SeededWorkspace;
  name: string;
  archiveOnFinish: boolean;
  isolation: "local" | "worktree";
}): Promise<void> {
  const client = input.workspace.client as unknown as ScheduleSeedClient;
  const list = await client.scheduleList();
  const schedule = list.schedules.find((candidate) => candidate.name === input.name);
  expect(schedule).toEqual(
    expect.objectContaining({
      name: input.name,
      target: expect.objectContaining({
        type: "new-agent",
        config: expect.objectContaining({
          archiveOnFinish: input.archiveOnFinish,
          isolation: input.isolation,
        }),
      }),
    }),
  );
}

async function openNewScheduleSheet(page: Page): Promise<void> {
  await page.getByTestId("schedules-empty-new").click();
  const formSheet = page.getByTestId("schedule-form-sheet");
  await expect(formSheet).toBeVisible({ timeout: 10_000 });
  await expectStableHeight(formSheet);
}

function bottomSheetBackdrop(page: Page) {
  return page.getByRole("button", { name: "Bottom sheet backdrop" }).first();
}

async function dismissScheduleSheetWithBackdrop(page: Page): Promise<void> {
  const backdrop = bottomSheetBackdrop(page);
  await expect(backdrop).toBeVisible({ timeout: 10_000 });
  await expect(async () => {
    const box = await backdrop.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + 24);
    }
    await expect(backdrop).not.toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

async function expectScheduleSheetClosedAndStable(page: Page): Promise<void> {
  const formSheet = page.getByTestId("schedule-form-sheet");
  await expect(formSheet).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(500);
  await expect(formSheet).toHaveCount(0, { timeout: 1_000 });
}

async function findScheduleIdByName(workspace: SeededWorkspace, name: string): Promise<string> {
  const client = workspace.client as unknown as ScheduleSeedClient;
  const list = await client.scheduleList();
  const schedule = list.schedules.find((candidate) => candidate.name === name);
  if (!schedule) {
    throw new Error(`Expected schedule named ${name} to exist`);
  }
  return schedule.id;
}

test.describe("Schedules project target", () => {
  const cleanupTasks: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    for (const cleanup of cleanupTasks.toReversed()) {
      await cleanup();
    }
    cleanupTasks.length = 0;
  });

  test("dismisses the new schedule sheet without reopening", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "schedule-sheet-dismiss-", git: false });
    cleanupTasks.push(() => workspace.cleanup());

    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await page.goto(buildSchedulesRoute());
    await page.setViewportSize(MOBILE_SHEET_VIEWPORT);
    await expect(page.getByTestId("schedules-empty-new")).toBeVisible({ timeout: 30_000 });

    await openNewScheduleSheet(page);
    await dismissScheduleSheetWithBackdrop(page);
    await expectScheduleSheetClosedAndStable(page);
    await expect(page.getByTestId("schedules-empty-new")).toBeVisible({ timeout: 30_000 });

    await openNewScheduleSheet(page);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expectScheduleSheetClosedAndStable(page);
  });

  test("creates a schedule from a project picker instead of a raw CWD selector", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "schedule-project-target-", git: false });
    cleanupTasks.push(() => workspace.cleanup());
    const scheduleName = `Project schedule ${Date.now()}`;
    cleanupTasks.push(() => deleteScheduleByName(workspace, scheduleName));

    await gotoAppShell(page);
    await waitForSidebarHydration(page);

    await page.getByRole("button", { name: "Automations" }).click();
    await expect(page).toHaveURL(/\/schedules$/);
    await expect(page).not.toHaveURL(/\/h\//);
    await expect(page.getByTestId("schedules-empty")).toBeVisible();

    await page.getByTestId("schedules-empty-new").click();
    const formSheet = page.getByTestId("schedule-form-sheet");
    await expect(formSheet).toBeVisible({ timeout: 10_000 });
    await expectStableHeight(formSheet);
    await expect(page.getByTestId("schedule-host-trigger")).toHaveCount(0);
    await expect(page.getByTestId("schedule-project-trigger")).toBeVisible();
    await expect(page.getByTestId("schedule-model-trigger")).toHaveCount(0);
    await expect(page.getByTestId("schedule-thinking-trigger")).toHaveCount(0);
    await expect(page.getByTestId("schedule-mode-trigger")).toHaveCount(0);
    await expect(page.getByTestId("cadence-mode")).toHaveCount(0);
    await expect(page.getByTestId("cadence-interval-value")).toHaveCount(0);
    await expect(page.getByText(/Times are in/)).toHaveCount(0);
    await expect(formSheet.getByText("Cron", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: /select project/i }).click();
    await page
      .getByTestId(`schedule-project-option-${projectEquivalenceViewKey(workspace.projectKey)}`)
      .click();
    const projectTrigger = page.getByTestId("schedule-project-trigger");
    await expect(projectTrigger).toContainText(workspace.projectDisplayName);
    await expectSettled(projectTrigger);

    await selectModelByLabel(page, "Ten second stream");
    const modelTrigger = page.getByTestId("schedule-model-trigger");
    await expect(modelTrigger).toContainText("Ten second stream");
    await expectSettled(modelTrigger);
    await expect(page.getByTestId("schedule-thinking-trigger")).toContainText("Low");
    await expectSettled(page.getByTestId("schedule-thinking-trigger"));
    await expect(page.getByTestId("schedule-mode-trigger")).toBeVisible();
    await expectSettled(page.getByTestId("schedule-mode-trigger"));
    await page.getByTestId("schedule-cadence-preset-trigger").click();
    await page.getByTestId("schedule-cadence-preset-daily-9").click();
    await expect(page.getByTestId("schedule-cadence-preset-trigger")).toContainText("Daily 9:00");
    await expect(page.getByTestId("cadence-cron-expression")).toHaveValue("0 9 * * *");

    await page.getByLabel("Automation name").fill(scheduleName);
    await page.getByLabel("Prompt").fill("Summarize the project status.");
    await page.getByRole("button", { name: "Create automation" }).click();

    await expect(page.getByTestId("schedule-form-sheet")).toHaveCount(0, { timeout: 30_000 });
    await expectScheduleCreatedForProject({
      workspace,
      name: scheduleName,
      cadenceExpression: "0 9 * * *",
    });
  });

  test("follows the host pinned in the sidebar footer and hides the host field", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "schedule-project-host-model-" });
    cleanupTasks.push(() => workspace.cleanup());
    const serverId = getServerId();
    const secondary = await createScheduleHost();
    cleanupTasks.push(() => secondary.cleanup());

    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await page.goto(buildSchedulesRoute());
    await addScheduleHostAndReload({
      page,
      serverId: secondary.serverId,
      label: secondary.label,
      port: secondary.port,
    });
    await expect(page.getByTestId("schedules-empty")).toBeVisible({ timeout: 30_000 });

    // The screen has no host picker of its own; the sidebar footer owns the choice.
    await expect(page.getByTestId("schedules-host-filter-trigger")).toHaveCount(0);
    await page.getByTestId("sidebar-hosts-trigger").click();
    await page.getByTestId(`sidebar-host-row-${secondary.serverId}`).click();
    await expect(page.getByTestId("schedules-empty")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("schedules-empty-new").click();
    const formSheet = page.getByTestId("schedule-form-sheet");
    await expect(formSheet).toBeVisible({ timeout: 10_000 });
    await expectStableHeight(formSheet);

    const projectTrigger = page.getByTestId("schedule-project-trigger");
    await expect(page.getByTestId("schedule-host-trigger")).toHaveCount(0);
    await expect(projectTrigger).toBeVisible({ timeout: 30_000 });
    await projectTrigger.click();
    await expect(
      page.getByTestId(
        `schedule-project-option-${projectEquivalenceViewKey(secondary.projectKey)}`,
      ),
    ).toBeVisible();
    await expect(
      page.getByTestId(
        `schedule-project-option-${projectEquivalenceViewKey(workspace.projectKey)}`,
      ),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(formSheet).toHaveCount(0, { timeout: 10_000 });

    // Pinning back to the primary host swaps the project list with it.
    await page.getByTestId("sidebar-hosts-trigger").click();
    await page.getByTestId(`sidebar-host-row-${serverId}`).click();
    await expect(page.getByTestId("schedules-empty")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("schedules-empty-new").click();
    await expect(page.getByTestId("schedule-host-trigger")).toHaveCount(0);
    await page.getByTestId("schedule-project-trigger").click();
    await expect(
      page.getByTestId(
        `schedule-project-option-${projectEquivalenceViewKey(workspace.projectKey)}`,
      ),
    ).toBeVisible();
  });

  test("creates and edits the archive cleanup knob on worktree-backed schedules", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "schedule-knobs-" });
    cleanupTasks.push(() => workspace.cleanup());
    const scheduleName = `Knob schedule ${Date.now()}`;
    cleanupTasks.push(() => deleteScheduleByName(workspace, scheduleName));

    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await page.goto(buildSchedulesRoute());
    await expect(page.getByTestId("schedules-empty-new")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("schedules-empty-new").click();

    await page.getByRole("button", { name: /select project/i }).click();
    await page
      .getByTestId(`schedule-project-option-${projectEquivalenceViewKey(workspace.projectKey)}`)
      .click();
    await selectModelByLabel(page, "Ten second stream");
    await expect(
      page.getByText("Off keeps each run's workspace in the sidebar for inspection."),
    ).toHaveCount(0);
    await expect(page.getByTestId("schedule-isolation-trigger")).toHaveCount(0);
    await page.getByTestId("schedule-archive-on-finish-switch").click();
    await page.getByLabel("Automation name").fill(scheduleName);
    await page.getByLabel("Prompt").fill("Run with custom workspace cleanup.");
    await page.getByTestId("schedule-cadence-preset-trigger").click();
    await page.getByTestId("schedule-cadence-preset-every-hour").click();
    await page.getByRole("button", { name: "Create automation" }).click();

    await expect(page.getByTestId("schedule-form-sheet")).toHaveCount(0, { timeout: 30_000 });
    await expectScheduleKnobs({
      workspace,
      name: scheduleName,
      archiveOnFinish: false,
      isolation: "worktree",
    });

    const scheduleId = await findScheduleIdByName(workspace, scheduleName);
    await page.getByTestId(`schedule-row-${scheduleId}`).click();
    const formSheet = page.getByTestId("schedule-form-sheet");
    await expect(formSheet).toBeVisible({ timeout: 10_000 });
    await expectStableHeight(formSheet);
    await expect(page.getByTestId("schedule-isolation-trigger")).toHaveCount(0);
    await expect(page.getByTestId("schedule-archive-on-finish-switch")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(
      page.getByText("Off keeps each run's workspace in the sidebar for inspection."),
    ).toHaveCount(0);

    await page.getByTestId("schedule-archive-on-finish-switch").click();
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByTestId("schedule-form-sheet")).toHaveCount(0, { timeout: 30_000 });
    await expectScheduleKnobs({
      workspace,
      name: scheduleName,
      archiveOnFinish: true,
      isolation: "worktree",
    });
  });
});
