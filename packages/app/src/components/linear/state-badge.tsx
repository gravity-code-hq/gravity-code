import { useMemo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";

export function linearStateBadgeVariant(type: string): StatusBadgeVariant {
  switch (type) {
    case "completed":
      return "success";
    case "started":
      return "warning";
    default:
      return "muted";
  }
}

/**
 * A workflow state as a status pill. The leading dot carries the state's own
 * Linear color, the same way PR labels carry their forge color; the text uses
 * the shared status token for the state's category.
 */
export function LinearStateBadge({
  state,
}: {
  state: { name: string; type: string; color: string };
}): ReactElement {
  const dot = useMemo(
    () => <View style={[styles.dot, { backgroundColor: state.color }]} />,
    [state.color],
  );
  return (
    <StatusBadge label={state.name} variant={linearStateBadgeVariant(state.type)} leading={dot} />
  );
}

const styles = StyleSheet.create((theme) => ({
  dot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
  },
}));
