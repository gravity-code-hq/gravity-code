import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { SettingsCard, SettingsSection, SettingsSwitch } from "@/components/settings";
import { usePower } from "./use-power";

export function PowerSettings() {
  const { t } = useTranslation();
  const power = usePower();
  const change = power.change;
  const onValueChange = useCallback(
    (enabled: boolean) => change({ action: "global", enabled }),
    [change],
  );
  if (!power.available) return null;
  let hint = t("settings.general.power.description");
  if (power.busy) hint = t("settings.general.power.pending");
  else if (power.snapshot?.active && !power.snapshot.global)
    hint = t("settings.general.power.agentsActive");
  return (
    <SettingsSection title={t("settings.general.power.title")}>
      <SettingsCard>
        <SettingsSwitch
          label={t("settings.general.power.label")}
          hint={hint}
          error={
            power.error
              ? t("settings.general.power.error", { detail: String(power.error) })
              : undefined
          }
          value={power.snapshot?.global ?? false}
          disabled={power.busy || power.loading}
          onValueChange={onValueChange}
          testID="closed-lid-setting"
        />
      </SettingsCard>
    </SettingsSection>
  );
}
