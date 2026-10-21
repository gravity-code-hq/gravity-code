import { useCallback, useMemo, useState } from "react";
import { View, Text, type LayoutChangeEvent, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { DiffStat } from "@/components/diff-stat";
import {
  TreeChevron,
  treeRowPaddingLeft,
  workspaceTreeRowStyles,
  WORKSPACE_TREE_ICON_LABEL_GAP,
  WORKSPACE_TREE_ICON_SIZE,
} from "@/components/tree-primitives";
import { type Theme } from "@/styles/theme";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { FileActionsContextMenuContent } from "@/components/file-actions-menu";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import { DiscardChangesButton } from "@/git/discard-changes-button";

interface DiffFolderRowProps {
  /** full uncompressed directory path — the collapse identity */
  dirPath: string;
  displayName: string;
  depth: number;
  collapsed: boolean;
  isSelected: boolean;
  additions: number;
  deletions: number;
  onToggle: (dirPath: string) => void;
  onCollapse: (dirPath: string) => void;
  onSelect: (dirPath: string) => void;
  onHeightChange?: (height: number) => void;
  onCopyPath?: (path: string) => void;
  onCopyRelativePath?: (path: string) => void;
  onReveal?: (path: string) => void;
  revealTargetName?: string;
  onDuplicate?: (path: string) => void;
  onRevert?: (path: string) => void;
  testID?: string;
}

function folderRowPressableStyle(
  { pressed }: PressableStateCallbackType,
  isHovered: boolean,
  isSelected: boolean,
) {
  return [
    workspaceTreeRowStyles.row,
    (isHovered || pressed || isSelected) && workspaceTreeRowStyles.active,
  ];
}

export function DiffFolderRow({
  dirPath,
  displayName,
  depth,
  collapsed,
  isSelected,
  additions,
  deletions,
  onToggle,
  onCollapse,
  onSelect,
  onHeightChange,
  onCopyPath,
  onCopyRelativePath,
  onReveal,
  revealTargetName,
  onDuplicate,
  onRevert,
  testID,
}: DiffFolderRowProps) {
  const handleSelect = useCallback(() => {
    onSelect(dirPath);
  }, [dirPath, onSelect]);
  // Hover lives on the outer View so the nested discard button never steals it (docs/hover.md).
  const [isHovered, setIsHovered] = useState(false);
  const showNameHover = useCallback(() => setIsHovered(true), []);
  const hideNameHover = useCallback(() => setIsHovered(false), []);
  const isCompact = useIsCompactFormFactor();
  const showDiscard = Boolean(onRevert) && (isHovered || isNative || isCompact);

  const handlePress = useCallback(() => {
    const selection = isWeb ? window.getSelection() : null;
    if (selection && !selection.isCollapsed && selection.toString().length > 0) {
      return;
    }
    handleSelect();
    onToggle(dirPath);
  }, [dirPath, handleSelect, onToggle]);

  const pressableStyle = useCallback(
    (state: PressableStateCallbackType) => folderRowPressableStyle(state, isHovered, isSelected),
    [isHovered, isSelected],
  );

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      onHeightChange?.(event.nativeEvent.layout.height);
    },
    [onHeightChange],
  );

  const handleCollapse = useCallback(() => {
    onCollapse(dirPath);
  }, [dirPath, onCollapse]);

  const handleCopyPath = useCallback(() => {
    onCopyPath?.(dirPath);
  }, [dirPath, onCopyPath]);

  const handleCopyRelativePath = useCallback(() => {
    onCopyRelativePath?.(dirPath);
  }, [dirPath, onCopyRelativePath]);

  const handleReveal = useCallback(() => {
    onReveal?.(dirPath);
  }, [dirPath, onReveal]);

  const handleDuplicate = useCallback(() => {
    onDuplicate?.(dirPath);
  }, [dirPath, onDuplicate]);

  const handleRevert = useCallback(() => {
    onRevert?.(dirPath);
  }, [dirPath, onRevert]);

  const leftStyle = useMemo(
    () => [
      styles.left,
      inlineUnistylesStyle({
        paddingLeft: treeRowPaddingLeft(depth),
      }),
    ],
    [depth],
  );

  const accessibilityState = useMemo(
    () => ({ expanded: !collapsed, selected: isSelected }),
    [collapsed, isSelected],
  );

  return (
    <View
      style={styles.container}
      onLayout={handleLayout}
      onPointerEnter={showNameHover}
      onPointerLeave={hideNameHover}
      testID={testID}
    >
      <ContextMenu>
        <ContextMenuTrigger
          onPress={handlePress}
          onLongPress={handleSelect}
          onContextMenu={handleSelect}
          style={pressableStyle}
          accessibilityRole="button"
          accessibilityState={accessibilityState}
          aria-selected={isSelected}
          testID={testID ? `${testID}-toggle` : undefined}
        >
          <View style={leftStyle}>
            <View style={styles.chevronSlot}>
              <TreeChevron expanded={!collapsed} />
            </View>
            <Text
              style={[
                styles.folderName,
                workspaceTreeRowStyles.name,
                isHovered && workspaceTreeRowStyles.nameHovered,
              ]}
              numberOfLines={1}
              testID={testID ? `${testID}-name` : undefined}
            >
              {displayName}
            </Text>
          </View>
          <View style={styles.right}>
            {showDiscard ? (
              <View style={styles.inlineActionSlot}>
                <DiscardChangesButton
                  onPress={handleRevert}
                  testID={testID ? `${testID}-discard` : undefined}
                />
              </View>
            ) : null}
            <DiffStat
              additions={additions}
              deletions={deletions}
              testID={testID ? `${testID}-stat` : undefined}
            />
          </View>
        </ContextMenuTrigger>
        <FileActionsContextMenuContent
          fileKind="directory"
          onCollapseFolder={!collapsed ? handleCollapse : undefined}
          onCopyPath={onCopyPath ? handleCopyPath : undefined}
          onCopyRelativePath={onCopyRelativePath ? handleCopyRelativePath : undefined}
          onReveal={onReveal ? handleReveal : undefined}
          revealTargetName={revealTargetName}
          onDuplicate={onDuplicate ? handleDuplicate : undefined}
          onRevert={onRevert ? handleRevert : undefined}
          testIDPrefix={testID}
        />
      </ContextMenu>
    </View>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  container: {
    overflow: "hidden",
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: WORKSPACE_TREE_ICON_LABEL_GAP,
    flex: 1,
    minWidth: 0,
  },
  chevronSlot: {
    width: WORKSPACE_TREE_ICON_SIZE,
    height: WORKSPACE_TREE_ICON_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    gap: theme.spacing[1],
  },
  // Shorter than the button so revealing it never grows the row; the button overflows evenly.
  inlineActionSlot: {
    height: WORKSPACE_TREE_ICON_SIZE,
    justifyContent: "center",
  },
  folderName: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foreground,
    flexShrink: 1,
    minWidth: 0,
    userSelect: "none",
  },
}));
