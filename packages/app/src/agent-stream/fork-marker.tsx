import { Text, View } from "react-native";
import { GitFork } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ForkIcon = withUnistyles(GitFork);
const forkIconProps = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export function ForkMarker({ sourceTitle }: { sourceTitle: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.container} testID="fork-marker">
      <View style={styles.line} />
      <ForkIcon size={ICON_SIZE.sm} uniProps={forkIconProps} />
      <Text style={styles.label} numberOfLines={1}>
        {t("message.forkedFrom", { title: sourceTitle })}
      </Text>
      <View style={styles.line} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginVertical: theme.spacing[6],
  },
  line: { flex: 1, height: 1, backgroundColor: theme.colors.border },
  label: { flexShrink: 1, fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
}));
