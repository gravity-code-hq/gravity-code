import path from "node:path";
import { test, expect } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  closeMobileAgentSidebar,
  expectMobileAgentSidebarHidden,
  expectMobileAgentSidebarVisible,
  openMobileAgentSidebar,
  pinWorkspaceFromSidebar,
} from "../support/helpers/sidebar";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { projectEquivalenceViewKey } from "../support/helpers/project-view-key";
import { escapeRegex } from "../support/helpers/regex";
import { openFilesPanel } from "../support/helpers/workspace-tabs";
import {
  openAgentRoute,
  seedMockAgentWorkspace,
  seedRunningMockAgentWorkspace,
} from "../support/helpers/mock-agent";
import {
  createMockIdleAgent,
  openSessions,
  expectSessionRowArchived,
} from "../support/helpers/archive-tab";
import { clickNewTerminal, gotoWorkspace } from "../support/helpers/launcher";
import { installDaemonConnectionGate } from "../support/helpers/project-settings";
import { renameModalError, renameModalInput, renameModalSubmit } from "../support/helpers/rename";

test("workspace sidebar includes terminals alongside chats and follows terminal tabs", async ({
  page,
}, testInfo) => {
  const workspace = await seedWorkspace({ repoPrefix: "sidebar-terminals-" });
  try {
    await gotoWorkspace(page, workspace.workspaceId);
    await clickNewTerminal(page);
    const listTerminals = () =>
      workspace.client.listTerminals(workspace.repoPath, undefined, {
        workspaceId: workspace.workspaceId,
      });
    await expect.poll(async () => (await listTerminals()).terminals.length).toBe(1);
    const terminalId = (await listTerminals()).terminals[0]!.id;
    const row = page.getByTestId(`sidebar-terminal-${getServerId()}:${terminalId}`);
    const tab = page
      .getByTestId(`workspace-tab-terminal_${terminalId}`)
      .filter({ visible: true })
      .first();
    await expect(row).toHaveText("Terminal 1");
    await expect(row).toHaveAttribute("aria-selected", "true");

    await tab.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    const modal = `workspace-tab-rename-modal-terminal-${terminalId}`;
    await renameModalInput(page, modal).fill("Sidebar shell");
    await renameModalSubmit(page, modal).click();
    await expect(row).toHaveText("Sidebar shell");

    await createMockIdleAgent(workspace.client, {
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Sidebar chat",
    });
    const chat = page
      .getByTestId(`sidebar-workspace-agents-${getServerId()}:${workspace.workspaceId}`)
      .getByRole("button", { name: "Sidebar chat", exact: true });
    await chat.click();
    await expect(row).toHaveAttribute("aria-selected", "false");
    await row.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(row).toHaveAttribute("aria-selected", "true");
    await expect(chat).toHaveAttribute("aria-selected", "false");
    await page.screenshot({ path: testInfo.outputPath("sidebar-terminal.png") });
    await page.reload();
    await expect(row).toHaveText("Sidebar shell");
    await tab.click({ button: "right" });
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("menuitem", { name: "Close", exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect(chat).toBeVisible();
  } finally {
    await workspace.cleanup();
  }
});

test("closing an agent tab keeps its conversation in the sidebar until explicitly archived", async ({
  page,
}, testInfo) => {
  const workspace = await seedWorkspace({ repoPrefix: "sidebar-close-agent-" });
  try {
    const agent = await createMockIdleAgent(workspace.client, {
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Keep this conversation",
    });
    await gotoWorkspace(page, workspace.workspaceId);
    const row = page.getByTestId(`sidebar-agent-${getServerId()}:${agent.id}`);
    const tab = page
      .getByTestId(`workspace-tab-agent_${agent.id}`)
      .filter({ visible: true })
      .first();
    await row.click();
    await tab.hover();
    await page.getByTestId(`workspace-agent-close-${agent.id}`).filter({ visible: true }).click();
    await expect(tab).toHaveCount(0);
    await expect(row).toBeVisible();
    expect((await workspace.client.fetchAgent({ agentId: agent.id }))?.agent.archivedAt).toBeNull();
    await page.reload();
    await expect(row).toBeVisible();
    await expect(tab).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("closed-tab-conversation-retained.png") });
    await row.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect(tab).toHaveCount(0);
    expect(
      (await workspace.client.fetchAgent({ agentId: agent.id }))?.agent.archivedAt,
    ).not.toBeNull();
  } finally {
    await workspace.cleanup();
  }
});

