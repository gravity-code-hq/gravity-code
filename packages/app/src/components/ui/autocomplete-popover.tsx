import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";
import { View, useWindowDimensions } from "react-native";
import { Portal } from "@gorhom/portal";
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import {
  Autocomplete,
  FILE_PATH_PREVIEW_WIDTH,
  type AutocompleteOption,
} from "@/components/ui/autocomplete";
import {
  measureFloatingPanelPortalHost,
  useFloatingPanelPortalHostName,
} from "@/components/ui/floating-panel-portal";
import { useKeyboardShift } from "@/hooks/keyboard-shift-context";
import { SPACING } from "@/styles/theme";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { useIsCompactFormFactor } from "@/constants/layout";

const OFFSET_FROM_ANCHOR = SPACING[3];

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RelativeAnchorRect {
  x: number;
  y: number;
  width: number;
  hostHeight: number;
  hostWidth: number;
}

interface PopoverLayoutInput {
  anchor: RelativeAnchorRect | null;
  fileMode: boolean;
  isCompact: boolean;
  hasResults: boolean;
  isLoading: boolean | undefined;
  errorMessage: string | undefined;
  safeAreaTop: number;
}

interface PopoverLayout {
  width: number;
  maxHeight: number;
  filePreviewPlacement: "side" | "footer" | undefined;
}

function resolvePopoverLayout(input: PopoverLayoutInput): PopoverLayout {
  const { anchor, fileMode, isCompact, hasResults, isLoading, errorMessage, safeAreaTop } = input;
  if (!anchor) return { width: 0, maxHeight: 0, filePreviewPlacement: undefined };
  const heightLimit = fileMode ? 360 : 220;
  const availableHeight = Math.max(0, anchor.y - safeAreaTop - OFFSET_FROM_ANCHOR * 2);
  const maxHeight = Math.min(heightLimit, availableHeight);
  if (!fileMode) return { width: anchor.width, maxHeight, filePreviewPlacement: undefined };
  const listWidth = Math.min(anchor.width, 360);
  const remainingWidth = anchor.hostWidth - anchor.x - listWidth - SPACING[4];
  const showSidePreview = !isCompact && remainingWidth >= FILE_PATH_PREVIEW_WIDTH + SPACING[2];
  const hasPreview = hasResults && !isLoading && !errorMessage;
  const width =
    showSidePreview && hasPreview ? listWidth + FILE_PATH_PREVIEW_WIDTH + SPACING[2] : listWidth;
  const filePreviewPlacement = showSidePreview ? "side" : "footer";
  return { width, maxHeight, filePreviewPlacement };
}

function measureElement(element: View): Promise<Rect> {
  return new Promise((resolve) => {
    element.measureInWindow((x, y, width, height) => {
      resolve({ x, y, width, height });
    });
  });
}

interface AutocompletePopoverProps {
  visible: boolean;
  anchorRef: RefObject<View | null>;
  options: readonly AutocompleteOption[];
  selectedIndex: number;
  onSelect: (option: AutocompleteOption) => void;
  isLoading?: boolean;
  errorMessage?: string;
  loadingText?: string;
  emptyText?: string;
  fileMode?: boolean;
  onHighlight: (index: number) => void;
}

export function AutocompletePopover({
  visible,
  anchorRef,
  options,
  selectedIndex,
  onSelect,
  isLoading,
  errorMessage,
  loadingText,
  emptyText,
  fileMode = false,
  onHighlight,
}: AutocompletePopoverProps): ReactElement | null {
  "use no memo";
  // React Compiler memoizes effect captures by reading SharedValue.value during render.
  const [relativeAnchorRect, setRelativeAnchorRect] = useState<RelativeAnchorRect | null>(null);
  const windowDimensions = useWindowDimensions();
  const isCompact = useIsCompactFormFactor();
  const safeAreaInsets = useSafeAreaInsets();
  const portalHostName = useFloatingPanelPortalHostName();
  const { shift, isMoving } = useKeyboardShift();
  const measuredShift = useSharedValue(0);
  const measurementGeneration = useRef(0);
  const canMeasure = visible && (options.length === 0 || selectedIndex >= 0);

  const remeasure = useCallback(() => {
    if (!canMeasure) return;
    const anchorElement = anchorRef.current;
    if (!anchorElement) return;
    const generation = measurementGeneration.current;
    void Promise.all([
      measureElement(anchorElement),
      measureFloatingPanelPortalHost(portalHostName),
    ]).then(([anchorRect, hostRect]) => {
      if (generation !== measurementGeneration.current || !hostRect) return undefined;
      setRelativeAnchorRect({
        x: anchorRect.x - hostRect.x,
        y: anchorRect.y - hostRect.y,
        width: anchorRect.width,
        hostHeight: hostRect.height,
        hostWidth: hostRect.width,
      });
      measuredShift.value = shift.value;
      return undefined;
    });
  }, [anchorRef, canMeasure, measuredShift, portalHostName, shift]);

  useEffect(() => {
    measurementGeneration.current += 1;
    if (!canMeasure) {
      setRelativeAnchorRect(null);
      return;
    }

    remeasure();
    const raf = requestAnimationFrame(remeasure);

    return () => {
      measurementGeneration.current += 1;
      cancelAnimationFrame(raf);
    };
  }, [canMeasure, remeasure, windowDimensions.width, windowDimensions.height]);

  useAnimatedReaction(
    () => isMoving.value,
    (moving, wasMoving) => {
      if (wasMoving && !moving) {
        scheduleOnRN(remeasure);
      }
    },
    [isMoving, remeasure],
  );

  const layout = resolvePopoverLayout({
    anchor: relativeAnchorRect,
    fileMode,
    isCompact,
    hasResults: options.length > 0,
    isLoading,
    errorMessage,
    safeAreaTop: safeAreaInsets.top,
  });
  const baseStyle = useMemo(() => {
    if (!relativeAnchorRect) return null;
    return inlineUnistylesStyle({
      position: "absolute" as const,
      left: relativeAnchorRect.x,
      width: layout.width,
    });
  }, [relativeAnchorRect, layout.width]);

  const anchorY = relativeAnchorRect?.y ?? 0;
  const baseBottom = relativeAnchorRect
    ? relativeAnchorRect.hostHeight - relativeAnchorRect.y + OFFSET_FROM_ANCHOR
    : 0;
  const keyboardLayoutStyle = useAnimatedStyle(() => {
    const shiftDelta = shift.value - measuredShift.value;
    return {
      bottom: baseBottom + shiftDelta,
      maxHeight: Math.max(0, anchorY - shiftDelta - safeAreaInsets.top - OFFSET_FROM_ANCHOR * 2),
    };
  }, [anchorY, baseBottom, safeAreaInsets.top]);

  if (!visible || !relativeAnchorRect || !baseStyle) return null;
  if (options.length > 0 && selectedIndex < 0) return null;

  return (
    <Portal hostName={portalHostName}>
      <View style={styles.overlay} pointerEvents="box-none">
        <Animated.View
          testID="composer-autocomplete-popover"
          style={[baseStyle, keyboardLayoutStyle]}
        >
          <Autocomplete
            options={options}
            selectedIndex={selectedIndex}
            onSelect={onSelect}
            isLoading={isLoading}
            errorMessage={errorMessage}
            loadingText={loadingText}
            emptyText={emptyText}
            onHighlight={onHighlight}
            filePreviewPlacement={layout.filePreviewPlacement}
            maxHeight={layout.maxHeight}
          />
        </Animated.View>
      </View>
    </Portal>
  );
}

const styles = StyleSheet.create(() => ({
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
}));
