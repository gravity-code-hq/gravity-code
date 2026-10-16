import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MoreHorizontal } from "lucide-react-native";
import type { AgentFeature, AgentMode, AgentSelectOption } from "@gravity/protocol/agent-types";
import { PLAN_MODE_FEATURE_ID, isPlanningAgentMode } from "@/agent-controls/policy";
import { formatAgentModeLabel } from "@/agent-controls/labels";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  type MenuPageDefinition,
} from "@/components/ui/dropdown-menu";
import { SwitchIndicator } from "@/components/ui/switch";
import type { MenuTriggerState } from "@/components/ui/menu";
import { Alert } from "@/components/ui/alert";
import { ComposerToolbarGlyph } from "@/composer/agent-controls/glyph";
import { useComposerControlLayout } from "@/composer/agent-controls/layout-context";
import type { AgentModeControlValue } from "@/composer/agent-controls/mode-control";
import { PowerAgentMenuItem } from "@/desktop/power/agent-toggle";

const SettingsIcon = withUnistyles(MoreHorizontal, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

interface AgentSettingsMenuProps {
  modeControl?: AgentModeControlValue | null;
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  isSettingFeature?: boolean;
  featureError?: string | null;
  disabled?: boolean;
  onClose?: () => void;
  serverId: string | null;
  powerTarget?: { agentId: string } | { draftId: string };
}

export function AgentSettingsMenu({
  modeControl,
  features,
  onSetFeature,
  isSettingFeature = false,
  featureError,
  disabled = false,
  onClose,
  serverId,
  powerTarget,
}: AgentSettingsMenuProps) {
  const { t } = useTranslation();
  const { glyphSize } = useComposerControlLayout();
  const settingsFeatures = useMemo(
    () =>
      (features ?? []).filter(
        (feature) => feature.id !== PLAN_MODE_FEATURE_ID || feature.type !== "toggle",
      ),
    [features],
  );
  const modes = useMemo(
    () => modeControl?.modeOptions.filter((mode) => !isPlanningAgentMode(mode)) ?? [],
    [modeControl],
  );
  const selectedMode =
    modeControl?.modeOptions.find((mode) => mode.id === modeControl.selectedModeId) ??
    modeControl?.modeOptions[0];
  const modeLabel = selectedMode ? formatAgentModeLabel(selectedMode) : undefined;
  const permissionsDisabled = disabled || modeControl?.disabled === true;
  const featuresDisabled = disabled || isSettingFeature;
  const featureFeedback = useMemo(() => {
    if (isSettingFeature) {
      return <DropdownMenuItem disabled>{t("common.loading")}</DropdownMenuItem>;
    }
    if (featureError) {
      return (
        <View style={styles.featureFeedback}>
          <Alert variant="error" description={featureError} testID="agent-feature-error" />
        </View>
      );
    }
    return null;
  }, [featureError, isSettingFeature, t]);
  const pages = useMemo(() => {
    const result: MenuPageDefinition[] = [];
    if (modeControl) {
      result.push({
        id: "permissions",
        title: t("agentControls.permissions"),
        content: modes.map((mode) => (
          <ModeSettingOption
            key={mode.id}
            mode={mode}
            selected={selectedMode?.id === mode.id}
            disabled={permissionsDisabled}
            onSelect={modeControl.onSelectMode}
          />
        )),
      });
    }
    for (const feature of settingsFeatures) {
      if (feature.type !== "select") continue;
      result.push({
        id: `feature-${feature.id}`,
        title: feature.label,
        content: (
          <>
            {featureFeedback}
            {feature.options.map((option) => (
              <FeatureSettingOption
                key={option.id}
                option={option}
                feature={feature}
                disabled={featuresDisabled}
                onSetFeature={onSetFeature}
              />
            ))}
          </>
        ),
      });
    }
    return result;
  }, [
    featuresDisabled,
    featureFeedback,
    modeControl,
    modes,
    onSetFeature,
    permissionsDisabled,
    selectedMode,
    settingsFeatures,
    t,
  ]);
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose?.();
    },
    [onClose],
  );
  const triggerStyle = useCallback(
    ({ hovered, pressed, open }: MenuTriggerState) => [
      styles.trigger,
      (hovered || pressed || open) && styles.highlighted,
      disabled && styles.disabled,
    ],
    [disabled],
  );

  return (
    <DropdownMenu compactMode="sheet" onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        disabled={disabled}
        style={triggerStyle}
        accessibilityLabel={t("agentControls.moreSettings")}
        testID="agent-controls-settings"
      >
        <ComposerToolbarGlyph size={glyphSize}>
          <SettingsIcon size={glyphSize} />
        </ComposerToolbarGlyph>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        width={280}
        sheetTitle={t("agentControls.moreSettings")}
        pages={pages}
        testID="agent-settings-menu"
      >
        {modes.length > 0 ? (
          <DropdownMenuSubTrigger
            id="permissions"
            value={modeLabel}
            disabled={permissionsDisabled}
            testID="agent-settings-permissions"
          >
            {t("agentControls.permissions")}
          </DropdownMenuSubTrigger>
        ) : null}
        {modes.length > 0 && settingsFeatures.length > 0 ? <DropdownMenuSeparator /> : null}
        {settingsFeatures.map((feature) => (
          <FeatureSetting
            key={feature.id}
            feature={feature}
            disabled={featuresDisabled}
            onSetFeature={onSetFeature}
          />
        ))}
        <PowerAgentMenuItem serverId={serverId} target={powerTarget} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModeSettingOption({
  mode,
  selected,
  disabled,
  onSelect,
}: {
  mode: AgentMode;
  selected: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const select = useCallback(() => onSelect(mode.id), [mode.id, onSelect]);
  return (
    <DropdownMenuItem
      selected={selected}
      disabled={disabled}
      onSelect={select}
      testID={`agent-mode-${mode.id}`}
    >
      {formatAgentModeLabel(mode)}
    </DropdownMenuItem>
  );
}

function FeatureSettingOption({
  feature,
  option,
  disabled,
  onSetFeature,
}: {
  feature: AgentFeature;
  option: AgentSelectOption;
  disabled: boolean;
  onSetFeature: AgentSettingsMenuProps["onSetFeature"];
}) {
  const select = useCallback(
    () => onSetFeature?.(feature.id, option.id),
    [feature.id, onSetFeature, option.id],
  );
  return (
    <DropdownMenuItem
      selected={feature.value === option.id}
      disabled={disabled}
      closeOnSelect={false}
      onSelect={select}
      testID={`agent-feature-${feature.id}-${option.id}`}
    >
      {option.label}
    </DropdownMenuItem>
  );
}

function FeatureSetting({
  feature,
  disabled,
  onSetFeature,
}: {
  feature: AgentFeature;
  disabled: boolean;
  onSetFeature: AgentSettingsMenuProps["onSetFeature"];
}) {
  const indicator = useMemo(
    () => (feature.type === "toggle" ? <SwitchIndicator value={feature.value} /> : null),
    [feature],
  );
  const toggle = useCallback(() => {
    if (feature.type === "toggle") onSetFeature?.(feature.id, !feature.value);
  }, [feature, onSetFeature]);
  if (feature.type === "toggle") {
    return (
      <DropdownMenuItem
        selected={feature.value}
        trailing={indicator}
        disabled={disabled}
        closeOnSelect={false}
        onSelect={toggle}
        testID={`agent-feature-${feature.id}`}
      >
        {feature.label}
      </DropdownMenuItem>
    );
  }
  const selectedOption = feature.options.find((option) => option.id === feature.value);
  return (
    <DropdownMenuSubTrigger
      id={`feature-${feature.id}`}
      value={selectedOption?.label}
      disabled={disabled}
      testID={`agent-feature-${feature.id}`}
    >
      {feature.label}
    </DropdownMenuSubTrigger>
  );
}

const styles = StyleSheet.create((theme) => ({
  featureFeedback: { maxWidth: 280 },
  trigger: {
    width: 28,
    height: 28,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
  },
  highlighted: { backgroundColor: theme.colors.interactionHighlight },
  disabled: { opacity: theme.opacity[50] },
}));