test("closing a running agent tab keeps it running and bulk close preserves conversations", async ({
  page,
}) => {
  const session = await seedRunningMockAgentWorkspace({
    repoPrefix: "sidebar-close-running-",
    title: "Keep working after close",
    model: "five-minute-stream",
    initialPrompt: "Keep working",
  });
  try {
    await openAgentRoute(page, session);
    const row = page.getByTestId(`sidebar-agent-${getServerId()}:${session.agentId}`);
    const tab = page
      .getByTestId(`workspace-tab-agent_${session.agentId}`)
      .filter({ visible: true })
      .first();
    await tab.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Close", exact: true }).click();
    await expect(tab).toHaveCount(0);
    await expect(row).toBeVisible();
    const agent = await session.client.fetchAgent({ agentId: session.agentId });
    expect(agent?.agent.archivedAt).toBeNull();
    const active = await session.client.fetchAgents({ scope: "active" });
    expect(active.entries.find((entry) => entry.agent.id === session.agentId)?.agent.status).toBe(
      "running",
    );
    await row.click();
    const kept = await createMockIdleAgent(session.client, {
      cwd: session.cwd,
      workspaceId: session.workspaceId,
      title: "Keep this tab open",
    });
    const keptRow = page.getByTestId(`sidebar-agent-${getServerId()}:${kept.id}`);
    await keptRow.click();
    const keptTab = page
      .getByTestId(`workspace-tab-agent_${kept.id}`)
      .filter({ visible: true })
      .first();
    await keptTab.click({ button: "right" });
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("menuitem", { name: "Close other tabs", exact: true }).click();
    await expect(tab).toHaveCount(0);
    await expect(row).toBeVisible();
    await expect(keptTab).toBeVisible();
    const afterBulkClose = await session.client.fetchAgent({ agentId: session.agentId });
    const activeAfterBulkClose = await session.client.fetchAgents({ scope: "active" });
    expect(
      activeAfterBulkClose.entries.find((entry) => entry.agent.id === session.agentId)?.agent
        .status,
    ).toBe("running");
    expect(afterBulkClose?.agent.archivedAt).toBeNull();
  } finally {
    await session.cleanup();
  }
});

test("workspace sidebar shows six chats, expands, and selects the matching tab", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const workspace = await seedWorkspace({ repoPrefix: "sidebar-agent-list-" });
  try {
    for (let index = 1; index <= 7; index += 1) {
      await createMockIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: `Sidebar chat ${index}`,
      });
    }
    await gotoAppShell(page);
    const workspaceKey = `${getServerId()}:${workspace.workspaceId}`;
    const list = page.getByTestId(`sidebar-workspace-agents-${workspaceKey}`);
    const rows = list.locator('[data-testid^="sidebar-agent-"]');
    await expect(rows).toHaveCount(6);
    const newestFirst = [7, 6, 5, 4, 3, 2, 1].map((index) => `Sidebar chat ${index}`);
    await expect(rows).toHaveText(newestFirst.slice(0, 6));
    const toggle = page.getByTestId(`sidebar-workspace-agents-toggle-${workspaceKey}`);
    await toggle.click();
    await expect(rows).toHaveCount(7);
    await expect(rows).toHaveText(newestFirst);
    const rowId = await rows.last().getAttribute("data-testid");
    if (!rowId) throw new Error("Missing sidebar agent identity");
    const selectedRow = page.getByTestId(rowId);
    const agentId = rowId.slice(`sidebar-agent-${getServerId()}:`.length);
    await selectedRow.click();
    await expect(selectedRow).toHaveAttribute("aria-selected", "true");
    const tab = page.getByTestId(`workspace-tab-agent_${agentId}`).first();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(rows).toHaveText(newestFirst);
    await page.screenshot({ path: testInfo.outputPath("sidebar-agents-expanded.png") });
    await toggle.click();
    await expect(rows).toHaveCount(6);
    await page.screenshot({ path: testInfo.outputPath("sidebar-agents-collapsed.png") });
    await workspace.client.archiveAgent(agentId);
    await expect(toggle).toHaveCount(0);
    await expect(rows).toHaveCount(6);
  } finally {
    await workspace.cleanup();
  }
});

