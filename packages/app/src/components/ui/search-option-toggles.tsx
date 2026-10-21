import { useCallback, useMemo } from "react";
import { Pressable, View, type PressableStateCallbackType } from "react-native";
import { CaseSensitive, Regex, WholeWord } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { Theme } from "@/styles/theme";

const ThemedCaseSensitive = withUnistyles(CaseSensitive);
const ThemedWholeWord = withUnistyles(WholeWord);
const ThemedRegex = withUnistyles(Regex);

const mutedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundIconColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

const TOGGLE_ICON_SIZE = 14;

export type SearchOption = "caseSensitive" | "wholeWord" | "regex";

export type SearchOptionValues = Record<SearchOption, boolean>;

/** The match-case, whole-word, and regex toggles VS Code's FindInput draws inside the field. */
export function SearchOptionToggles({
  options,
  onToggle,
  testIDPrefix,
}: {
  options: SearchOptionValues;
  onToggle: (option: SearchOption) => void;
  testIDPrefix: string;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.toggles}>
      <SearchOptionToggle
        option="caseSensitive"
        label={t("panels.search.options.caseSensitive")}
        selected={options.caseSensitive}
        onToggle={onToggle}
        Icon={ThemedCaseSensitive}
        testID={`${testIDPrefix}-toggle-case`}
      />
      <SearchOptionToggle
        option="wholeWord"
        label={t("panels.search.options.wholeWord")}
        selected={options.wholeWord}
        onToggle={onToggle}
        Icon={ThemedWholeWord}
        testID={`${testIDPrefix}-toggle-word`}
      />
      <SearchOptionToggle
        option="regex"
        label={t("panels.search.options.regex")}
        selected={options.regex}
        onToggle={onToggle}
        Icon={ThemedRegex}
        testID={`${testIDPrefix}-toggle-regex`}
      />
    </View>
  );
}

function SearchOptionToggle({
  option,
  label,
  selected,
  onToggle,
  Icon,
  testID,
}: {
  option: SearchOption;
  label: string;
  selected: boolean;
  onToggle: (option: SearchOption) => void;
  Icon: typeof ThemedCaseSensitive;
  testID: string;
}) {
  const handlePress = useCallback(() => onToggle(option), [onToggle, option]);
  const accessibilityState = useMemo(() => ({ checked: selected }), [selected]);
  const toggleStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.toggle,
      (Boolean(hovered) || pressed) && styles.toggleHovered,
      selected && styles.toggleSelected,
    ],
    [selected],
  );
  return (
    <Pressable
      onPress={handlePress}
      style={toggleStyle}
      accessibilityRole="checkbox"
      accessibilityState={accessibilityState}
      accessibilityLabel={label}
      hitSlop={4}
      testID={testID}
    >
      <Icon
        size={TOGGLE_ICON_SIZE}
        uniProps={selected ? foregroundIconColorMapping : mutedIconColorMapping}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  toggles: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[0.5],
    flexShrink: 0,
  },
  toggle: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.base,
  },
  toggleHovered: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  toggleSelected: {
    backgroundColor: theme.colors.surface3,
  },
}));
