import { useCallback } from "react";
import { Pressable, type PressableStateCallbackType } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { Undo2 } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import {
  iconButtonChromeGlyphSize,
  iconButtonChromeStyle,
  mutedIconColorMapping,
} from "@/components/ui/icon-button-chrome";

const ThemedUndo2 = withUnistyles(Undo2);

/**
 * Inline discard for a changed file or folder row. No tooltip: the row it sits in already
 * owns a path tooltip, and two would stack. The caller's handler confirms before discarding.
 */
export function DiscardChangesButton({
  onPress,
  testID,
}: {
  onPress: () => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const style = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) =>
      iconButtonChromeStyle({ size: "small", state: { hovered, pressed } }),
    [],
  );
  return (
    <Pressable
      onPress={onPress}
      style={style}
      accessibilityRole="button"
      accessibilityLabel={t("workspace.fileActions.revert")}
      testID={testID}
    >
      <ThemedUndo2
        size={iconButtonChromeGlyphSize("small")}
        strokeWidth={1.5}
        uniProps={mutedIconColorMapping}
      />
    </Pressable>
  );
}
