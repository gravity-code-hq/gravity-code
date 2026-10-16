import { useCallback } from "react";
import {
  Pressable,
  Text,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Plus } from "lucide-react-native";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";

const ThemedPlus = withUnistyles(Plus);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

// Opens a draft agent tab inside this workspace. "New workspace" always mints another
// workspace, even on the same directory, so this is the sidebar's way to add an agent to a
// workspace that already exists. Sits beside the kebab and shares its reveal rule.
export function SidebarWorkspaceNewAgentButton({
  onPress,
  testID,
}: {
  onPress: () => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      // The button sits inside the row's own Pressable; don't also run the row press.
      event.stopPropagation();
      onPress();
    },
    [onPress],
  );

  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <Pressable
          hitSlop={4}
          style={triggerStyle}
          onPress={handlePress}
          accessibilityRole={isWeb ? undefined : "button"}
          accessibilityLabel={t("sidebar.workspace.actions.newAgent")}
          testID={testID}
        >
          {renderIcon}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <Text style={styles.tooltipText}>{t("sidebar.workspace.actions.newAgent")}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function renderIcon({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return (
    <ThemedPlus
      size={14}
      uniProps={hovered || pressed ? foregroundColorMapping : foregroundMutedColorMapping}
    />
  );
}

function triggerStyle({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.trigger, hovered && styles.triggerHovered];
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    padding: 2,
    borderRadius: 4,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
  tooltipText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.popoverForeground,
  },
}));
