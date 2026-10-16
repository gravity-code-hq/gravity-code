import { useCallback, useId, useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import { useTranslation } from "react-i18next";
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from "react-native-svg";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ICON_SIZE, type Theme } from "@/styles/theme";

// Height a long message is clamped to while collapsed.
const COLLAPSED_MAX_HEIGHT = 240;
// Content has to exceed this before it collapses. Clamping a message that is only a line or two
// over the limit costs a click and hides almost nothing. It also caps the first, unmeasured
// render, so a long message never paints at full height before it collapses.
const COLLAPSE_THRESHOLD = 360;
const FADE_HEIGHT = 48;

function CollapseFadeSvg({ color }: { color: string }) {
  // React-generated ids contain characters that are invalid inside SVG fragment references.
  const gradientId = `user-message-fade-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <Svg width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <SvgLinearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor={color} stopOpacity={0} />
          <Stop offset="100%" stopColor={color} stopOpacity={1} />
        </SvgLinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

const ThemedCollapseFadeSvg = withUnistyles(CollapseFadeSvg);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronUp = withUnistyles(ChevronUp);
const bubbleColorMapping = (theme: Theme) => ({ color: theme.colors.surface3 });
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const activeIconMapping = (theme: Theme) => ({ color: theme.colors.foreground });

/**
 * Clamps a long user message inside its bubble, with a toggle to read the rest. The content is
 * measured unclipped, so the decision follows the rendered height on every platform and width.
 */
export function CollapsibleUserMessageBody({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const isCollapsible = contentHeight !== null && contentHeight > COLLAPSE_THRESHOLD;
  const isCollapsed = isCollapsible && !isExpanded;

  const handleContentLayout = useCallback((event: LayoutChangeEvent) => {
    setContentHeight(event.nativeEvent.layout.height);
  }, []);
  const handleToggle = useCallback(() => setIsExpanded((expanded) => !expanded), []);
  const toggleAccessibilityState = useMemo(() => ({ expanded: isExpanded }), [isExpanded]);

  let clipStyle = null;
  if (contentHeight === null) clipStyle = styles.clipUnmeasured;
  else if (isCollapsed) clipStyle = styles.clipCollapsed;

  return (
    <View>
      <View style={clipStyle}>
        <View onLayout={handleContentLayout}>{children}</View>
        {isCollapsed ? (
          <View style={styles.fade} pointerEvents="none">
            <ThemedCollapseFadeSvg uniProps={bubbleColorMapping} />
          </View>
        ) : null}
      </View>
      {isCollapsible ? (
        <Pressable
          onPress={handleToggle}
          style={styles.toggle}
          accessibilityRole="button"
          accessibilityState={toggleAccessibilityState}
          testID="user-message-expand-toggle"
        >
          {({ hovered, pressed }) => {
            const isActive = hovered || pressed;
            const iconMapping = isActive ? activeIconMapping : mutedIconMapping;
            return (
              <>
                <Text style={[styles.toggleLabel, isActive && styles.toggleLabelActive]}>
                  {isExpanded
                    ? t("message.actions.collapseMessage")
                    : t("message.actions.expandMessage")}
                </Text>
                {isExpanded ? (
                  <ThemedChevronUp size={ICON_SIZE.sm} uniProps={iconMapping} />
                ) : (
                  <ThemedChevronDown size={ICON_SIZE.sm} uniProps={iconMapping} />
                )}
              </>
            );
          }}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  clipUnmeasured: {
    maxHeight: COLLAPSE_THRESHOLD,
    overflow: "hidden",
  },
  clipCollapsed: {
    maxHeight: COLLAPSED_MAX_HEIGHT,
    overflow: "hidden",
  },
  fade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: FADE_HEIGHT,
  },
  toggle: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    marginTop: theme.spacing[2],
  },
  toggleLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  toggleLabelActive: {
    color: theme.colors.foreground,
  },
}));