test("sidebar renames individual conversations and preserves titles after reload", async ({
  page,
}, testInfo) => {
  const workspace = await seedWorkspace({ repoPrefix: "sidebar-rename-" });
  try {
    const first = await createMockIdleAgent(workspace.client, {
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Same conversation title",
    });
    const second = await createMockIdleAgent(workspace.client, {
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Same conversation title",
    });
    await gotoWorkspace(page, workspace.workspaceId);
    const row = page.getByTestId(`sidebar-agent-${getServerId()}:${first.id}`);
    const other = page.getByTestId(`sidebar-agent-${getServerId()}:${second.id}`);
    await row.click();
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    const modal = `sidebar-conversation-rename-${first.id}`;
    const input = renameModalInput(page, modal);
    await expect(input).toHaveValue("Same conversation title");
    await input.fill("  Review feedback  ");
    await renameModalSubmit(page, modal).click();
    await expect(input).toHaveCount(0);
    await expect(row).toHaveText("Review feedback");
    await expect(other).toHaveText("Same conversation title");
    await expect(page.getByTestId(`workspace-tab-agent_${first.id}`).first()).toContainText(
      "Review feedback",
    );
    await page.reload();
    await expect(row).toHaveText("Review feedback");
    await expect(other).toHaveText("Same conversation title");
    await page.getByTestId(`sidebar-conversation-menu-${first.id}-trigger`).click();
    await expect(page.getByTestId(`sidebar-conversation-menu-${first.id}-archive`)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("conversation-actions-desktop.png") });
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    await expect(input).toHaveValue("Review feedback");
    await input.fill("   ");
    await expect(renameModalSubmit(page, modal)).toBeDisabled();
    await page.getByTestId(`${modal}-cancel`).click();
    await expect(row).toHaveText("Review feedback");
    await page.screenshot({ path: testInfo.outputPath("sidebar-conversation-renamed.png") });
  } finally {
    await workspace.cleanup();
  }
});

test("sidebar conversation rename keeps the draft and shows an error when disconnected", async ({
  page,
}) => {
  const workspace = await seedWorkspace({ repoPrefix: "sidebar-rename-error-" });
  try {
    const agent = await createMockIdleAgent(workspace.client, {
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Original conversation",
    });
    const gate = await installDaemonConnectionGate(page);
    await gotoWorkspace(page, workspace.workspaceId);
    await page.getByTestId(`sidebar-conversation-menu-${agent.id}-trigger`).click();
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    const modal = `sidebar-conversation-rename-${agent.id}`;
    const input = renameModalInput(page, modal);
    await input.fill("Unsaved conversation");
    await gate.drop();
    await renameModalSubmit(page, modal).click();
    await expect(renameModalError(page, modal)).toBeVisible();
    await expect(input).toHaveValue("Unsaved conversation");
    await expect(input).toBeEditable();
    await expect(renameModalSubmit(page, modal)).toBeEnabled();
    await page.getByTestId(`${modal}-cancel`).click();
    await expect(input).toHaveCount(0);
    await expect(page.getByTestId(`sidebar-agent-${getServerId()}:${agent.id}`)).toHaveText(
      "Original conversation",
    );
  } finally {
    await workspace.cleanup();
  }
});

test("sidebar conversation rename works from the compact actions sheet", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const session = await seedMockAgentWorkspace({
    repoPrefix: "sidebar-rename-compact-",
    title: "Phone conversation",
  });
  try {
    await openAgentRoute(page, session);
    await openMobileAgentSidebar(page);
    await expectMobileAgentSidebarVisible(page);
    const menu = `sidebar-conversation-menu-${session.agentId}`;
    await page.getByTestId(`${menu}-trigger`).click();
    await page.getByTestId(`${menu}-rename`).click();
    const modal = `sidebar-conversation-rename-${session.agentId}`;
    const input = renameModalInput(page, modal);
    await expect(input).toHaveValue("Phone conversation");
    await input.fill("Renamed on phone");
    await renameModalSubmit(page, modal).click();
    await expect(input).toHaveCount(0);
    await expect(page.getByTestId(`sidebar-agent-${getServerId()}:${session.agentId}`)).toHaveText(
      "Renamed on phone",
    );
    await page.screenshot({ path: testInfo.outputPath("sidebar-conversation-compact.png") });
  } finally {
    await session.cleanup();
  }
});

