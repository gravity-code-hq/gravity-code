import { Pressable, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

interface PromptSuggestionAcceptButtonProps {
  // Keyboard layouts show the key that accepts; touch layouts have no Tab key.
  showTabKey: boolean;
  onPress: () => void;
}

export function PromptSuggestionAcceptButton({
  showTabKey,
  onPress,
}: PromptSuggestionAcceptButtonProps) {
  const { t } = useTranslation();
  return (
    <Pressable
      testID="composer-prompt-suggestion-accept"
      accessibilityRole="button"
      accessibilityLabel={t("composer.promptSuggestion.acceptLabel")}
      onPress={onPress}
      hitSlop={8}
      style={styles.button}
    >
      {/* A key cap, like formatted shortcuts: not translated. */}
      <Text style={styles.label}>{showTabKey ? "Tab" : t("composer.promptSuggestion.accept")}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  button: {
    position: "absolute",
    top: 0,
    right: 0,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  label: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
