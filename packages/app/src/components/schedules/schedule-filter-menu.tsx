import { ChevronDown } from "lucide-react-native";
import { useCallback, type ReactElement } from "react";
import { Text, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Theme } from "@/styles/theme";

const ThemedChevronDown = withUnistyles(ChevronDown);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export interface ScheduleFilterOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A single-choice filter pill for the Automations and Runs rails. Same chrome
 * as the Tasks team filter and the host filter, so the rail reads as one row.
 */
export function ScheduleFilterMenu<T extends string>({
  leading,
  name,
  value,
  options,
  onChange,
  testID,
}: {
  /** Module-scope themed icon element; see docs/unistyles.md. */
  leading: ReactElement;
  /** What the pill filters, for the accessibility label: "Status". */
  name: string;
  value: T;
  options: readonly ScheduleFilterOption<T>[];
  onChange: (value: T) => void;
  testID: string;
}): ReactElement {
  const label = options.find((option) => option.value === value)?.label ?? "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={`${name}: ${label}`}
        testID={`${testID}-trigger`}
      >
        {leading}
        <Text style={styles.triggerText} numberOfLines={1}>
          {label}
        </Text>
        <ThemedChevronDown size={14} uniProps={mutedColorMapping} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" width={240}>
        {options.map((option) => (
          <ScheduleFilterMenuItem
            key={option.value}
            option={option}
            selected={option.value === value}
            onChange={onChange}
            testID={`${testID}-${option.value}`}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ScheduleFilterMenuItem<T extends string>({
  option,
  selected,
  onChange,
  testID,
}: {
  option: ScheduleFilterOption<T>;
  selected: boolean;
  onChange: (value: T) => void;
  testID: string;
}): ReactElement {
  const handleSelect = useCallback(() => onChange(option.value), [onChange, option.value]);
  return (
    <DropdownMenuItem selected={selected} showSelectedCheck onSelect={handleSelect} testID={testID}>
      {option.label}
    </DropdownMenuItem>
  );
}

function triggerStyle({
  pressed,
  hovered = false,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    styles.trigger,
    Boolean(hovered) && styles.triggerHovered,
    pressed && styles.triggerPressed,
  ];
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    alignSelf: "flex-start",
    maxWidth: 240,
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
  triggerPressed: {
    backgroundColor: theme.colors.surface3,
  },
  triggerText: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
}));