test("sidebar archives one conversation and keeps the workspace and history", async ({ page }) => {
  const workspace = await seedWorkspace({ repoPrefix: "sidebar-archive-" });
  try {
    const archived = await createMockIdleAgent(workspace.client, {
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Archive this conversation",
    });
    const kept = await createMockIdleAgent(workspace.client, {
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Keep this conversation",
    });
    await gotoWorkspace(page, workspace.workspaceId);
    const row = page.getByTestId(`sidebar-agent-${getServerId()}:${archived.id}`);
    await row.click();
    const tab = page.getByTestId(`workspace-tab-agent_${archived.id}`).first();
    await expect(tab).toBeVisible();
    await row.click({ button: "right" });
    const archive = page.getByRole("menuitem", { name: "Archive", exact: true });
    await expect(archive).toBeVisible();
    await archive.click();
    await expect(row).toHaveCount(0);
    await expect(tab).toHaveCount(0);
    await expect(page.getByTestId(`sidebar-agent-${getServerId()}:${kept.id}`)).toBeVisible();
    await expect(
      page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByTestId(`sidebar-agent-${getServerId()}:${kept.id}`)).toBeVisible();
    await expect(row).toHaveCount(0);
    await expect(tab).toHaveCount(0);
    await openSessions(page);
    await expectSessionRowArchived(page, archived.title);
  } finally {
    await workspace.cleanup();
  }
});

test("sidebar archive confirms running conversations on compact screens", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const session = await seedRunningMockAgentWorkspace({
    repoPrefix: "sidebar-archive-running-",
    title: "Running conversation",
    model: "five-minute-stream",
    initialPrompt: "Keep working",
  });
  try {
    await openAgentRoute(page, session);
    await openMobileAgentSidebar(page);
    await expectMobileAgentSidebarVisible(page);
    const row = page.getByTestId(`sidebar-agent-${getServerId()}:${session.agentId}`);
    const menu = `sidebar-conversation-menu-${session.agentId}`;
    await page.getByTestId(`${menu}-trigger`).click();
    await expect(page.getByTestId(`${menu}-archive`)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("conversation-archive-menu-compact.png") });
    const cancelled = new Promise<string>((resolve) =>
      page.once("dialog", async (dialog) => {
        resolve(dialog.message());
        await dialog.dismiss();
      }),
    );
    await page.getByTestId(`${menu}-archive`).click();
    expect(await cancelled).toContain("Archiving it will stop the agent and close the tab");
    await expect(row).toBeVisible();
    await expect(page.getByTestId(`${menu}-trigger`)).toBeVisible();
    const active = await session.client.fetchAgents({ scope: "active" });
    expect(active.entries.find((entry) => entry.agent.id === session.agentId)?.agent.status).toBe(
      "running",
    );
    await page.getByTestId(`${menu}-trigger`).click();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByTestId(`${menu}-archive`).click();
    await expect(row).toHaveCount(0);
    await expect(
      page.getByTestId(`sidebar-workspace-row-${getServerId()}:${session.workspaceId}`),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const agents = await session.client.fetchAgents({ scope: "active" });
        return agents.entries.some((entry) => entry.agent.id === session.agentId);
      })
      .toBe(false);
  } finally {
    await session.cleanup();
  }
});

test("sidebar archive failure keeps the conversation and offers retry and dismiss", async ({
  page,
}) => {
  const session = await seedMockAgentWorkspace({
    repoPrefix: "sidebar-archive-failure-",
    title: "Keep after failure",
  });
  try {
    const gate = await installDaemonConnectionGate(page);
    await openAgentRoute(page, session);
    const row = page.getByTestId(`sidebar-agent-${getServerId()}:${session.agentId}`);
    const tab = page.getByTestId(`workspace-tab-agent_${session.agentId}`).first();
    const menu = `sidebar-conversation-menu-${session.agentId}`;
    await expect(tab).toBeVisible();
    await page.getByTestId(`${menu}-trigger`).click();
    await gate.drop();
    await page.getByTestId(`${menu}-archive`).click();
    const error = page.getByTestId(`sidebar-conversation-archive-error-${session.workspaceId}`);
    await expect(error).toBeVisible();
    await expect(row).toBeVisible();
    await expect(tab).toBeVisible();
    await error.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(error).toBeVisible();
    await error.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(error).toHaveCount(0);
    await expect(row).toBeVisible();
    await expect(tab).toBeVisible();
  } finally {
    await session.cleanup();
  }
});

