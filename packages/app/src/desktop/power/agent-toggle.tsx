import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { SwitchIndicator } from "@/components/ui/switch";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { usePower } from "./use-power";

interface PowerAgentToggleProps {
  serverId: string;
  target: { agentId: string } | { draftId: string };
}

export function PowerAgentMenuItem({
  serverId,
  target,
}: {
  serverId: string | null;
  target: PowerAgentToggleProps["target"] | undefined;
}) {
  if (!serverId || !target) return null;
  return <LocalAgentPowerControl serverId={serverId} target={target} />;
}

function LocalAgentPowerControl(props: PowerAgentToggleProps) {
  const local = useIsLocalDaemon(props.serverId);
  if (!local) return null;
  return <LocalPowerAgentToggle {...props} />;
}

function LocalPowerAgentToggle({ serverId, target }: PowerAgentToggleProps) {
  const { t } = useTranslation();
  const power = usePower();
  const enabled =
    "agentId" in target
      ? power.snapshot?.agentIds.includes(target.agentId) === true
      : power.snapshot?.draftIds.includes(target.draftId) === true;
  const active = enabled || power.snapshot?.global === true;
  const label = t("agentControls.caffeineMode");
  const change = power.change;
  const toggle = useCallback(() => {
    if ("agentId" in target)
      change({ action: "agent", serverId, agentId: target.agentId, enabled: !enabled });
    else change({ action: "draft", serverId, draftId: target.draftId, enabled: !enabled });
  }, [change, enabled, serverId, target]);
  const indicator = useMemo(() => <SwitchIndicator value={active} />, [active]);
  if (!power.available) return null;
  let hint = t("settings.general.power.agentHint");
  if (power.snapshot?.global) hint = t("settings.general.power.globalActive");
  if (power.busy) hint = t("settings.general.power.pending");
  return (
    <View>
      <DropdownMenuItem
        selected={active}
        trailing={indicator}
        closeOnSelect={false}
        disabled={power.busy || power.loading || power.snapshot?.global}
        onSelect={toggle}
        tooltip={hint}
        testID="agent-closed-lid-toggle"
      >
        {label}
      </DropdownMenuItem>
      {power.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t("settings.general.power.error", { detail: String(power.error) })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm, maxWidth: 240 },
}));
