import type { RadarTask } from "@gravity/protocol/radar/types";
import { Bot, GitPullRequest, MessageSquare, MoreVertical } from "lucide-react-native";
import { useCallback, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/ui/status-badge";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import {
  radarTaskKindLabelKey,
  radarTaskStatusBadge,
  resolveRadarTaskNote,
} from "@/radar/presentation";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { openExternalUrl } from "@/utils/open-external-url";
import { formatTimeAgo } from "@/utils/time";

const ThemedBot = withUnistyles(Bot);
const ThemedGitPullRequest = withUnistyles(GitPullRequest);
const ThemedMessageSquare = withUnistyles(MessageSquare);
const ThemedKebab = withUnistyles(MoreVertical);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

const MENU_ICON_SIZE = 14;

const openAgentLeading = <ThemedBot size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const openPullRequestLeading = (
  <ThemedGitPullRequest size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />
);
const openSlackMessageLeading = (
  <ThemedMessageSquare size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />
);

interface RadarTaskRowProps {
  serverId: string;
  task: RadarTask;
}

/**
 * One Slack message a radar acted on. Pressing the row opens the agent it
 * started; the kebab also reaches the PR and the Slack message.
 *
 * Hover lives on the outer plain View and press on the inner Pressable
 * (docs/hover.md), so the nested kebab never fights the row for hover.
 */
export function RadarTaskRow({ serverId, task }: RadarTaskRowProps): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);

  const { agentId, workspaceId } = task;
  const canOpenAgent = agentId !== null;
  const badge = radarTaskStatusBadge(task.status);
  const note = resolveRadarTaskNote(task);
  const kindLabelKey = radarTaskKindLabelKey(task.kind);
  const kindLabel = kindLabelKey ? t(kindLabelKey) : task.kind;
  const createdAgo = formatTimeAgo(new Date(task.createdAt));
  const metaParts = task.author ? [kindLabel, task.author, createdAgo] : [kindLabel, createdAgo];
  const openAgentLabel = t("radar.task.openAgentLabel", { summary: task.summary });

  const openAgent = useCallback(() => {
    if (!agentId) {
      return;
    }
    navigateToAgent({ serverId, agentId, workspaceId, pin: true });
  }, [agentId, serverId, workspaceId]);

  const rowStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      settingsStyles.row,
      settingsStyles.rowBorder,
      styles.row,
      canOpenAgent && isHovered && !isCompact && styles.rowHovered,
      canOpenAgent && pressed && styles.rowPressed,
    ],
    [canOpenAgent, isHovered, isCompact],
  );

  return (
    <View
      style={styles.rowContainer}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Pressable
        style={rowStyle}
        onPress={openAgent}
        disabled={!canOpenAgent}
        accessibilityRole="button"
        accessibilityLabel={canOpenAgent ? openAgentLabel : task.summary}
        testID={`radar-task-row-${task.id}`}
      >
        <View style={styles.textGroup}>
          <Text style={settingsStyles.rowTitle} numberOfLines={2}>
            {task.summary}
          </Text>
          <Text style={settingsStyles.rowHint} numberOfLines={1}>
            {metaParts.join(" · ")}
          </Text>
          {note ? (
            <Text
              style={note.tone === "danger" ? settingsStyles.rowError : settingsStyles.rowHint}
              numberOfLines={3}
              testID={`radar-task-note-${task.id}`}
            >
              {note.text}
            </Text>
          ) : null}
        </View>
        <View style={styles.trailing}>
          <StatusBadge label={t(badge.labelKey)} variant={badge.variant} />
          <View style={styles.menuSlot}>
            <RadarTaskMenu task={task} onOpenAgent={canOpenAgent ? openAgent : null} />
          </View>
        </View>
      </Pressable>
    </View>
  );
}

interface RadarTaskMenuProps {
  task: RadarTask;
  /** Null when the task has not started an agent yet. */
  onOpenAgent: (() => void) | null;
}

function RadarTaskMenu({ task, onOpenAgent }: RadarTaskMenuProps): ReactElement | null {
  const { t } = useTranslation();
  const { prUrl, permalink } = task;

  const openPullRequest = useCallback(() => {
    if (prUrl) {
      void openExternalUrl(prUrl);
    }
  }, [prUrl]);

  const openSlackMessage = useCallback(() => {
    if (permalink) {
      void openExternalUrl(permalink);
    }
  }, [permalink]);

  if (!onOpenAgent && !prUrl && !permalink) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        hitSlop={8}
        style={kebabTriggerStyle}
        accessibilityRole={isNative ? "button" : undefined}
        accessibilityLabel={t("radar.task.menu.label")}
        testID={`radar-task-kebab-${task.id}`}
      >
        {renderKebabTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={220}>
        {onOpenAgent ? (
          <DropdownMenuItem
            leading={openAgentLeading}
            onSelect={onOpenAgent}
            testID={`radar-task-open-agent-${task.id}`}
          >
            {t("radar.task.menu.openAgent")}
          </DropdownMenuItem>
        ) : null}
        {prUrl ? (
          <DropdownMenuItem
            leading={openPullRequestLeading}
            onSelect={openPullRequest}
            testID={`radar-task-open-pr-${task.id}`}
          >
            {t("radar.task.menu.openPullRequest")}
          </DropdownMenuItem>
        ) : null}
        {permalink ? (
          <DropdownMenuItem
            leading={openSlackMessageLeading}
            onSelect={openSlackMessage}
            testID={`radar-task-open-slack-${task.id}`}
          >
            {t("radar.task.menu.openSlackMessage")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function renderKebabTriggerIcon({ hovered }: { hovered?: boolean }): ReactElement {
  return (
    <ThemedKebab
      size={MENU_ICON_SIZE}
      uniProps={hovered ? foregroundColorMapping : mutedColorMapping}
    />
  );
}

function kebabTriggerStyle({
  hovered = false,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.kebabTrigger, hovered && styles.kebabTriggerHovered];
}

const styles = StyleSheet.create((theme) => ({
  rowContainer: {
    position: "relative",
  },
  row: {
    gap: theme.spacing[3],
  },
  rowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface3,
  },
  textGroup: {
    flex: 1,
    minWidth: 0,
  },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  // Holds the kebab's box even on a task with nothing to open, so the status
  // pills in a card share one trailing rail with the radar's own kebab.
  menuSlot: {
    width: MENU_ICON_SIZE + theme.spacing[1] * 2,
    height: MENU_ICON_SIZE + theme.spacing[1] * 2,
  },
  kebabTrigger: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
  },
  kebabTriggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
}));
