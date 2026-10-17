import type { DaemonClient } from "@gravity/client/internal/daemon-client";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { i18n } from "@/i18n/i18next";

export interface BulkClosableTabGroups {
  agentTabs: Array<{ tabId: string; agentId: string }>;
  terminalTabs: Array<{ tabId: string; terminalId: string }>;
  otherTabs: Array<{ tabId: string; target: WorkspaceTabDescriptor["target"] }>;
}

export interface BulkCloseConfirmationLabels {
  terminalsAndTabs: (input: { terminals: number; tabs: number }) => string;
  terminals: (input: { terminals: number }) => string;
  tabs: (input: { tabs: number }) => string;
}

export const DEFAULT_BULK_CLOSE_CONFIRMATION_LABELS: BulkCloseConfirmationLabels = {
  terminalsAndTabs: ({ terminals, tabs }) =>
    `This will close ${terminals} terminal(s) and close ${tabs} tab(s). Any running process in a closed terminal will be stopped immediately.`,
  terminals: ({ terminals }) =>
    `This will close ${terminals} terminal(s). Any running process in a closed terminal will be stopped immediately.`,
  tabs: ({ tabs }) => `This will close ${tabs} tab(s).`,
};

interface CloseWorkspaceTabWithCleanupInput {
  tabId: string;
  target?: WorkspaceTabDescriptor["target"];
}

interface CloseBulkWorkspaceTabsInput {
  client: Pick<DaemonClient, "closeItems"> | null;
  groups: BulkClosableTabGroups;
  closeTab: (tabId: string, action: () => Promise<void>) => Promise<void>;
  closeWorkspaceTabWithCleanup: (input: CloseWorkspaceTabWithCleanupInput) => void;
  prepareAgentTabClose: (agentId: string) => Promise<void>;
  logLabel: string;
  warn?: (message: string, payload: object) => void;
}

export function classifyBulkClosableTabs(tabs: WorkspaceTabDescriptor[]): BulkClosableTabGroups {
  const groups: BulkClosableTabGroups = {
    agentTabs: [],
    terminalTabs: [],
    otherTabs: [],
  };

  for (const tab of tabs) {
    if (tab.target.kind === "agent") {
      const agentTab = { tabId: tab.tabId, agentId: tab.target.agentId };
      groups.agentTabs.push(agentTab);
      continue;
    }
    if (tab.target.kind === "terminal") {
      groups.terminalTabs.push({ tabId: tab.tabId, terminalId: tab.target.terminalId });
      continue;
    }
    groups.otherTabs.push({ tabId: tab.tabId, target: tab.target });
  }

  return groups;
}

export function buildBulkCloseConfirmationMessage(
  input: BulkClosableTabGroups,
  labels: BulkCloseConfirmationLabels = DEFAULT_BULK_CLOSE_CONFIRMATION_LABELS,
): string {
  const { agentTabs, terminalTabs, otherTabs } = input;
  const tabCount = agentTabs.length + otherTabs.length;
  if (terminalTabs.length > 0 && tabCount > 0) {
    return labels.terminalsAndTabs({
      terminals: terminalTabs.length,
      tabs: tabCount,
    });
  }
  if (terminalTabs.length > 0) {
    return labels.terminals({ terminals: terminalTabs.length });
  }
  return labels.tabs({ tabs: tabCount });
}

export async function closeBulkWorkspaceTabs(input: CloseBulkWorkspaceTabsInput): Promise<void> {
  const {
    client,
    groups,
    closeTab,
    closeWorkspaceTabWithCleanup,
    prepareAgentTabClose,
    logLabel,
    warn,
  } = input;
  const hasDestructiveTabs = groups.terminalTabs.length > 0;

  for (const { tabId, agentId } of groups.agentTabs) {
    await closeTab(tabId, async () => {
      try {
        await prepareAgentTabClose(agentId);
      } catch (error) {
        warn?.(`[WorkspaceScreen] Failed to close agent tab ${logLabel}`, { error, agentId });
        return;
      }
      closeWorkspaceTabWithCleanup({
        tabId,
        target: { kind: "agent", agentId },
      });
    });
  }

  if (hasDestructiveTabs && client) {
    void client
      .closeItems({
        agentIds: [],
        terminalIds: groups.terminalTabs.map((tab) => tab.terminalId),
      })
      .catch((error) => {
        warn?.(`[WorkspaceScreen] Failed to bulk close tabs ${logLabel}`, { error });
      });
  } else if (hasDestructiveTabs) {
    warn?.(`[WorkspaceScreen] Failed to bulk close tabs ${logLabel}`, {
      error: new Error(i18n.t("common.errors.daemonClientUnavailable")),
    });
  }

  await Promise.all([
    ...groups.terminalTabs.map(({ tabId, terminalId }) =>
      closeTab(tabId, async () => {
        closeWorkspaceTabWithCleanup({
          tabId,
          target: { kind: "terminal", terminalId },
        });
      }),
    ),
    ...groups.otherTabs.map(({ tabId, target }) =>
      closeTab(tabId, async () => {
        closeWorkspaceTabWithCleanup({ tabId, target });
      }),
    ),
  ]);
}
