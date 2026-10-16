import { ExternalLink as ExternalLinkIcon, GitBranchPlus, MoreVertical } from "lucide-react-native";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { LinearIssue } from "@gravity/protocol/linear/types";
import { LinearPriorityIcon, linearPriorityKey } from "@/components/linear/priority-icon";
import {
  buildLinearRepoPage,
  LinearStartAgentButton,
  type LinearStartChoice,
} from "@/components/linear/start-agent-menu";
import { LinearStateBadge } from "@/components/linear/state-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  type MenuPageDefinition,
} from "@/components/ui/dropdown-menu";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import type { HostProjectListItem } from "@/projects/host-project-model";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import { formatTimeAgo } from "@/utils/time";

const ThemedKebab = withUnistyles(MoreVertical);
const ThemedGitBranchPlus = withUnistyles(GitBranchPlus);
const ThemedExternalLink = withUnistyles(ExternalLinkIcon);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

const MENU_ICON_SIZE = 14;

export interface LinearIssueRowProps {
  issue: LinearIssue;
  /** Repos on this host a start can target; shared by every row. */
  projects: HostProjectListItem[];
  isFirst: boolean;
  isStartingAgent: boolean;
  onPress: (issue: LinearIssue) => void;
  onConfigureAgent: (issue: LinearIssue) => void;
  onStartAgent: (issue: LinearIssue, choice: LinearStartChoice) => void;
  onOpenExternal: (issue: LinearIssue) => void;
}

/**
 * One issue as a flat list row: priority glyph, title, a muted meta line
 * (identifier · team · updated), then the state pill, the Start agent setup
 * button, and a kebab holding quick-start repos plus Open in Linear.
 * Status is read-only here; changing it belongs to the drawer.
 *
 * Hover follows docs/hover.md: the outer plain View owns hover, the inner
 * Pressable owns press, and the nested menu triggers never fight it.
 */
export function LinearIssueRow({
  issue,
  projects,
  isFirst,
  isStartingAgent,
  onPress,
  onStartAgent,
  onConfigureAgent,
  onOpenExternal,
}: LinearIssueRowProps): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const handlePress = useCallback(() => onPress(issue), [issue, onPress]);
  const handleConfigure = useCallback(() => onConfigureAgent(issue), [issue, onConfigureAgent]);
  const handleStart = useCallback(
    (choice: LinearStartChoice) => onStartAgent(issue, choice),
    [issue, onStartAgent],
  );
  const handleOpenExternal = useCallback(() => onOpenExternal(issue), [issue, onOpenExternal]);

  const updatedAgo = formatTimeAgo(new Date(issue.updatedAt));
  const priorityLabel = t(`linear.priority.${linearPriorityKey(issue.priority)}`);
  const stateBadge = <LinearStateBadge state={issue.state} />;

  const rowStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      settingsStyles.row,
      styles.row,
      !isFirst && settingsStyles.rowBorder,
      isHovered && !isCompact && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [isFirst, isHovered, isCompact],
  );

  return (
    <View
      style={styles.rowContainer}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Pressable
        style={rowStyle}
        onPress={handlePress}
        // A <button> cannot contain the Start agent <button> on web; the row
        // stays a plain element there and the inner controls carry the roles.
        accessibilityRole={isNative ? "button" : undefined}
        accessibilityLabel={`${issue.identifier} ${issue.title}`}
        testID={`linear-issue-row-${issue.identifier}`}
      >
        <View style={styles.main}>
          <View style={styles.leading}>
            <LinearPriorityIcon priority={issue.priority} accessibilityLabel={priorityLabel} />
          </View>
          <View style={styles.textGroup}>
            <Text style={settingsStyles.rowTitle} numberOfLines={isCompact ? 2 : 1}>
              {issue.title}
            </Text>
            <View style={styles.meta}>
              <Text style={styles.metaText} numberOfLines={1}>
                {[issue.identifier, issue.team.name, updatedAgo].join(" · ")}
              </Text>
              {isCompact ? stateBadge : null}
            </View>
          </View>
        </View>
        <View style={styles.trailing}>
          {isCompact ? null : <View style={styles.stateSlot}>{stateBadge}</View>}
          <LinearStartAgentButton
            identifier={issue.identifier}
            isStarting={isStartingAgent}
            compact={isCompact}
            onStart={handleConfigure}
          />
          <LinearIssueRowMenu
            issue={issue}
            projects={projects}
            onStart={handleStart}
            onOpenExternal={handleOpenExternal}
          />
        </View>
      </Pressable>
    </View>
  );
}

const worktreeLeading = <ThemedGitBranchPlus size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const openLeading = <ThemedExternalLink size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const START_PAGE_ID = "start";

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

/**
 * The row's kebab: Start agent (a page of repos) and Open in Linear.
 */
function LinearIssueRowMenu({
  issue,
  projects,
  onStart,
  onOpenExternal,
}: {
  issue: LinearIssue;
  projects: HostProjectListItem[];
  onStart: (choice: LinearStartChoice) => void;
  onOpenExternal: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const pages = useMemo<MenuPageDefinition[]>(
    () => [
      buildLinearRepoPage({
        id: START_PAGE_ID,
        title: t("linear.issue.startAgent"),
        projects,
        onStart,
        testIDPrefix: `linear-issue-menu-start-${issue.identifier}`,
      }),
    ],
    [issue.identifier, onStart, projects, t],
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        hitSlop={8}
        style={kebabTriggerStyle}
        accessibilityRole={isNative ? "button" : undefined}
        accessibilityLabel={`${t("linear.issue.actions")}: ${issue.identifier}`}
        testID={`linear-issue-menu-${issue.identifier}`}
      >
        {renderKebabTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        width={280}
        pages={pages}
        sheetTitle={t("linear.issue.actions")}
      >
        <DropdownMenuSubTrigger
          id={START_PAGE_ID}
          leading={worktreeLeading}
          testID={`linear-issue-menu-start-${issue.identifier}`}
        >
          {t("linear.issue.startAgent")}
        </DropdownMenuSubTrigger>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          leading={openLeading}
          onSelect={onOpenExternal}
          testID={`linear-issue-menu-open-${issue.identifier}`}
        >
          {t("linear.issue.open")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  rowContainer: {
    position: "relative",
  },
  row: {
    gap: theme.spacing[3],
  },
  rowHovered: {
    backgroundColor: theme.colors.surface1,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  main: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
  },
  leading: {
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  textGroup: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1.5],
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  metaText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    flexShrink: 0,
  },
  stateSlot: {
    minWidth: 104,
    alignItems: "flex-end",
  },
  kebabTrigger: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
  },
  kebabTriggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
}));
