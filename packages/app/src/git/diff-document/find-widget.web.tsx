import { useCallback, useEffect, useRef, useState } from "react";
import {
  Text,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import { ArrowDown, ArrowUp, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { paneContentToolbarIconSize, ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { SearchOptionToggles } from "@/components/ui/search-option-toggles";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";
import type { Theme } from "@/styles/theme";
import { FILE_HEADER_HEIGHT } from "./model";
import type { DiffFind } from "./use-diff-find";

const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedArrowDown = withUnistyles(ArrowDown);
const ThemedX = withUnistyles(X);
const ThemedTextInput = withUnistyles(TextInput, (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
  selectionColor: theme.colors.foreground,
}));

const ICON_SIZE = paneContentToolbarIconSize(false);

/**
 * VS Code's editor find widget for the canvas diff: field with inline toggles, "N of M",
 * previous/next, close. Enter and Shift+Enter (or F3 and Shift+F3) step; Escape closes.
 */
export function DiffFindWidget({
  find,
  onNext,
  onPrevious,
  onClose,
}: {
  find: DiffFind;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<EditingTextInputHandle>(null);
  const [isFocused, setIsFocused] = useState(false);
  const handleFocus = useCallback(() => setIsFocused(true), []);
  const handleBlur = useCallback(() => setIsFocused(false), []);
  const { focusRequest } = find;
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.replaceText(focusRequest.text, { start: 0, end: focusRequest.text.length });
    input.focus();
  }, [focusRequest]);
  const handleKey = useCallback(
    (event: { preventDefault(): void; stopPropagation(): void }, key: KeyboardEvent): boolean => {
      if (key.isComposing) return false;
      if ((key.metaKey || key.ctrlKey) && key.key.toLowerCase() === "f") {
        const text = inputRef.current?.getText() ?? "";
        inputRef.current?.replaceText(text, { start: 0, end: text.length });
        inputRef.current?.focus();
      } else if (key.key === "Enter" || key.key === "F3") {
        if (key.shiftKey) onPrevious();
        else onNext();
      } else if (key.key === "Escape") {
        onClose();
      } else {
        return false;
      }
      event.preventDefault();
      event.stopPropagation();
      return true;
    },
    [onClose, onNext, onPrevious],
  );
  // react-native-web's TextInput stops its keydown from bubbling, so the field reports its
  // keys here; the wrapper's onKeyDown covers the buttons and toggles.
  const inputKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      handleKey(event, event.nativeEvent as unknown as KeyboardEvent);
    },
    [handleKey],
  );
  const keyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter") return;
      handleKey(event, event.nativeEvent);
    },
    [handleKey],
  );
  const hasMatches = find.result.matches.length > 0;
  return (
    <div
      style={WIDGET_POSITION_STYLE}
      onKeyDown={keyDown}
      onContextMenu={stopPropagation}
      onPointerDown={stopPropagation}
      data-testid="diff-find-widget"
    >
      <View style={styles.widget}>
        <View
          style={[
            styles.field,
            isFocused && styles.fieldFocused,
            find.result.invalid && styles.fieldInvalid,
          ]}
        >
          <ThemedTextInput
            ref={inputRef}
            initialValue={find.query}
            onChangeText={find.setQuery}
            onFocus={handleFocus}
            onBlur={handleBlur}
            placeholder={t("panels.file.editor.find.placeholder")}
            accessibilityLabel={t("panels.file.editor.find.placeholder")}
            autoCapitalize="none"
            autoCorrect={false}
            blurOnSubmit={false}
            onKeyPress={inputKeyPress}
            style={styles.input}
            testID="diff-find-input"
          />
          <SearchOptionToggles
            options={find.options}
            onToggle={find.toggleOption}
            testIDPrefix="diff-find"
          />
        </View>
        <Text
          style={[styles.count, find.result.invalid && styles.countInvalid]}
          numberOfLines={1}
          aria-live="polite"
          testID="diff-find-count"
        >
          {findStatusLabel(find, t)}
        </Text>
        <ToolbarButton
          label={t("panels.file.editor.find.previous")}
          onPress={onPrevious}
          disabled={!hasMatches}
          testID="diff-find-previous"
        >
          <ThemedArrowUp size={ICON_SIZE} strokeWidth={1.5} uniProps={mutedIconColorMapping} />
        </ToolbarButton>
        <ToolbarButton
          label={t("panels.file.editor.find.next")}
          onPress={onNext}
          disabled={!hasMatches}
          testID="diff-find-next"
        >
          <ThemedArrowDown size={ICON_SIZE} strokeWidth={1.5} uniProps={mutedIconColorMapping} />
        </ToolbarButton>
        <ToolbarButton
          label={t("panels.file.editor.find.close")}
          onPress={onClose}
          testID="diff-find-close"
        >
          <ThemedX size={ICON_SIZE} strokeWidth={1.5} uniProps={mutedIconColorMapping} />
        </ToolbarButton>
      </View>
    </div>
  );
}

function findStatusLabel(find: DiffFind, t: TFunction): string {
  if (!find.query) return "";
  if (find.result.invalid) return t("panels.file.editor.find.invalidRegex");
  if (find.result.matches.length === 0) return t("panels.file.editor.find.noResults");
  return t("panels.file.editor.find.count", {
    current: find.activeIndex === null ? "–" : find.activeIndex + 1,
    total: `${find.result.matches.length}${find.result.limitHit ? "+" : ""}`,
  });
}

function stopPropagation(event: React.SyntheticEvent): void {
  event.stopPropagation();
}

// Below the sticky file header, so the header's stats and actions stay reachable.
const WIDGET_POSITION_STYLE: React.CSSProperties = {
  position: "absolute",
  top: FILE_HEADER_HEIGHT + 4,
  right: 16,
  zIndex: 6,
  maxWidth: "calc(100% - 32px)",
};

const styles = StyleSheet.create((theme) => ({
  widget: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    width: 420,
    maxWidth: "100%",
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    ...theme.shadow.md,
  },
  field: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minWidth: 0,
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[0.5],
    borderRadius: theme.borderRadius.base,
    backgroundColor: theme.colors.surface0,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  fieldFocused: {
    borderColor: theme.colors.borderAccent,
  },
  fieldInvalid: {
    borderColor: theme.colors.destructive,
  },
  input: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    height: 24,
    outlineWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  count: {
    minWidth: 64,
    paddingHorizontal: theme.spacing[1],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  countInvalid: {
    color: theme.colors.destructive,
  },
}));
