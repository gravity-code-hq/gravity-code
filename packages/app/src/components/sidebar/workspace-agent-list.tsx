import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { ActivityIndicator, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { applyArchivedAgentCloseResults } from "@/hooks/use-archive-agent";
import { confirmDialog } from "@/utils/confirm-dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Archive, Pencil } from "lucide-react-native";
import type { Theme } from "@/styles/theme";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { SidebarMenuTrigger } from "./sidebar-menu-trigger";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { getProviderIcon } from "@/components/provider-icons";
import {
  WorkspaceTabIcon,
  WorkspaceTabPresentationResolver,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { getSidebarRowBackdrop } from "./sidebar-row-backdrop";
import { SidebarGroupToggleRow } from "./sidebar-group-toggle-row";
import { useLimitedSidebarGroup } from "./use-limited-sidebar-group";
import { deriveSidebarSessionList, type SidebarAgent } from "./workspace-agent-model";

const ThemedArchive = withUnistyles(Archive);
const ThemedPencil = withUnistyles(Pencil);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const archiveIcon = <ThemedArchive size={14} uniProps={mutedColorMapping} />;
const renameIcon = <ThemedPencil size={14} uniProps={mutedColorMapping} />;

interface ConversationMenuAction {
  key: "rename" | "archive";
  label: string;
  leading: ReactElement;
  testID: string;
  onSelect: () => void;
  disabled: boolean;
}

function ConversationMenuItems({ actions }: { actions: ConversationMenuAction[] }) {
  return actions.map(({ key, label, ...props }) => (
    <DropdownMenuItem key={key} {...props}>
      {label}
    </DropdownMenuItem>
  ));
}

export function SidebarWorkspaceAgentList({
  workspace,
  selected,
  onWorkspacePress,
}: {
  workspace: SidebarWorkspaceEntry;
  selected: boolean;
  onWorkspacePress?: () => void;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(workspace.serverId);
  const queryClient = useQueryClient();
  const [renamingAgent, setRenamingAgent] = useState<SidebarAgent | null>(null);
  const closeRename = useCallback(() => setRenamingAgent(null), []);
  const submitRename = useCallback(
    async (title: string) => {
      if (!renamingAgent) return;
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      await client.updateAgent(renamingAgent.id, { name: title.trim() });
      void queryClient.invalidateQueries({ queryKey: ["sidebarAgentsList", workspace.serverId] });
      void queryClient.invalidateQueries({ queryKey: ["allAgents", workspace.serverId] });
    },
    [client, queryClient, renamingAgent, workspace.serverId, t],
  );
  const archiveMutation = useMutation({
    mutationFn: async (agentId: string) => {
      const agent = useSessionStore.getState().sessions[workspace.serverId]?.agents.get(agentId);
      const needsConfirmation = agent?.status === "running" || agent?.status === "initializing";
      if (needsConfirmation) {
        const confirmed = await confirmDialog({
          title: t("workspace.tabs.confirmations.archiveRunningAgentTitle"),
          message: t("workspace.tabs.confirmations.archiveRunningAgentMessage"),
          confirmLabel: t("workspace.tabs.confirmations.archive"),
          cancelLabel: t("common.actions.cancel"),
          destructive: true,
        });
        if (!confirmed) return null;
      }
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      return client.archiveAgent(agentId);
    },
    onSuccess: (result, agentId) => {
      if (!result) return;
      applyArchivedAgentCloseResults({
        queryClient,
        serverId: workspace.serverId,
        results: [{ agentId, archivedAt: result.archivedAt }],
      });
    },
  });
  const archiveAgent = archiveMutation.mutate;
  const handleArchive = useCallback(
    (agentId: string) => {
      archiveAgent(agentId);
    },
    [archiveAgent],
  );
  const retryArchive = useCallback(() => {
    if (archiveMutation.variables) archiveAgent(archiveMutation.variables);
  }, [archiveAgent, archiveMutation.variables]);
  const layout = useWorkspaceLayoutStore(
    (state) => state.layoutByWorkspace[workspace.workspaceKey],
  );
  const list = useMemo(
    () => deriveSidebarSessionList(workspace.agents, layout),
    [workspace.agents, layout],
  );
  const { visibleItems, expanded, canToggle, toggleExpanded } = useLimitedSidebarGroup(
    list.items,
    6,
  );
  if (list.items.length === 0) return null;

  return (
    <View style={styles.list} testID={`sidebar-workspace-agents-${workspace.workspaceKey}`}>
      {visibleItems.map((item) =>
        item.kind === "agent" ? (
          <SidebarAgentRow
            key={item.key}
            agent={item.agent}
            onRename={setRenamingAgent}
            onArchive={handleArchive}
            archiveDisabled={archiveMutation.isPending}
            isArchiving={archiveMutation.isPending && archiveMutation.variables === item.agent.id}
            serverId={workspace.serverId}
            workspaceId={workspace.workspaceId}
            selected={selected && list.activeKey === item.key}
            onWorkspacePress={onWorkspacePress}
          />
        ) : (
          <WorkspaceTabPresentationResolver
            key={item.key}
            tab={item.tab}
            serverId={workspace.serverId}
            workspaceId={workspace.workspaceId}
          >
            {(presentation) => (
              <SidebarSessionRow
                presentation={presentation}
                target={item.tab.target}
                testID={`sidebar-terminal-${workspace.serverId}:${item.key.slice("terminal:".length)}`}
                serverId={workspace.serverId}
                workspaceId={workspace.workspaceId}
                selected={selected && list.activeKey === item.key}
                onWorkspacePress={onWorkspacePress}
              />
            )}
          </WorkspaceTabPresentationResolver>
        ),
      )}
      {archiveMutation.isError ? (
        <Alert
          variant="error"
          description={archiveMutation.error.message}
          testID={`sidebar-conversation-archive-error-${workspace.workspaceId}`}
        >
          <Button size="sm" variant="secondary" onPress={retryArchive}>
            {t("common.actions.retry")}
          </Button>
          <Button size="sm" variant="ghost" onPress={archiveMutation.reset}>
            {t("common.actions.dismiss")}
          </Button>
        </Alert>
      ) : null}
      {renamingAgent ? (
        <AdaptiveRenameModal
          key={renamingAgent.id}
          visible
          title={t("workspace.tabs.menu.renameAgent")}
          initialValue={renamingAgent.title ?? ""}
          submitLabel={t("workspace.tabs.menu.rename")}
          maxLength={200}
          onClose={closeRename}
          onSubmit={submitRename}
          testID={`sidebar-conversation-rename-${renamingAgent.id}`}
        />
      ) : null}
      {canToggle ? (
        <SidebarGroupToggleRow
          expanded={expanded}
          onPress={toggleExpanded}
          testID={`sidebar-workspace-agents-toggle-${workspace.workspaceKey}`}
        />
      ) : null}
    </View>
  );
}

const SidebarAgentRow = memo(function SidebarAgentRow({
  agent,
  onRename,
  onArchive,
  isArchiving,
  archiveDisabled,
  serverId,
  workspaceId,
  selected,
  onWorkspacePress,
}: {
  agent: SidebarAgent;
  onRename: (agent: SidebarAgent) => void;
  onArchive: (agentId: string) => void;
  isArchiving: boolean;
  archiveDisabled: boolean;
  serverId: string;
  workspaceId: string;
  selected: boolean;
  onWorkspacePress?: () => void;
}) {
  const { t } = useTranslation();
  const handleRename = useCallback(() => onRename(agent), [agent, onRename]);
  const handleArchive = useCallback(() => onArchive(agent.id), [agent.id, onArchive]);
  const title = agent.title || t("agentList.fallbackTitle");
  const presentation = useMemo(
    () => ({
      key: agent.id,
      kind: "agent" as const,
      label: title,
      subtitle: "",
      tooltip: title,
      modified: false,
      titleState: "ready" as const,
      icon: getProviderIcon(agent.provider, serverId),
      statusBucket: agent.statusBucket,
    }),
    [agent, serverId, title],
  );
  const target = useMemo(() => ({ kind: "agent" as const, agentId: agent.id }), [agent.id]);
  return (
    <SidebarSessionRow
      presentation={presentation}
      onRename={handleRename}
      onArchive={handleArchive}
      isArchiving={isArchiving}
      archiveDisabled={archiveDisabled}
      target={target}
      testID={`sidebar-agent-${serverId}:${agent.id}`}
      serverId={serverId}
      workspaceId={workspaceId}
      selected={selected}
      onWorkspacePress={onWorkspacePress}
    />
  );
});

const SidebarSessionRow = memo(function SidebarSessionRow({
  presentation,
  onRename,
  onArchive,
  isArchiving = false,
  archiveDisabled = false,
  target,
  testID,
  serverId,
  workspaceId,
  selected,
  onWorkspacePress,
}: {
  presentation: WorkspaceTabPresentation;
  onRename?: () => void;
  onArchive?: () => void;
  isArchiving?: boolean;
  archiveDisabled?: boolean;
  target: WorkspaceTabTarget;
  testID: string;
  serverId: string;
  workspaceId: string;
  selected: boolean;
  onWorkspacePress?: () => void;
}) {
  const { t } = useTranslation();
  const [isHovered, setHovered] = useState(false);
  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);
  const menuTestIDBase = `sidebar-conversation-menu-${presentation.key}`;
  const menuEntries = useMemo<ConversationMenuAction[]>(() => {
    const entries: ConversationMenuAction[] = [];
    if (onRename)
      entries.push({
        key: "rename",
        label: t("workspace.tabs.menu.rename"),
        leading: renameIcon,
        testID: `${menuTestIDBase}-rename`,
        onSelect: onRename,
        disabled: isArchiving,
      });
    if (onArchive)
      entries.push({
        key: "archive",
        label: t("workspace.tabs.confirmations.archive"),
        leading: archiveIcon,
        testID: `${menuTestIDBase}-archive`,
        onSelect: onArchive,
        disabled: archiveDisabled,
      });
    return entries;
  }, [onRename, onArchive, isArchiving, archiveDisabled, menuTestIDBase, t]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const handlePress = useCallback(() => {
    onWorkspacePress?.();
    navigateToWorkspace({ serverId, workspaceId, target });
  }, [target, onWorkspacePress, serverId, workspaceId]);
  const rowStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType) => [
      styles.row,
      hovered && styles.hovered,
      selected && styles.selected,
      pressed && styles.pressed,
    ],
    [selected],
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger
        enabled={Boolean(onRename)}
        accessibilityRole="button"
        accessibilityLabel={presentation.label}
        accessibilityState={accessibilityState}
        aria-selected={selected}
        testID={testID}
        onPress={handlePress}
        onHoverIn={handleHoverIn}
        onHoverOut={handleHoverOut}
        style={rowStyle}
      >
        <WorkspaceTabIcon
          presentation={presentation}
          active={selected}
          backdrop={getSidebarRowBackdrop({ selected, isHovered, isPressed: false })}
        />
        <Text
          numberOfLines={1}
          style={[styles.title, onRename && styles.titleWithMenu, selected && styles.selectedTitle]}
        >
          {presentation.label}
        </Text>
        {isArchiving ? (
          <View style={styles.menu}>
            <ActivityIndicator
              size="small"
              accessibilityLabel={t("sidebar.workspace.actions.archiving")}
              testID={`sidebar-conversation-archiving-${presentation.key}`}
            />
          </View>
        ) : null}
        {onRename && !isArchiving ? (
          <View style={styles.menu}>
            <DropdownMenu compactMode="sheet">
              <SidebarMenuTrigger
                testID={`${menuTestIDBase}-trigger`}
                accessibilityLabel={t("workspace.tabs.menu.openFor", { label: presentation.label })}
              />
              <DropdownMenuContent
                align="end"
                width={260}
                sheetTitle={presentation.label}
                testID={menuTestIDBase}
              >
                <ConversationMenuItems actions={menuEntries} />
              </DropdownMenuContent>
            </DropdownMenu>
          </View>
        ) : null}
      </ContextMenuTrigger>
      {onRename ? (
        <ContextMenuContent align="start" width={260} sheetTitle={presentation.label}>
          <ConversationMenuItems actions={menuEntries} />
        </ContextMenuContent>
      ) : null}
    </ContextMenu>
  );
});

const styles = StyleSheet.create((theme) => ({
  list: {
    marginLeft: theme.spacing[6],
    marginBottom: theme.spacing[2],
  },
  row: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    marginBottom: theme.spacing[0.5],
    borderRadius: theme.borderRadius.lg,
  },
  menu: {
    position: "absolute",
    right: theme.spacing[2],
  },
  titleWithMenu: { marginRight: 28 },
  hovered: { backgroundColor: theme.colors.surfaceSidebarHover },
  selected: { backgroundColor: theme.colors.surfaceSidebarSelected },
  pressed: { backgroundColor: theme.colors.surface2 },
  title: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  selectedTitle: { color: theme.colors.foreground },
}));
