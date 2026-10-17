import type { PluginTheme } from "@gravity/plugin";
import { FlatList, Icon, Modal, TextInput } from "@gravity/plugin/client/react-native";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

type ButtonVariant = "primary" | "secondary" | "ghost";

const FLUSH_CONTENT = { padding: 0, gap: 0 };
const INLINE_FILTER_THRESHOLD = 8;

function buttonColors(variant: ButtonVariant, theme: PluginTheme) {
  switch (variant) {
    case "primary":
      return { fill: theme.colors.accent, text: theme.colors.accentForeground };
    case "secondary":
      return { fill: theme.colors.surface2, text: theme.colors.foreground };
    case "ghost":
      return { fill: "transparent", text: theme.colors.foreground };
  }
}

interface ButtonProps {
  theme: PluginTheme;
  label: string;
  onPress(): void;
  variant?: ButtonVariant;
  icon?: string;
  disabled?: boolean;
  pending?: boolean;
  accessibilityLabel?: string;
}

export function Button({
  theme,
  label,
  onPress,
  variant = "secondary",
  icon,
  disabled = false,
  pending = false,
  accessibilityLabel,
}: ButtonProps) {
  const inactive = disabled || pending;
  const colors = buttonColors(variant, theme);
  const styles = useMemo(
    () => ({
      button: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        gap: 6,
        minHeight: 32,
        paddingHorizontal: label ? 12 : 8,
        borderRadius: 8,
        backgroundColor: colors.fill,
        opacity: inactive ? 0.55 : 1,
      },
      label: { color: colors.text, fontSize: 13, fontWeight: "500" as const },
    }),
    [colors.fill, colors.text, inactive, label],
  );
  const accessibilityState = useMemo(
    () => ({ disabled: inactive, busy: pending }),
    [inactive, pending],
  );
  let leading = null;
  if (pending) leading = <ActivityIndicator size="small" color={colors.text} />;
  else if (icon) leading = <Icon name={icon} size={14} color={colors.text} />;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={accessibilityState}
      disabled={inactive}
      onPress={onPress}
      style={styles.button}
    >
      {leading}
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </Pressable>
  );
}

export interface PickerOption<Value extends string> {
  value: Value;
  label: string;
  detail?: string;
}

interface ChipProps<Value extends string> {
  theme: PluginTheme;
  option: PickerOption<Value>;
  selected: boolean;
  onSelect(value: Value): void;
}

function Chip<Value extends string>({ theme, option, selected, onSelect }: ChipProps<Value>) {
  const styles = useMemo(
    () => ({
      chip: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        backgroundColor: selected ? theme.colors.surface2 : "transparent",
      },
      label: {
        fontSize: 12,
        color: selected ? theme.colors.foreground : theme.colors.foregroundMuted,
      },
    }),
    [selected, theme],
  );
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const select = useCallback(() => onSelect(option.value), [onSelect, option.value]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={select}
      style={styles.chip}
    >
      <Text style={styles.label}>{option.label}</Text>
    </Pressable>
  );
}

const CHIP_ROW = { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 };

interface ChoiceChipsProps<Value extends string> {
  theme: PluginTheme;
  options: readonly PickerOption<Value>[];
  value: Value;
  onChange(value: NoInfer<Value>): void;
}

/** A single-choice row of pill buttons for a few options. */
export function ChoiceChips<Value extends string>({
  theme,
  options,
  value,
  onChange,
}: ChoiceChipsProps<Value>) {
  return (
    <View style={CHIP_ROW}>
      {options.map((option) => (
        <Chip
          key={option.value}
          theme={theme}
          option={option}
          selected={option.value === value}
          onSelect={onChange}
        />
      ))}
    </View>
  );
}

interface OptionRowProps<Value extends string> {
  theme: PluginTheme;
  option: PickerOption<Value>;
  selected: boolean;
  onSelect(value: Value): void;
  inset: number;
}

function OptionRow<Value extends string>({
  theme,
  option,
  selected,
  onSelect,
  inset,
}: OptionRowProps<Value>) {
  const styles = useMemo(
    () => ({
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 12,
        paddingHorizontal: inset,
        paddingVertical: inset > 12 ? 12 : 9,
        borderBottomWidth: inset > 12 ? 1 : 0,
        borderBottomColor: theme.colors.border,
      },
      text: { flex: 1, gap: 2 },
      label: { color: theme.colors.foreground, fontSize: 14 },
      detail: { color: theme.colors.foregroundMuted, fontSize: 12 },
    }),
    [inset, theme],
  );
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const select = useCallback(() => onSelect(option.value), [onSelect, option.value]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={select}
      style={styles.row}
    >
      <View style={styles.text}>
        <Text numberOfLines={1} style={styles.label}>
          {option.label}
        </Text>
        {option.detail ? (
          <Text numberOfLines={1} style={styles.detail}>
            {option.detail}
          </Text>
        ) : null}
      </View>
      {selected ? <Icon name="Check" size={16} color={theme.colors.accent} /> : null}
    </Pressable>
  );
}

interface OptionPickerProps<Value extends string> {
  theme: PluginTheme;
  title: string;
  icon: string;
  value: Value | null;
  placeholder: string;
  options: readonly PickerOption<Value>[];
  onChange(value: Value): void;
  disabled?: boolean;
}

