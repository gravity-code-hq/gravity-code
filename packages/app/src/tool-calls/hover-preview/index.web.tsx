import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { ToolCallDetailsContent } from "@/components/tool-call-details";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useHoverSafeZone } from "@/hooks/use-hover-safe-zone";
import { getOverlayRoot, OverlayLayerProvider, useOverlayLayer } from "@/lib/overlay-root";
import type { ToolCallHoverPreviewProps } from "./types";
import { ToolCallCopyButton } from "@/tool-calls/copy-button";

const OPEN_DELAY_MS = 3_800;
const CLOSE_DELAY_MS = 150;
const SCREEN_PADDING = 12;
const GAP = 8;
const HEADER_HEIGHT = 45;

interface PreviewPosition {
  left: number;
  top: number;
  width: number;
  height: number;
  above: boolean;
}

export function ToolCallHoverPreview(props: ToolCallHoverPreviewProps) {
  const active = useRetainedPanelActive();
  const compact = useIsCompactFormFactor();
  if (!isWeb || !active || compact) return props.children;
  return <DesktopToolCallHoverPreview {...props} />;
}

function DesktopToolCallHoverPreview(props: ToolCallHoverPreviewProps) {
  const { t } = useTranslation();
  const triggerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [position, setPosition] = useState<PreviewPosition | null>(null);
  const layer = useOverlayLayer("floating");

  const cancelOpen = useCallback(() => {
    if (openTimer.current !== null) clearTimeout(openTimer.current);
    openTimer.current = null;
  }, []);
  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const close = useCallback(() => {
    cancelOpen();
    cancelClose();
    setPosition(null);
  }, [cancelOpen, cancelClose]);
  const scheduleClose = useCallback(() => {
    cancelOpen();
    if (closeTimer.current !== null) return;
    closeTimer.current = setTimeout(close, CLOSE_DELAY_MS);
  }, [cancelOpen, close]);
  const scheduleOpen = useCallback(() => {
    cancelClose();
    cancelOpen();
    if (props.disabled || position) return;
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      const trigger = triggerRef.current;
      if (!trigger || !isWeb) return;
      const rect = trigger.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const below = window.innerHeight - rect.bottom - SCREEN_PADDING;
      const above = rect.top - SCREEN_PADDING;
      const placeAbove = above > below;
      const availableHeight = placeAbove ? above : below;
      const height = Math.min(480, availableHeight - GAP);
      if (height < HEADER_HEIGHT + 60) return;
      const width = Math.min(720, window.innerWidth - SCREEN_PADDING * 2);
      setPosition({
        left: Math.max(
          SCREEN_PADDING,
          Math.min(rect.left, window.innerWidth - width - SCREEN_PADDING),
        ),
        top: placeAbove ? rect.top - height - GAP : rect.bottom,
        width,
        height,
        above: placeAbove,
      });
    }, OPEN_DELAY_MS);
  }, [cancelClose, cancelOpen, position, props.disabled]);

  useHoverSafeZone({
    enabled: position !== null && !props.disabled,
    triggerRef,
    contentRef,
    onEnterSafeZone: cancelClose,
    onLeaveSafeZone: scheduleClose,
  });

  useEffect(() => {
    if (props.disabled) close();
    return () => {
      cancelOpen();
      cancelClose();
    };
  }, [cancelClose, cancelOpen, close, props.disabled]);

  useEffect(() => {
    if (!isWeb || !position) return;
    function closeOutside(event: Event) {
      if (event.target instanceof Node && contentRef.current?.contains(event.target)) return;
      close();
    }
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    document.addEventListener("scroll", closeOutside, true);
    document.addEventListener("mousedown", closeOutside, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      document.removeEventListener("scroll", closeOutside, true);
      document.removeEventListener("mousedown", closeOutside, true);
    };
  }, [close, position]);

  const frame = useMemo<CSSProperties | undefined>(() => {
    if (!position) return undefined;
    // Include the gap in the portal's hit area so it belongs to the hover safe zone.
    return {
      position: "fixed",
      left: position.left,
      top: position.top,
      width: position.width,
      height: position.height + GAP,
      boxSizing: "border-box",
      paddingTop: position.above ? 0 : GAP,
      paddingBottom: position.above ? GAP : 0,
      pointerEvents: "auto",
      zIndex: layer,
    };
  }, [layer, position]);
  const detailHeight = position ? position.height - HEADER_HEIGHT - 2 : 0;
  const scrollStyle = useMemo<CSSProperties>(
    () => ({
      maxHeight: detailHeight,
      overflow: "auto",
      overscrollBehavior: "contain",
    }),
    [detailHeight],
  );
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    },
    [close],
  );

  let popup = null;
  if (position && !props.disabled) {
    popup = createPortal(
      <OverlayLayerProvider layer={layer}>
        <div
          ref={contentRef}
          style={frame}
          data-testid="tool-call-hover-preview"
          role="dialog"
          aria-label={props.displayName}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onKeyDown={handleKeyDown}
        >
          <View style={styles.card}>
            <View style={styles.header}>
              <Text style={styles.title}>{props.displayName}</Text>
              <ToolCallCopyButton detail={props.detail} errorText={props.errorText} />
              <Button
                variant="ghost"
                size="xs"
                leftIcon={X}
                accessibilityLabel={t("common.actions.close")}
                testID="tool-call-hover-preview-close"
                onPress={close}
              />
            </View>
            <div style={scrollStyle}>
              <ToolCallDetailsContent
                toolName={props.toolName}
                detail={props.detail}
                errorText={props.errorText}
                showLoadingSkeleton={props.showLoadingSkeleton}
                maxHeight={detailHeight}
              />
            </div>
          </View>
        </div>
      </OverlayLayerProvider>,
      getOverlayRoot(),
    );
  }

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        onMouseDown={close}
      >
        {props.children}
      </div>
      {popup}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    height: "100%",
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    overflow: "hidden",
    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.2)",
  },
  header: {
    height: HEADER_HEIGHT,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  title: {
    flex: 1,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
}));
