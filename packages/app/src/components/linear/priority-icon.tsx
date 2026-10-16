import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

const ICON_SIZE = 16;
const BAR_WIDTH = 3;
const BAR_HEIGHTS = [5, 8, 11] as const;

export type LinearPriorityKey = "none" | "urgent" | "high" | "medium" | "low";

export function linearPriorityKey(priority: number): LinearPriorityKey {
  switch (priority) {
    case 1:
      return "urgent";
    case 2:
      return "high";
    case 3:
      return "medium";
    case 4:
      return "low";
    default:
      return "none";
  }
}

function activeBarCount(priority: number): number {
  switch (priority) {
    case 2:
      return 3;
    case 3:
      return 2;
    case 4:
      return 1;
    default:
      return 0;
  }
}

/**
 * Linear's priority glyphs: an urgent square, an empty circle for "no
 * priority", and one to three signal bars for low, medium, and high.
 */
export function LinearPriorityIcon({
  priority,
  accessibilityLabel,
}: {
  priority: number;
  accessibilityLabel: string;
}): ReactElement {
  if (priority === 1) {
    return (
      <View style={styles.urgent} accessibilityLabel={accessibilityLabel}>
        <Text style={styles.urgentText}>!</Text>
      </View>
    );
  }
  if (priority === 0) {
    return (
      <View style={styles.frame} accessibilityLabel={accessibilityLabel}>
        <View style={styles.noneCircle} />
      </View>
    );
  }
  const active = activeBarCount(priority);
  return (
    <View style={[styles.frame, styles.bars]} accessibilityLabel={accessibilityLabel}>
      {BAR_HEIGHTS.map((height, index) => (
        <View
          key={height}
          style={[styles.bar, { height }, index < active ? styles.barActive : styles.barInactive]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  frame: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  urgent: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.statusWarning,
    alignItems: "center",
    justifyContent: "center",
  },
  urgentText: {
    color: theme.colors.primaryForeground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    lineHeight: ICON_SIZE,
  },
  noneCircle: {
    width: 12,
    height: 12,
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderStyle: "dashed",
    borderColor: theme.colors.foregroundMuted,
  },
  bars: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 1,
    paddingBottom: 1,
  },
  bar: {
    width: BAR_WIDTH,
    borderRadius: 1,
  },
  barActive: {
    backgroundColor: theme.colors.foregroundMuted,
  },
  barInactive: {
    backgroundColor: theme.colors.border,
  },
}));
