import { test, expect } from "../support/fixtures";
import type { DaemonClient } from "@gravity/client/internal/daemon-client";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { expectWorkspaceTabVisible } from "../support/helpers/archive-tab";
import {
  expectComposerEditable,
  expectComposerVisible,
  submitMessage,
} from "../support/helpers/composer";
import { clickNewChat, gotoWorkspace } from "../support/helpers/launcher";
import {
  assertNewWorkspaceSidebarAndHeader,
  connectNewWorkspaceDaemonClient,
  expectNewWorkspaceProjectSelected,
  openGlobalNewWorkspaceComposer,
  submitNewWorkspaceEmpty,
} from "../support/helpers/new-workspace";
import { getServerId } from "../support/helpers/server-id";
import { selectSidebarStatusGrouping } from "../support/helpers/sidebar";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import {
  expectSubagentRowVisible,
  openSubagentsTrack,
  seedParentWithCrossWorkspaceSubagent,
} from "../support/helpers/subagents";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";
import { getVisibleWorkspaceAgentTabIds } from "../support/helpers/workspace-tabs";

type NewWorkspaceDaemonClient = Awaited<ReturnType<typeof connectNewWorkspaceDaemonClient>>;
type WorkspaceIndicator = "attention" | "done" | "failed" | "loading" | "needs_input" | "running";

test.describe("Native context budget controls", () => {
  test.describe.configure({ timeout: 120_000 });

  for (const provider of ["codex", "claude"]) {
    test(`saves and restores the ${provider} context budget`, async ({ page }) => {
      const workspace = await seedWorkspace({ repoPrefix: "context-budget-" });
      const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "context-budget" });
      try {
        const agent = await client.createAgent({
          provider,
          cwd: workspace.repoPath,
          workspaceId: workspace.workspaceId,
          title: "Context budget",
          featureValues: { context_budget: "250000" },
        });
        await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: agent.id });
        await page.getByTestId("agent-controls-settings").filter({ visible: true }).first().click();
        await expect(page.getByTestId("agent-feature-context_budget")).toContainText("250K");
        await page.getByTestId("agent-feature-context_budget").click();
        await page.getByTestId("agent-feature-context_budget-500000").click();
        await expect(page.getByTestId("agent-feature-context_budget-500000")).toHaveAttribute(
          "aria-checked",
          "true",
        );
        await page.screenshot({ path: test.info().outputPath(`${provider}-context-budget.png`) });
        await page.reload();
        await page.getByTestId("agent-controls-settings").filter({ visible: true }).first().click();
        await expect(page.getByTestId("agent-feature-context_budget")).toContainText("500K");
        await page.getByTestId("agent-feature-context_budget").click();
        await page.getByTestId("agent-feature-context_budget-auto").click();
        await expect(page.getByTestId("agent-feature-context_budget-auto")).toHaveAttribute(
          "aria-checked",
          "true",
        );
      } finally {
        await client.close();
        await workspace.cleanup();
      }
    });
  }

  test("keeps a rejected Claude context budget visible and lets the user recover", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "context-budget-error-" });
    const client = await connectDaemonClient<DaemonClient>({
      clientIdPrefix: "context-budget-error",
    });
    try {
      const agent = await client.createAgent({
        provider: "claude",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "Context budget error",
        env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "200000" },
      });
      await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: agent.id });
      await page.getByTestId("agent-controls-settings").filter({ visible: true }).first().click();
      await page.getByTestId("agent-feature-context_budget").click();
      await page.getByTestId("agent-feature-context_budget-250000").click();
      await expect(page.getByTestId("agent-feature-error")).toContainText(
        "CLAUDE_CODE_AUTO_COMPACT_WINDOW",
      );
      await expect(page.getByTestId("agent-feature-context_budget-auto")).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await page.screenshot({ path: test.info().outputPath("claude-context-budget-error.png") });
      await page.getByTestId("agent-feature-context_budget-auto").click();
      await expect(page.getByTestId("agent-feature-error")).toHaveCount(0);
    } finally {
      await client.close();
      await workspace.cleanup();
    }
  });
});