const GITHUB_REMOTE_URL = "https://github.com/test-owner/test-repo.git";

function getWorkspaceRowTestId(workspaceId: string): string {
  return `sidebar-workspace-row-${getServerId()}:${workspaceId}`;
}

async function openWorkspaceFromSidebar(
  page: import("@playwright/test").Page,
  workspaceId: string,
) {
  const row = page.getByTestId(getWorkspaceRowTestId(workspaceId));
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page).toHaveURL(/\/workspace\//, { timeout: 30_000 });
  return row;
}

async function waitForSidebarProject(page: import("@playwright/test").Page, projectName: string) {
  const row = page
    .getByRole("button", {
      name: new RegExp(escapeRegex(projectName), "i"),
    })
    .first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  return row;
}

async function waitForSidebarWorkspace(page: import("@playwright/test").Page, workspaceId: string) {
  const row = page.getByTestId(getWorkspaceRowTestId(workspaceId));
  await expect(row).toBeVisible({ timeout: 30_000 });
  return row;
}

async function openWorkspaceReadAction(
  page: import("@playwright/test").Page,
  workspaceId: string,
  action: "read" | "unread",
) {
  const workspaceKey = `${getServerId()}:${workspaceId}`;
  const row = await waitForSidebarWorkspace(page, workspaceId);
  await row.hover();
  await page.getByTestId(`sidebar-workspace-kebab-${workspaceKey}`).click();
  const item = page.getByTestId(`sidebar-workspace-menu-mark-as-${action}-${workspaceKey}`);
  await expect(item).toBeVisible({ timeout: 30_000 });
  return item;
}

async function openWorkspaceHoverCard(page: import("@playwright/test").Page, workspaceId: string) {
  const row = await waitForSidebarWorkspace(page, workspaceId);
  await row.hover();

  const hoverCard = page.getByRole("menu", { name: "Workspace scripts" });
  await expect(hoverCard).toBeVisible({ timeout: 30_000 });
  return hoverCard;
}

interface GravityOwnedWorktree {
  projectName: string;
  workspaceId: string;
  worktreeSlug: string;
}

async function withGravityOwnedWorktree(
  run: (workspace: GravityOwnedWorktree) => Promise<void>,
): Promise<void> {
  const project = await seedWorkspace({ repoPrefix: "sidebar-hover-owned-worktree-" });
  const worktreeSlug = "hover-card-owned-worktree";

  try {
    const created = await project.client.createWorkspace({
      source: {
        kind: "worktree",
        cwd: project.repoPath,
        projectId: project.projectId,
        worktreeSlug,
      },
    });
    if (!created.workspace) {
      throw new Error(created.error ?? "Failed to create Gravity-owned worktree");
    }
    expect(path.basename(created.workspace.workspaceDirectory)).toBe(worktreeSlug);

    await run({
      projectName: path.basename(project.repoPath),
      workspaceId: created.workspace.id,
      worktreeSlug,
    });
  } finally {
    await project.cleanup();
  }
}

