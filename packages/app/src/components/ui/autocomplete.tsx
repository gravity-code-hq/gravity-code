import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ScrollView,
  Text,
  View,
  Pressable,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Folder } from "lucide-react-native";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { MaterialFileIcon } from "@/components/material-file-icon";
import { getAutocompleteScrollOffset } from "./autocomplete-utils";
import { isWeb } from "@/constants/platform";

export interface AutocompleteOption {
  id: string;
  label: string;
  detail?: string;
  description?: string;
  kind?: "command" | "file" | "directory";
  commandKind?: "command" | "skill";
}

interface AutocompleteProps {
  options: readonly AutocompleteOption[];
  selectedIndex: number;
  onSelect: (option: AutocompleteOption) => void;
  isLoading?: boolean;
  errorMessage?: string;
  loadingText?: string;
  emptyText?: string;
  maxHeight?: number;
  onHighlight: (index: number) => void;
  filePreviewPlacement?: "side" | "footer";
}

export const FILE_PATH_PREVIEW_WIDTH = 280;

interface FilePathPreviewProps {
  option: AutocompleteOption;
  compact: boolean;
  maxHeight: number;
}

function FilePathPreview({ option, compact, maxHeight }: FilePathPreviewProps) {
  const path = option.detail ? `${option.detail}/${option.label}` : option.label;
  const segments = path.split("/");
  const previewStyle = useMemo(() => [styles.pathPreview, { maxHeight }], [maxHeight]);
  if (compact) {
    return (
      <View style={styles.pathFooter} testID="autocomplete-file-path" accessibilityLabel={path}>
        <Text style={styles.pathFooterText} numberOfLines={2} ellipsizeMode="middle">
          {path}
        </Text>
      </View>
    );
  }
  return (
    <View style={previewStyle} testID="autocomplete-file-path" accessibilityLabel={path}>
      <ScrollView keyboardShouldPersistTaps="always" contentContainerStyle={styles.pathContent}>
        {segments.map((segment, index) => {
          const isFile = index === segments.length - 1 && option.kind === "file";
          const key = segments.slice(0, index + 1).join("/");
          return (
            <View key={key} style={styles.pathRow(index)}>
              {isFile ? (
                <MaterialFileIcon fileName={segment} size={ICON_SIZE.sm} />
              ) : (
                <ThemedFolder size={ICON_SIZE.sm} uniProps={mutedIconProps} />
              )}
              <Text style={styles.pathName}>{segment}</Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const BOLT_GLYPH_PATTERN = /\u26A1|\uFE0F/gu;

function removeBoltGlyphs(value?: string): string | undefined {
  if (!value) {
    return value;
  }
  const cleaned = value.replace(BOLT_GLYPH_PATTERN, "").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

interface AutocompleteRowProps {
  index: number;
  option: AutocompleteOption;
  isSelected: boolean;
  onSelect: (option: AutocompleteOption) => void;
  onRowLayout: (index: number, event: LayoutChangeEvent) => void;
  onHighlight: (index: number) => void;
}

function AutocompleteRow({
  index,
  option,
  isSelected,
  onSelect,
  onRowLayout,
  onHighlight,
}: AutocompleteRowProps) {
  const { t } = useTranslation();
  const isFileOrDir = option.kind === "directory" || option.kind === "file";
  const optionLabel = isFileOrDir ? option.label : (removeBoltGlyphs(option.label) ?? option.label);
  const optionDescription = removeBoltGlyphs(option.description);
  const accessibilityLabel =
    option.detail && isFileOrDir ? `${option.label}, ${option.detail}` : optionLabel;

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => onRowLayout(index, event),
    [index, onRowLayout],
  );
  const handlePress = useCallback(() => onSelect(option), [onSelect, option]);
  const handlePointerMove = useCallback(() => onHighlight(index), [index, onHighlight]);
  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.item,
      (pressed || isSelected) && styles.itemActive,
    ],
    [isSelected],
  );

  return (
    <Pressable
      testID={`autocomplete-option-${option.id}`}
      onLayout={handleLayout}
      onPress={handlePress}
      // Scrolling beneath a stationary pointer must not override keyboard selection.
      onPointerMove={isWeb ? handlePointerMove : undefined}
      style={pressableStyle}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      aria-selected={isSelected}
    >
      {isFileOrDir ? (
        <>
          <View style={styles.itemLeading}>
            {option.kind === "directory" ? (
              <ThemedFolder size={ICON_SIZE.sm} uniProps={mutedIconProps} />
            ) : (
              <MaterialFileIcon fileName={option.label} size={ICON_SIZE.sm} />
            )}
          </View>
          <View style={styles.itemMain}>
            <View style={styles.itemHeader}>
              <Text style={[styles.itemLabel, styles.fileLabel]} numberOfLines={1}>
                {optionLabel}
              </Text>
              {option.detail ? (
                <Text
                  style={[styles.itemDetail, styles.fileDetail]}
                  numberOfLines={1}
                  ellipsizeMode="head"
                >
                  {option.detail}
                </Text>
              ) : null}
            </View>
            {optionDescription ? (
              <Text style={styles.itemDescription} numberOfLines={1}>
                {optionDescription}
              </Text>
            ) : null}
          </View>
        </>
      ) : (
        <View style={styles.itemMain}>
          <View style={styles.itemHeader}>
            <Text style={[styles.itemLabel, styles.commandLabel]} numberOfLines={1}>
              {optionLabel}
            </Text>
            {option.commandKind ? (
              <Text style={styles.itemDetail}>{t(`agentAutocomplete.${option.commandKind}`)}</Text>
            ) : null}
          </View>
          {optionDescription ? (
            <Text style={styles.itemDescription} numberOfLines={1}>
              {optionDescription}
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

export function Autocomplete({
  options,
  selectedIndex,
  onSelect,
  isLoading = false,
  errorMessage,
  loadingText,
  emptyText,
  maxHeight = 220,
  onHighlight,
  filePreviewPlacement,
}: AutocompleteProps) {
  const { t } = useTranslation();
  const resolvedLoadingText = loadingText ?? t("common.states.loading");
  const resolvedEmptyText = emptyText ?? t("common.empty.noResults");
  const scrollRef = useRef<ScrollView>(null);
  const rowLayoutsRef = useRef<Map<number, { top: number; height: number }>>(new Map());
  const viewportHeightRef = useRef(0);
  const scrollOffsetRef = useRef(0);
  const isFileList = filePreviewPlacement !== undefined;

  const ensureActiveItemVisible = useCallback(() => {
    if (selectedIndex < 0) {
      return;
    }

    const layout = rowLayoutsRef.current.get(selectedIndex);
    if (!layout) {
      return;
    }

    const nextOffset = getAutocompleteScrollOffset({
      currentOffset: scrollOffsetRef.current,
      viewportHeight: viewportHeightRef.current,
      itemTop: layout.top,
      itemHeight: layout.height,
    });

    if (Math.abs(nextOffset - scrollOffsetRef.current) < 1) {
      return;
    }

    scrollOffsetRef.current = nextOffset;
    scrollRef.current?.scrollTo({ y: nextOffset, animated: false });
  }, [selectedIndex]);

  const resetScrollPosition = useCallback(() => {
    if (isFileList) {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      return;
    }
    scrollRef.current?.scrollToEnd({ animated: false });
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: false });
    });
  }, [isFileList]);

  useEffect(() => {
    rowLayoutsRef.current.clear();
    scrollOffsetRef.current = 0;
  }, [options]);

  useEffect(() => {
    if (options.length === 0) {
      return;
    }
    resetScrollPosition();
  }, [options, resetScrollPosition]);

  useEffect(() => {
    const raf = requestAnimationFrame(ensureActiveItemVisible);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [ensureActiveItemVisible, options.length]);

  const handleScrollViewLayout = useCallback(
    (event: LayoutChangeEvent) => {
      viewportHeightRef.current = event.nativeEvent.layout.height;
      ensureActiveItemVisible();
    },
    [ensureActiveItemVisible],
  );

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
  }, []);

  const handleRowLayout = useCallback(
    (index: number, event: LayoutChangeEvent) => {
      rowLayoutsRef.current.set(index, {
        top: event.nativeEvent.layout.y,
        height: event.nativeEvent.layout.height,
      });
      ensureActiveItemVisible();
    },
    [ensureActiveItemVisible],
  );

  const selectedOption = options[selectedIndex];
  const containerStyle = useMemo(() => [styles.container, { maxHeight }], [maxHeight]);
  const hasFilePreview = selectedOption?.kind === "file" || selectedOption?.kind === "directory";
  const previewBesideList = hasFilePreview && filePreviewPlacement === "side";

  if (isLoading) {
    return (
      <View style={containerStyle}>
        <View style={styles.emptyItem}>
          <Text style={styles.emptyText}>{resolvedLoadingText}</Text>
        </View>
      </View>
    );
  }

  if (errorMessage) {
    return (
      <View style={containerStyle}>
        <View style={styles.emptyItem}>
          <Text style={styles.emptyText}>Error: {errorMessage}</Text>
        </View>
      </View>
    );
  }

  if (options.length === 0) {
    return (
      <View style={containerStyle}>
        <View style={styles.emptyItem}>
          <Text style={styles.emptyText}>{resolvedEmptyText}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.outerWrapper, previewBesideList && styles.sideBySide]}>
      {selectedOption?.kind === "command" && selectedOption.description ? (
        <View style={styles.detailCard} testID="autocomplete-description">
          <Text style={styles.detailLabel}>
            {removeBoltGlyphs(selectedOption.label) ?? selectedOption.label}
          </Text>
          <Text style={styles.detailDescription}>
            {removeBoltGlyphs(selectedOption.description)}
          </Text>
          {selectedOption.detail ? (
            <Text style={styles.detailHint}>{removeBoltGlyphs(selectedOption.detail)}</Text>
          ) : null}
        </View>
      ) : null}
      <View
        style={[containerStyle, previewBesideList && styles.sideList]}
        testID="autocomplete-list"
      >
        <ScrollView
          ref={scrollRef}
          onLayout={handleScrollViewLayout}
          onContentSizeChange={resetScrollPosition}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="always"
        >
          {options.map((option, index) => (
            <AutocompleteRow
              key={option.id}
              index={index}
              option={option}
              isSelected={index === selectedIndex}
              onSelect={onSelect}
              onRowLayout={handleRowLayout}
              onHighlight={onHighlight}
            />
          ))}
        </ScrollView>
      </View>
      {hasFilePreview ? (
        <FilePathPreview
          option={selectedOption}
          compact={!previewBesideList}
          maxHeight={maxHeight}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  outerWrapper: {
    flexShrink: 1,
    minHeight: 0,
    gap: theme.spacing[1],
  },
  sideBySide: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  sideList: {
    flex: 1,
    minWidth: 0,
  },
  pathPreview: {
    width: FILE_PATH_PREVIEW_WIDTH,
    flexShrink: 1,
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    ...theme.shadow.md,
  },
  pathContent: {
    padding: theme.spacing[3],
    gap: theme.spacing[2],
  },
  pathRow: (depth: number) => ({
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: Math.min(depth, 4) * theme.spacing[3],
  }),
  pathName: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  pathFooter: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.md,
  },
  pathFooterText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  detailCard: {
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    ...theme.shadow.md,
  },
  detailLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  detailDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
  detailHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
  container: {
    flexShrink: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.lg,
    overflow: "hidden",
    ...theme.shadow.md,
  },
  scrollView: {
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollContent: {
    padding: theme.spacing[1],
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 36,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  itemLeading: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: theme.spacing[2],
  },
  itemActive: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  itemMain: {
    flex: 1,
    minWidth: 0,
  },
  commandLabel: {
    flex: 1,
    minWidth: 0,
  },
  itemHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  itemLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  fileLabel: {
    flexShrink: 1,
    minWidth: 0,
  },
  fileDetail: {
    flexShrink: 2,
    maxWidth: "45%",
  },
  itemDetail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  itemDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: 2,
  },
  emptyItem: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
}));

const ThemedFolder = withUnistyles(Folder);
const mutedIconProps = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