interface CreatedAgentAssertion {
  workspaceId: string;
  provider: string;
  cwd: string;
  modeId: string | null;
  model: string | null;
}

async function fetchCreatedAgentForWorkspace(
  seeded: SeededWorkspace,
  workspaceId: string,
): Promise<CreatedAgentAssertion | null> {
  const result = await seeded.client.fetchAgents({ scope: "active" });
  const agents = result.entries
    .map((entry) => entry.agent)
    .filter((agent) => agent.cwd === seeded.repoPath && agent.workspaceId === workspaceId);
  if (agents.length !== 1) {
    return null;
  }
  const [agent] = agents;
  return {
    workspaceId,
    provider: agent.provider,
    cwd: agent.cwd,
    modeId: agent.currentModeId,
    model: agent.model,
  };
}

async function fetchWorkspaceStatuses(
  client: NewWorkspaceDaemonClient,
  workspaceIds: string[],
): Promise<Record<string, string | null>> {
  const result = await client.fetchWorkspaces();
  const entriesById = new Map(result.entries.map((entry) => [entry.id, entry.status]));
  return Object.fromEntries(
    workspaceIds.map((workspaceId) => [workspaceId, entriesById.get(workspaceId) ?? null]),
  );
}

async function fetchAgentStatus(seeded: SeededWorkspace, agentId: string): Promise<string | null> {
  const result = await seeded.client.fetchAgents({ scope: "active" });
  return result.entries.find((entry) => entry.agent.id === agentId)?.agent.status ?? null;
}

async function switchSidebarToStatusGrouping(page: import("@playwright/test").Page) {
  await selectSidebarStatusGrouping(page);
  await expect(page.locator('[data-testid^="sidebar-status-group-"]').first()).toBeVisible({
    timeout: 30_000,
  });
}

function statusGroupRows(page: import("@playwright/test").Page, bucket: string) {
  return page.getByTestId(`sidebar-status-group-rows-${bucket}`);
}

async function expectWorkspaceRowInStatusBucket(
  page: import("@playwright/test").Page,
  input: { rowTestId: string; bucket: string },
) {
  await expect(statusGroupRows(page, input.bucket).getByTestId(input.rowTestId)).toBeVisible({
    timeout: 30_000,
  });
}

async function expectWorkspaceRowNotInStatusBuckets(
  page: import("@playwright/test").Page,
  input: { rowTestId: string; buckets: string[] },
) {
  for (const bucket of input.buckets) {
    await expect(statusGroupRows(page, bucket).getByTestId(input.rowTestId)).toHaveCount(0, {
      timeout: 5_000,
    });
  }
}

async function expectWorkspaceRowHasOnlyIndicator(
  page: import("@playwright/test").Page,
  input: { rowTestId: string; indicator: WorkspaceIndicator },
) {
  const row = page.getByTestId(input.rowTestId);
  await expect(row).toBeVisible({ timeout: 30_000 });
  for (const indicator of [
    "attention",
    "done",
    "failed",
    "loading",
    "needs_input",
    "running",
  ] satisfies WorkspaceIndicator[]) {
    const locator = row.locator(`[data-testid="workspace-status-indicator-${indicator}"]`);
    if (indicator === input.indicator) {
      await expect(locator).toBeVisible({ timeout: 30_000 });
    } else {
      await expect(locator).toHaveCount(0);
    }
  }
}

async function expectWorkspaceRowDoesNotShowIndicator(
  page: import("@playwright/test").Page,
  input: { rowTestId: string; indicator: WorkspaceIndicator },
) {
  const row = page.getByTestId(input.rowTestId);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(
    row.locator(`[data-testid="workspace-status-indicator-${input.indicator}"]`),
  ).toHaveCount(0, { timeout: 5_000 });
}

