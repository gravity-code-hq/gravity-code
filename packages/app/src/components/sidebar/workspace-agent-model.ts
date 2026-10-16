import type { Agent } from "@/stores/session-store";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import { deriveSidebarStateBucket, type SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";
import {
  collectAllTabs,
  findPaneById,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";

export interface SidebarAgent {
  id: string;
  title: string | null;
  provider: Agent["provider"];
  createdAt: number;
  // Sidebar sort key: the last user message, or creation time before the first one.
  lastMessageAt: number;
  statusBucket: SidebarStateBucket;
  isWorkspaceRoot: boolean;
}

export function indexSidebarAgents(
  agents: ReadonlyMap<string, Agent>,
): Map<string, SidebarAgent[]> {
  const byWorkspace = new Map<string, SidebarAgent[]>();
  for (const agent of agents.values()) {
    const workspaceId = normalizeWorkspaceOpaqueId(agent.workspaceId);
    if (!workspaceId || agent.archivedAt) continue;
    const parent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
    const row: SidebarAgent = {
      id: agent.id,
      title: agent.title,
      provider: agent.provider,
      createdAt: agent.createdAt.getTime(),
      lastMessageAt: (agent.lastUserMessageAt ?? agent.createdAt).getTime(),
      statusBucket: deriveSidebarStateBucket({
        ...agent,
        pendingPermissionCount: agent.pendingPermissions.length,
      }),
      isWorkspaceRoot: isWorkspaceRootAgent(agent, parent),
    };
    const rows = byWorkspace.get(workspaceId);
    if (rows) rows.push(row);
    else byWorkspace.set(workspaceId, [row]);
  }
  return byWorkspace;
}

export function sidebarAgentsEqual(
  left: readonly SidebarAgent[],
  right: readonly SidebarAgent[],
): boolean {
  return (
    left.length === right.length &&
    left.every((row, index) => {
      const other = right[index];
      return (
        row.id === other.id &&
        row.title === other.title &&
        row.provider === other.provider &&
        row.createdAt === other.createdAt &&
        row.lastMessageAt === other.lastMessageAt &&
        row.statusBucket === other.statusBucket &&
        row.isWorkspaceRoot === other.isWorkspaceRoot
      );
    })
  );
}

export function deriveSidebarAgentList(
  agents: readonly SidebarAgent[],
  layout: WorkspaceLayout | undefined,
) {
  const tabs = layout ? collectAllTabs(layout.root) : [];
  const focusedPane = layout ? findPaneById(layout.root, layout.focusedPaneId) : null;
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const ordered = new Map<string, SidebarAgent>();
  let activeAgentId: string | null = null;
  for (const tab of tabs) {
    if (tab.target.kind !== "agent") continue;
    const agent = byId.get(tab.target.agentId);
    if (!agent) continue;
    ordered.set(agent.id, agent);
    if (tab.tabId === focusedPane?.focusedTabId) activeAgentId = agent.id;
  }
  for (const agent of agents) {
    if (agent.isWorkspaceRoot && !ordered.has(agent.id)) ordered.set(agent.id, agent);
  }
  const sortedAgents = Array.from(ordered.values()).sort(
    (left, right) => right.lastMessageAt - left.lastMessageAt || left.id.localeCompare(right.id),
  );
  return { agents: sortedAgents, activeAgentId };
}

export type SidebarSession =
  | { kind: "agent"; key: string; sortAt: number; agent: SidebarAgent }
  | { kind: "terminal"; key: string; sortAt: number; tab: WorkspaceTabDescriptor };

export function deriveSidebarSessionList(
  agents: readonly SidebarAgent[],
  layout: WorkspaceLayout | undefined,
) {
  const agentList = deriveSidebarAgentList(agents, layout);
  const items: SidebarSession[] = agentList.agents.map((agent) => ({
    kind: "agent",
    key: `agent:${agent.id}`,
    sortAt: agent.lastMessageAt,
    agent,
  }));
  let activeKey = agentList.activeAgentId ? `agent:${agentList.activeAgentId}` : null;
  const focusedPane = layout ? findPaneById(layout.root, layout.focusedPaneId) : null;
  const terminals = new Set<string>();
  for (const tab of layout ? collectAllTabs(layout.root) : []) {
    if (tab.target.kind !== "terminal") continue;
    const key = `terminal:${tab.target.terminalId}`;
    if (tab.tabId === focusedPane?.focusedTabId) activeKey = key;
    if (terminals.has(key)) continue;
    terminals.add(key);
    items.push({
      kind: "terminal",
      key,
      sortAt: tab.createdAt,
      tab: { key: tab.tabId, tabId: tab.tabId, kind: "terminal", target: tab.target },
    });
  }
  items.sort((left, right) => right.sortAt - left.sortAt || left.key.localeCompare(right.key));
  return { items, activeKey };
}
