import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { ProviderCustomizations } from "./settings-list";
import { ProviderMcpServers } from "./mcp-servers";

type Tab = "models" | "commands" | "skills" | "mcp";

export function ProviderSettingsTabs({
  serverId,
  provider,
  children,
}: {
  serverId: string;
  provider: "codex" | "claude";
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("models");
  const options = [
    { value: "models" as const, label: t("providerCustomizations.models") },
    { value: "commands" as const, label: t("providerCustomizations.commands") },
    { value: "skills" as const, label: t("providerCustomizations.skills") },
    { value: "mcp" as const, label: t("providerCustomizations.mcpServers") },
  ];
  return (
    <View style={styles.layout}>
      <View style={styles.tabs} accessibilityRole="tablist" testID="provider-settings-tabs">
        {options.map((option) => (
          <ProviderTab
            key={option.value}
            value={option.value}
            label={option.label}
            selected={tab === option.value}
            onSelect={setTab}
          />
        ))}
      </View>
      <View style={styles.content}>
        <ProviderTabContent tab={tab} serverId={serverId} provider={provider}>
          {children}
        </ProviderTabContent>
      </View>
    </View>
  );
}

function ProviderTabContent({
  tab,
  serverId,
  provider,
  children,
}: {
  tab: Tab;
  serverId: string;
  provider: "codex" | "claude";
  children: ReactNode;
}) {
  if (tab === "models") {
    return children;
  }
  if (tab === "mcp") {
    return (
      <ProviderMcpServers key={`${serverId}:${provider}`} serverId={serverId} provider={provider} />
    );
  }
  return (
    <ProviderCustomizations
      key={`${serverId}:${provider}`}
      serverId={serverId}
      provider={provider}
      kind={tab === "commands" ? "command" : "skill"}
    />
  );
}

function ProviderTab({
  value,
  label,
  selected,
  onSelect,
}: {
  value: Tab;
  label: string;
  selected: boolean;
  onSelect(value: Tab): void;
}) {
  const [hovered, setHovered] = useState(false);
  const select = useCallback(() => onSelect(value), [onSelect, value]);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={accessibilityState}
      aria-selected={selected}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      onPress={select}
      style={[styles.tab, hovered && styles.hovered, selected && styles.selected]}
      testID={`provider-tab-${value}`}
    >
      <Text
        style={[styles.label, hovered && styles.hoveredLabel, selected && styles.selectedLabel]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  layout: { gap: theme.spacing[6] },
  tabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  tab: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    marginBottom: -1,
  },
  hovered: { borderBottomColor: theme.colors.foregroundMuted },
  selected: { borderBottomColor: theme.colors.accent },
  label: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
  hoveredLabel: { color: theme.colors.foreground },
  selectedLabel: { color: theme.colors.accent },
  content: { minWidth: 0 },
}));