test.describe("Workspace model regressions", () => {
  let client: NewWorkspaceDaemonClient;

  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(async () => {
    client = await connectNewWorkspaceDaemonClient();
  });

  test.afterEach(async () => {
    await client?.close().catch(() => undefined);
  });

  test("same-directory workspace does not show agents owned by another workspace", async ({
    page,
  }) => {
    const seeded = await seedWorkspace({ repoPrefix: "workspace-legacy-agents-" });

    try {
      const ownedAgent = await seeded.client.createAgent({
        provider: "mock",
        cwd: seeded.repoPath,
        workspaceId: seeded.workspaceId,
        title: "Agent owned by original workspace",
        modeId: "load-test",
        model: "ten-second-stream",
      });
      const secondWorkspace = await seeded.client.createWorkspace({
        source: { kind: "directory", path: seeded.repoPath, projectId: seeded.projectId },
        title: "Fresh workspace",
      });
      if (!secondWorkspace.workspace) {
        throw new Error(secondWorkspace.error ?? "Failed to create same-directory workspace");
      }

      await gotoWorkspace(page, secondWorkspace.workspace.id);

      await expect
        .poll(() => getVisibleWorkspaceAgentTabIds(page), { timeout: 30_000 })
        .toEqual([]);

      await gotoWorkspace(page, seeded.workspaceId);
      await expect
        .poll(() => getVisibleWorkspaceAgentTabIds(page), { timeout: 30_000 })
        .toContain(`workspace-tab-agent_${ownedAgent.id}`);
    } finally {
      await seeded.cleanup();
    }
  });

  test("new agent tab in a same-directory workspace picks a default model for the saved provider", async ({
    page,
  }) => {
    const seeded: SeededWorkspace = await seedWorkspace({
      repoPrefix: "workspace-new-agent-model-",
    });

    try {
      const secondWorkspace = await seeded.client.createWorkspace({
        source: { kind: "directory", path: seeded.repoPath, projectId: seeded.projectId },
        title: "Fresh workspace",
      });
      if (!secondWorkspace.workspace) {
        throw new Error(secondWorkspace.error ?? "Failed to create same-directory workspace");
      }
      const workspace = secondWorkspace.workspace;

      await page.addInitScript(() => {
        localStorage.setItem(
          "@gravity:create-agent-preferences",
          JSON.stringify({
            provider: "mock",
            providerPreferences: {
              mock: { mode: "load-test" },
            },
          }),
        );
      });
      await gotoWorkspace(page, workspace.id);
      await clickNewChat(page);

      await expectComposerVisible(page);
      await expectComposerEditable(page);
      const prompt = `Create agent default model ${Date.now()}`;
      await submitMessage(page, prompt);
      await expect(page.getByText("No model is available for the selected provider")).toHaveCount(
        0,
      );
      await expect
        .poll(() => fetchCreatedAgentForWorkspace(seeded, workspace.id), {
          timeout: 10_000,
        })
        .toEqual({
          workspaceId: workspace.id,
          provider: "mock",
          cwd: seeded.repoPath,
          modeId: "load-test",
          model: "five-minute-stream",
        });
    } finally {
      await seeded.cleanup();
    }
  });

  test("running agent in one same-directory workspace only shows the loader on its owning row", async ({
    page,
  }) => {
    const serverId = getServerId();
    const seeded = await seedWorkspace({
      repoPrefix: "workspace-same-cwd-running-",
    });

    try {
      const secondWorkspace = await seeded.client.createWorkspace({
        source: { kind: "directory", path: seeded.repoPath, projectId: seeded.projectId },
        title: "Existing sibling workspace",
      });
      if (!secondWorkspace.workspace) {
        throw new Error(secondWorkspace.error ?? "Failed to create same-directory workspace");
      }
      const secondWorkspaceId = secondWorkspace.workspace.id;

      const runningAgent = await seeded.client.createAgent({
        provider: "mock",
        cwd: seeded.repoPath,
        workspaceId: seeded.workspaceId,
        title: "Running agent",
        modeId: "load-test",
        model: "five-minute-stream",
        initialPrompt: "stay running",
      });
      await seeded.client.waitForAgentUpsert(
        runningAgent.id,
        (snapshot) => snapshot.status === "running",
        15_000,
      );

      await gotoWorkspace(page, seeded.workspaceId);
      await waitForSidebarHydration(page);

      const firstRowTestId = `sidebar-workspace-row-${serverId}:${seeded.workspaceId}`;
      const secondRowTestId = `sidebar-workspace-row-${serverId}:${secondWorkspaceId}`;
      await expectWorkspaceRowHasOnlyIndicator(page, {
        rowTestId: firstRowTestId,
        indicator: "running",
      });
      await expectWorkspaceRowDoesNotShowIndicator(page, {
        rowTestId: secondRowTestId,
        indicator: "running",
      });

      await openGlobalNewWorkspaceComposer(page);
      await expectNewWorkspaceProjectSelected(page, seeded.projectDisplayName);
      await submitNewWorkspaceEmpty(page);

      const createdWorkspace = await assertNewWorkspaceSidebarAndHeader(page, {
        serverId,
        client,
        previousWorkspaceId: seeded.workspaceId,
        projectDisplayName: seeded.projectDisplayName,
      });
      const createdRowTestId = `sidebar-workspace-row-${serverId}:${createdWorkspace.workspaceId}`;

      await expect
        .poll(() => fetchAgentStatus(seeded, runningAgent.id), { timeout: 10_000 })
        .toBe("running");

      await expect
        .poll(
          () =>
            fetchWorkspaceStatuses(client, [
              seeded.workspaceId,
              secondWorkspaceId,
              createdWorkspace.workspaceId,
            ]),
          { timeout: 10_000 },
        )
        .toEqual({
          [seeded.workspaceId]: "running",
          [secondWorkspaceId]: "done",
          [createdWorkspace.workspaceId]: "done",
        });

      await expectWorkspaceRowHasOnlyIndicator(page, {
        rowTestId: firstRowTestId,
        indicator: "running",
      });
      await expectWorkspaceRowDoesNotShowIndicator(page, {
        rowTestId: secondRowTestId,
        indicator: "running",
      });
      await expectWorkspaceRowDoesNotShowIndicator(page, {
        rowTestId: createdRowTestId,
        indicator: "running",
      });

      await switchSidebarToStatusGrouping(page);
      await expectWorkspaceRowInStatusBucket(page, {
        rowTestId: firstRowTestId,
        bucket: "running",
      });
      await expectWorkspaceRowInStatusBucket(page, {
        rowTestId: secondRowTestId,
        bucket: "done",
      });
      await expectWorkspaceRowInStatusBucket(page, {
        rowTestId: createdRowTestId,
        bucket: "done",
      });
      await expectWorkspaceRowNotInStatusBuckets(page, {
        rowTestId: secondRowTestId,
        buckets: ["running", "needs_input", "attention"],
      });
      await expectWorkspaceRowNotInStatusBuckets(page, {
        rowTestId: createdRowTestId,
        buckets: ["running", "needs_input", "attention"],
      });
    } finally {
      await seeded.cleanup();
    }
  });

  test("pending permission in one same-directory workspace marks only its own row needing input", async ({
    page,
  }) => {
    const serverId = getServerId();
    const seeded = await seedWorkspace({
      repoPrefix: "workspace-same-cwd-permission-",
    });

    try {
      const secondWorkspace = await seeded.client.createWorkspace({
        source: { kind: "directory", path: seeded.repoPath, projectId: seeded.projectId },
        title: "Permission sibling workspace",
      });
      if (!secondWorkspace.workspace) {
        throw new Error(secondWorkspace.error ?? "Failed to create same-directory workspace");
      }
      const secondWorkspaceId = secondWorkspace.workspace.id;

      const agent = await seeded.client.createAgent({
        provider: "mock",
        cwd: seeded.repoPath,
        workspaceId: seeded.workspaceId,
        title: "Permission agent",
        modeId: "load-test",
        model: "ten-second-stream",
      });
      await seeded.client.sendAgentMessage(agent.id, "Emit synthetic plan approval.");
      const parked = await seeded.client.waitForFinish(agent.id, 15_000);
      expect(parked.status).toBe("permission");

      await gotoWorkspace(page, seeded.workspaceId);
      await waitForSidebarHydration(page);

      const firstRowTestId = `sidebar-workspace-row-${serverId}:${seeded.workspaceId}`;
      const secondRowTestId = `sidebar-workspace-row-${serverId}:${secondWorkspaceId}`;
      await expectWorkspaceRowHasOnlyIndicator(page, {
        rowTestId: firstRowTestId,
        indicator: "needs_input",
      });
      await expectWorkspaceRowDoesNotShowIndicator(page, {
        rowTestId: secondRowTestId,
        indicator: "needs_input",
      });

      await openGlobalNewWorkspaceComposer(page);
      await expectNewWorkspaceProjectSelected(page, seeded.projectDisplayName);
      await submitNewWorkspaceEmpty(page);

      const createdWorkspace = await assertNewWorkspaceSidebarAndHeader(page, {
        serverId,
        client,
        previousWorkspaceId: seeded.workspaceId,
        projectDisplayName: seeded.projectDisplayName,
      });
      const createdRowTestId = `sidebar-workspace-row-${serverId}:${createdWorkspace.workspaceId}`;

      await expect
        .poll(
          () =>
            fetchWorkspaceStatuses(client, [
              seeded.workspaceId,
              secondWorkspaceId,
              createdWorkspace.workspaceId,
            ]),
          { timeout: 10_000 },
        )
        .toEqual({
          [seeded.workspaceId]: "needs_input",
          [secondWorkspaceId]: "done",
          [createdWorkspace.workspaceId]: "done",
        });

      await expectWorkspaceRowHasOnlyIndicator(page, {
        rowTestId: firstRowTestId,
        indicator: "needs_input",
      });
      await expectWorkspaceRowDoesNotShowIndicator(page, {
        rowTestId: secondRowTestId,
        indicator: "needs_input",
      });
      await expectWorkspaceRowDoesNotShowIndicator(page, {
        rowTestId: createdRowTestId,
        indicator: "needs_input",
      });

      await switchSidebarToStatusGrouping(page);
      await expectWorkspaceRowInStatusBucket(page, {
        rowTestId: firstRowTestId,
        bucket: "needs_input",
      });
      await expectWorkspaceRowInStatusBucket(page, {
        rowTestId: secondRowTestId,
        bucket: "done",
      });
      await expectWorkspaceRowInStatusBucket(page, {
        rowTestId: createdRowTestId,
        bucket: "done",
      });
      await expectWorkspaceRowNotInStatusBuckets(page, {
        rowTestId: secondRowTestId,
        buckets: ["running", "needs_input", "attention"],
      });
      await expectWorkspaceRowNotInStatusBuckets(page, {
        rowTestId: createdRowTestId,
        buckets: ["running", "needs_input", "attention"],
      });
    } finally {
      await seeded.cleanup();
    }
  });

  test("cross-workspace subagent opens in its workspace and keeps its parent relationship", async ({
    page,
  }) => {
    const serverId = getServerId();
    const seeded = await seedWorkspace({ repoPrefix: "workspace-cross-subagent-" });

    try {
      const agents = await seedParentWithCrossWorkspaceSubagent(seeded, {
        parentTitle: "Parent agent",
        childTitle: "Cross-workspace subagent",
      });

      await gotoWorkspace(page, agents.child.workspaceId);
      await waitForSidebarHydration(page);
      await expectWorkspaceTabVisible(page, agents.child.id);

      const parentRowTestId = `sidebar-workspace-row-${serverId}:${agents.parent.workspaceId}`;
      const childRowTestId = `sidebar-workspace-row-${serverId}:${agents.child.workspaceId}`;
      await expectWorkspaceRowHasOnlyIndicator(page, {
        rowTestId: childRowTestId,
        indicator: "running",
      });
      await expectWorkspaceRowHasOnlyIndicator(page, {
        rowTestId: parentRowTestId,
        indicator: "done",
      });

      await gotoWorkspace(page, agents.parent.workspaceId);
      await openSubagentsTrack(page);
      await expectSubagentRowVisible(page, agents.child.id);
    } finally {
      await seeded.cleanup();
    }
  });
});
