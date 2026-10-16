import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { MoreHorizontal } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { iconButtonChromeStyle } from "@/components/ui/icon-button-chrome";
import type { MenuTriggerState } from "@/components/ui/menu/menu-root";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MAX_TEXT_SIZE, MIN_TEXT_SIZE, type ZoomDirection } from "@/zoom/text-size";
import type { Theme } from "@/styles/theme";

const ThemedEllipsis = withUnistyles(MoreHorizontal);
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function triggerStyle(state: MenuTriggerState) {
  return iconButtonChromeStyle({ size: "large", state });
}

interface TerminalTextSizeMenuProps {
  fontSize: number;
  onZoom: (direction: ZoomDirection) => void;
}

export function TerminalTextSizeMenu({ fontSize, onZoom }: TerminalTextSizeMenuProps) {
  const { t } = useTranslation();
  const increase = useCallback(() => onZoom("in"), [onZoom]);
  const decrease = useCallback(() => onZoom("out"), [onZoom]);
  const reset = useCallback(() => onZoom("reset"), [onZoom]);
  const pages = useMemo(
    () => [
      {
        id: "text-size",
        title: t("workspace.zoom.textSize"),
        hoverIntent: false,
        content: (
          <>
            <View style={styles.controls}>
              <Button
                variant="ghost"
                size="sm"
                accessibilityLabel={t("workspace.zoom.decrease")}
                testID="terminal-text-decrease"
                disabled={fontSize <= MIN_TEXT_SIZE}
                onPress={decrease}
              >
                −
              </Button>
              <Text style={styles.value} testID="terminal-text-size">
                {fontSize} px
              </Text>
              <Button
                variant="ghost"
                size="sm"
                accessibilityLabel={t("workspace.zoom.increase")}
                testID="terminal-text-increase"
                disabled={fontSize >= MAX_TEXT_SIZE}
                onPress={increase}
              >
                +
              </Button>
            </View>
            <DropdownMenuItem testID="terminal-text-reset" onSelect={reset}>
              {t("workspace.zoom.reset")}
            </DropdownMenuItem>
          </>
        ),
      },
    ],
    [fontSize, increase, decrease, reset, t],
  );

  return (
    <View style={styles.toolbar}>
      <DropdownMenu>
        <DropdownMenuTrigger
          style={triggerStyle}
          testID="terminal-options"
          accessibilityRole="button"
          accessibilityLabel={t("workspace.zoom.terminalOptions")}
        >
          <ThemedEllipsis size={16} uniProps={mutedIcon} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" pages={pages} minWidth={176}>
          <DropdownMenuSubTrigger
            id="text-size"
            value={`${fontSize} px`}
            testID="terminal-text-size-menu"
          >
            {t("workspace.zoom.textSize")}
          </DropdownMenuSubTrigger>
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  toolbar: { alignItems: "flex-end", paddingHorizontal: theme.spacing[2] },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[2],
  },
  value: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
}));