/** A compact trigger that opens a list of options in a host modal or sheet. */
export function OptionPicker<Value extends string>({
  theme,
  title,
  icon,
  value,
  placeholder,
  options,
  onChange,
  disabled = false,
}: OptionPickerProps<Value>) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? null;
  const styles = useMemo(
    () => ({
      trigger: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        minHeight: 30,
        paddingHorizontal: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: disabled ? 0.55 : 1,
        maxWidth: 260,
      },
      triggerLabel: { color: theme.colors.foreground, fontSize: 13, flexShrink: 1 },
      list: { flex: 1, minHeight: 0 },
      body: { backgroundColor: theme.colors.surface1 },
    }),
    [disabled, theme],
  );
  const headerIcon = useMemo(
    () => <Icon name={icon} size={18} color={theme.colors.foreground} />,
    [icon, theme],
  );
  const show = useCallback(() => setOpen(true), []);
  const choose = useCallback(
    (next: Value) => {
      setOpen(false);
      onChange(next);
    },
    [onChange],
  );
  const keyOf = useCallback((option: PickerOption<Value>) => option.value, []);
  const renderOption = useCallback(
    ({ item }: { item: PickerOption<Value> }) => (
      <OptionRow
        theme={theme}
        option={item}
        selected={item.value === value}
        onSelect={choose}
        inset={20}
      />
    ),
    [choose, theme, value],
  );
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${selected?.label ?? placeholder}`}
        disabled={disabled}
        onPress={show}
        style={styles.trigger}
      >
        <Icon name={icon} size={14} color={theme.colors.foregroundMuted} />
        <Text numberOfLines={1} style={styles.triggerLabel}>
          {selected?.label ?? placeholder}
        </Text>
        <Icon name="ChevronDown" size={14} color={theme.colors.foregroundMuted} />
      </Pressable>
      <Modal title={title} icon={headerIcon} open={open} onOpenChange={setOpen}>
        <Modal.Content scrollable={false} style={styles.body} contentContainerStyle={FLUSH_CONTENT}>
          <FlatList
            style={styles.list}
            data={options as PickerOption<Value>[]}
            keyExtractor={keyOf}
            renderItem={renderOption}
          />
        </Modal.Content>
      </Modal>
    </>
  );
}

interface InlineSelectProps<Value extends string> {
  theme: PluginTheme;
  label: string;
  value: Value | null;
  placeholder: string;
  options: readonly PickerOption<Value>[];
  onChange(value: Value): void;
  disabled?: boolean;
}

/**
 * A select that expands its options in place. Use it inside a host Modal, where
 * opening a second modal from a sheet is not supported.
 */
export function InlineSelect<Value extends string>({
  theme,
  label,
  value,
  placeholder,
  options,
  onChange,
  disabled = false,
}: InlineSelectProps<Value>) {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState("");
  const selected = options.find((option) => option.value === value) ?? null;
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(needle),
    );
  }, [filter, options]);
  const styles = useMemo(
    () => ({
      field: { gap: 6 },
      label: { color: theme.colors.foreground, fontSize: 13, fontWeight: "500" as const },
      trigger: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        minHeight: 38,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: expanded ? theme.colors.accent : theme.colors.border,
        backgroundColor: theme.colors.surface2,
        opacity: disabled ? 0.55 : 1,
      },
      triggerText: { flex: 1, gap: 1 },
      value: { color: theme.colors.foreground, fontSize: 14 },
      placeholder: { color: theme.colors.foregroundMuted, fontSize: 14 },
      detail: { color: theme.colors.foregroundMuted, fontSize: 12 },
      list: {
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        overflow: "hidden" as const,
      },
      filter: {
        color: theme.colors.foreground,
        paddingHorizontal: 12,
        paddingVertical: 8,
        fontSize: 13,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      empty: { color: theme.colors.foregroundMuted, fontSize: 13, padding: 12 },
    }),
    [disabled, expanded, theme],
  );
  const accessibilityState = useMemo(() => ({ expanded, disabled }), [disabled, expanded]);
  const toggle = useCallback(() => setExpanded((current) => !current), []);
  const choose = useCallback(
    (next: Value) => {
      setExpanded(false);
      setFilter("");
      onChange(next);
    },
    [onChange],
  );
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? placeholder}`}
        accessibilityState={accessibilityState}
        disabled={disabled}
        onPress={toggle}
        style={styles.trigger}
      >
        <View style={styles.triggerText}>
          <Text numberOfLines={1} style={selected ? styles.value : styles.placeholder}>
            {selected?.label ?? placeholder}
          </Text>
          {selected?.detail ? (
            <Text numberOfLines={1} style={styles.detail}>
              {selected.detail}
            </Text>
          ) : null}
        </View>
        <Icon
          name={expanded ? "ChevronUp" : "ChevronDown"}
          size={16}
          color={theme.colors.foregroundMuted}
        />
      </Pressable>
      {expanded ? (
        <View style={styles.list}>
          {options.length > INLINE_FILTER_THRESHOLD ? (
            <TextInput
              value={filter}
              onChangeText={setFilter}
              placeholder="Filter"
              placeholderTextColor={theme.colors.foregroundMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.filter}
            />
          ) : null}
          {visible.length === 0 ? <Text style={styles.empty}>No matches</Text> : null}
          {visible.map((option) => (
            <OptionRow
              key={option.value}
              theme={theme}
              option={option}
              selected={option.value === value}
              onSelect={choose}
              inset={12}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