test.describe("Sidebar workspace list", () => {
  test("project with GitHub remote shows its selected folder name in sidebar", async ({ page }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "sidebar-remote-",
      repo: { withRemote: true, originUrl: GITHUB_REMOTE_URL },
    });

    try {
      const projectName = path.basename(workspace.repoPath);
      await gotoAppShell(page);
      await waitForSidebarProject(page, projectName);
      await waitForSidebarWorkspace(page, workspace.workspaceId);

      const projectRow = page
        .locator('[data-testid^="sidebar-project-row-"]')
        .filter({ hasText: projectName })
        .first();

      await expect(projectRow).toBeVisible({ timeout: 30_000 });
      await expect(projectRow).not.toContainText("test-owner/test-repo");
    } finally {
      await workspace.cleanup();
    }
  });

  test("non-git project shows directory name", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-directory-", git: false });

    try {
      await gotoAppShell(page);

      const directoryName = path.basename(workspace.repoPath);
      const projectRow = await waitForSidebarProject(page, directoryName);
      await expect(projectRow).toContainText(directoryName);
    } finally {
      await workspace.cleanup();
    }
  });

  test("workspace header uses the selected folder name instead of its GitHub remote", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "sidebar-header-",
      repo: { withRemote: true, originUrl: GITHUB_REMOTE_URL },
    });

    try {
      const projectName = path.basename(workspace.repoPath);
      await gotoAppShell(page);
      await waitForSidebarProject(page, projectName);
      await waitForSidebarWorkspace(page, workspace.workspaceId);
      await openWorkspaceFromSidebar(page, workspace.workspaceId);

      await expect(page.getByTestId("workspace-header-title")).toHaveText(`${projectName}: main`);
      await expect(page.getByTestId("workspace-header-subtitle")).toHaveCount(0);
    } finally {
      await workspace.cleanup();
    }
  });

  test("git project shows branch name in workspace row", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-branch-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarProject(page, path.basename(workspace.repoPath));

      expect(workspace.workspaceName).toBe("main");
      await expect(await waitForSidebarWorkspace(page, workspace.workspaceId)).toContainText(
        "main",
      );
    } finally {
      await workspace.cleanup();
    }
  });

  test("workspace hover card shows host as metadata", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-hover-host-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarProject(page, path.basename(workspace.repoPath));

      const hoverCard = await openWorkspaceHoverCard(page, workspace.workspaceId);
      await expect(page.getByTestId("hover-card-workspace-host")).toHaveText("localhost");
      await expect(hoverCard).not.toContainText(/\b(Online|Connecting|Offline|Error|Idle)\b/);
    } finally {
      await workspace.cleanup();
    }
  });

  test("marks a finished workspace unread until it is opened again", async ({ page }) => {
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "sidebar-mark-unread-",
      title: "Mark unread",
      initialPrompt: "Finish this test turn.",
    });

    try {
      await workspace.client.waitForFinish(workspace.agentId, 20_000);
      await workspace.client.clearWorkspaceAttention(workspace.workspaceId);
      expect(workspace.client.getLastServerInfoMessage()?.features?.workspaceMarkUnread).toBe(true);
      await gotoAppShell(page);

      const row = await waitForSidebarWorkspace(page, workspace.workspaceId);
      await expect(row.getByTestId("workspace-status-indicator-done")).toBeVisible();
      await (await openWorkspaceReadAction(page, workspace.workspaceId, "unread")).click();
      await openWorkspaceReadAction(page, workspace.workspaceId, "read");

      await page.keyboard.press("Escape");
      await openWorkspaceFromSidebar(page, workspace.workspaceId);
      await openWorkspaceReadAction(page, workspace.workspaceId, "unread");
    } finally {
      await workspace.cleanup();
    }
  });

  test("Gravity-owned worktree hover card shows the worktree directory name", async ({ page }) => {
    await withGravityOwnedWorktree(async ({ projectName, workspaceId, worktreeSlug }) => {
      await gotoAppShell(page);
      await waitForSidebarProject(page, projectName);
      await openWorkspaceHoverCard(page, workspaceId);

      await expect(page.getByTestId("hover-card-workspace-cwd")).toHaveText(worktreeSlug);
    });
  });
});

test.describe("Mobile sidebar panelState transition", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("showMobileAgent open and close transition", async ({ page }) => {
    await gotoAppShell(page);
    await expectMobileAgentSidebarHidden(page);
    await openMobileAgentSidebar(page);
    await expectMobileAgentSidebarVisible(page);
    await closeMobileAgentSidebar(page);
    await expectMobileAgentSidebarHidden(page);
  });

  test("keeps a pinned workspace rendered while the retained sidebar is closed", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-retained-pin-" });

    try {
      await gotoAppShell(page);
      await openMobileAgentSidebar(page);
      await expectMobileAgentSidebarVisible(page);

      const row = page.getByTestId(getWorkspaceRowTestId(workspace.workspaceId));
      await expect(row).toBeVisible({ timeout: 30_000 });
      await pinWorkspaceFromSidebar(page, workspace.workspaceId);
      await expect(page.getByTestId("sidebar-pinned-section")).toBeVisible();

      await closeMobileAgentSidebar(page);
      await expectMobileAgentSidebarHidden(page);

      await expect(row).toHaveCount(1);
    } finally {
      await workspace.cleanup();
    }
  });
});

