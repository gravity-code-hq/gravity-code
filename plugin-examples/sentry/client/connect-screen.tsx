import type { PluginTheme } from "@gravity/plugin";
import { ScrollView } from "@gravity/plugin/client/react-native";
import { useMemo } from "react";
import { View } from "react-native";
import { ConnectGuide } from "./connect-guide";

/** The connect guide as a full screen body, for the sidebar surface. */
export function ConnectScreen({
  theme,
  compact,
  hostLabel,
}: {
  theme: PluginTheme;
  compact: boolean;
  hostLabel: string;
}) {
  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: {
        alignItems: "center" as const,
        paddingHorizontal: compact ? 16 : 32,
        paddingVertical: compact ? 20 : 40,
      },
      column: { width: "100%" as const, maxWidth: 560 },
    }),
    [compact, theme],
  );
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.column}>
        <ConnectGuide theme={theme} hostLabel={hostLabel} />
      </View>
    </ScrollView>
  );
}