test.describe("Half-screen desktop layout", () => {
  test.use({ viewport: { width: 751, height: 982 } });

  test("keeps the sidebar scroll position across close and reopen", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-retained-scroll-" });

    try {
      let lastWorkspaceId = workspace.workspaceId;
      for (let index = 0; index < 24; index += 1) {
        const created = await workspace.client.createWorkspace({
          source: {
            kind: "directory",
            path: workspace.repoPath,
            projectId: workspace.projectId,
          },
          title: `Retained sidebar ${index + 1}`,
        });
        if (!created.workspace) {
          throw new Error(created.error ?? "Failed to fill the retained sidebar");
        }
        lastWorkspaceId = created.workspace.id;
      }

      await gotoAppShell(page);
      await page
        .getByTestId(`sidebar-project-show-more-${projectEquivalenceViewKey(workspace.projectKey)}`)
        .click();
      await waitForSidebarWorkspace(page, lastWorkspaceId);

      const sidebarScroll = page.getByTestId("sidebar-project-workspace-list-scroll");
      const scrollTop = await sidebarScroll.evaluate((element) => {
        element.scrollTop = 160;
        return element.scrollTop;
      });
      expect(scrollTop).toBe(160);

      await page.getByTestId("menu-button").click();
      await expect(page.getByTestId("sidebar-global-new-workspace")).not.toBeVisible();

      await page.getByTestId("menu-button").click();
      await expect(page.getByTestId("sidebar-global-new-workspace")).toBeVisible();
      await expect(sidebarScroll).toHaveJSProperty("scrollTop", scrollTop);
    } finally {
      await workspace.cleanup();
    }
  });

  test("keeps the pinned sidebar at half of a 14-inch Mac display", async ({ page }) => {
    await gotoAppShell(page);
    await expect(page.getByTestId("sidebar-global-new-workspace")).toBeVisible();
    await expect(page.getByTestId("agent-list-backdrop")).not.toBeVisible();
  });

  test("keeps the left toggle center-owned without left window controls", async ({ page }) => {
    await gotoAppShell(page);

    const openToggle = page.getByTestId("menu-button");
    const openIcon = openToggle.locator("svg").first();
    await expect(openIcon).toBeVisible();
    const openBounds = await openIcon.boundingBox();
    expect(openBounds).not.toBeNull();
    expect(openBounds?.x).toBeGreaterThan(12);

    await openToggle.click();
    await expect(page.getByTestId("sidebar-global-new-workspace")).not.toBeVisible();

    const closedToggle = page.getByTestId("menu-button");
    const closedIcon = closedToggle.locator("svg").first();
    await expect(closedIcon).toBeVisible();
    const closedBounds = await closedIcon.boundingBox();
    expect(closedBounds).not.toBeNull();
    expect(closedBounds?.x).toBeCloseTo(9, 0);
    expect(closedBounds?.y).toBe(openBounds?.y);
  });

  test("yields app navigation to the settings split", async ({ page }) => {
    await gotoAppShell(page);
    await page.getByTestId("sidebar-settings").click();

    await expect(page.getByTestId("settings-sidebar")).toBeVisible();
    await expect(page.getByTestId("settings-detail-pane")).toBeVisible();
    await expect(page.getByTestId("sidebar-settings")).not.toBeVisible();
  });

  test("keeps app navigation beside the Explorer pane", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-half-screen-explorer-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarProject(page, path.basename(workspace.repoPath));
      await openWorkspaceFromSidebar(page, workspace.workspaceId);

      await openFilesPanel(page);
      const explorerToggle = page.getByTestId("workspace-explorer-toggle").first();
      await expect(
        page.getByTestId("explorer-sidebar-tab-files").filter({ visible: true }),
      ).toBeVisible();
      await expect(explorerToggle).toHaveAccessibleName("Close Explorer sidebar");
      await expect(page.getByTestId("sidebar-global-new-workspace")).toBeVisible();
      await expect(page.getByTestId("explorer-sidebar-tab-rail")).toBeVisible();
      await expect(page.getByTestId("workspace-tabs-row").filter({ visible: true })).toHaveCount(1);

      await explorerToggle.click();
      await expect(
        page.getByTestId("explorer-sidebar-tab-files").filter({ visible: true }),
      ).toHaveCount(0);
      await expect(explorerToggle).toHaveAccessibleName("Open Explorer sidebar");
      await expect(page.getByTestId("sidebar-global-new-workspace")).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });
});
