import { useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useShallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PlanModeIcon } from "@/agent-controls/icons";
import { PLAN_MODE_FEATURE_ID } from "@/agent-controls/policy";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import { resolveNextAgentModeId, resolvePlanModeToggle } from "@/composer/agent-controls/mode";
import { useComposerKeyboardScope } from "@/composer/keyboard-scope";
import { useComposerControlLayout } from "@/composer/agent-controls/layout-context";
import { AgentControlTrigger } from "@/composer/agent-controls/control";
import { useSessionStore } from "@/stores/session-store";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { mergeProviderPreferences, useFormPreferences } from "@/hooks/use-form-preferences";
import { resolveProviderDefinition } from "@/utils/provider-definitions";
import { useToast } from "@/contexts/toast-context";
import { toErrorMessage } from "@/utils/error-messages";
import { showProviderNoticeToast } from "@/utils/provider-notice-toast";
import type { AgentFeature, AgentMode } from "@gravity/protocol/agent-types";
import type { AgentProviderDefinition } from "@gravity/protocol/provider-manifest";

export interface AgentModeControlValue {
  provider: string;
  providerDefinitions: AgentProviderDefinition[];
  modeOptions: AgentMode[];
  selectedModeId: string | null | undefined;
  onSelectMode: (modeId: string) => void;
  disabled?: boolean;
}

function resolveModePlanToggle(
  control: AgentModeControlValue | null | undefined,
  previousMode: string | null = null,
) {
  if (!control) return null;
  const definition = control.providerDefinitions.find((entry) => entry.id === control.provider);
  return resolvePlanModeToggle({
    modeOptions: control.modeOptions,
    selectedMode: control.selectedModeId,
    previousMode,
    defaultMode: definition?.defaultModeId ?? null,
  });
}

export function AgentModeControl({
  modeControl,
  features,
  onSetFeature,
  disabled = false,
  onActionComplete,
}: {
  modeControl?: AgentModeControlValue | null;
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  disabled?: boolean;
  onActionComplete?: () => void;
}) {
  const { t } = useTranslation();
  const { presentation } = useComposerControlLayout();
  const { isActiveComposer } = useComposerKeyboardScope();
  const keyboardHandlerIdRef = useRef(`mode-control:${Math.random().toString(36).slice(2)}`);
  const previousModeRef = useRef<{ provider: string; modeId: string | null } | null>(null);
  const planFeature = features?.find(
    (feature) => feature.id === PLAN_MODE_FEATURE_ID && feature.type === "toggle",
  );
  const modeToggle = resolveModePlanToggle(modeControl);
  const hasPlanFeature = planFeature?.type === "toggle";
  const active = hasPlanFeature ? planFeature.value : modeToggle?.active === true;
  const isDisabled = disabled || modeControl?.disabled === true;
  const label = t("agentControls.plan");
  const accessibilityState = useMemo(() => ({ selected: active }), [active]);

  const togglePlan = useCallback(() => {
    if (planFeature?.type === "toggle") {
      onSetFeature?.(planFeature.id, !planFeature.value);
    } else if (modeControl && modeToggle) {
      if (!modeToggle.active) {
        previousModeRef.current = {
          provider: modeControl.provider,
          modeId: modeControl.selectedModeId ?? modeControl.modeOptions[0]?.id ?? null,
        };
      }
      const previousMode =
        previousModeRef.current?.provider === modeControl.provider
          ? previousModeRef.current.modeId
          : null;
      const nextToggle = resolveModePlanToggle(modeControl, previousMode);
      if (nextToggle) modeControl.onSelectMode(nextToggle.nextModeId);
    }
    onActionComplete?.();
  }, [modeControl, modeToggle, onActionComplete, onSetFeature, planFeature]);

  const handleKeyboardAction = useCallback(
    (action: KeyboardActionDefinition): boolean => {
      if (
        action.id !== "message-input.mode-cycle" ||
        isDisabled ||
        !isActiveComposer ||
        !modeControl
      )
        return false;
      const nextModeId = resolveNextAgentModeId({
        modeOptions: modeControl.modeOptions,
        selectedMode: modeControl.selectedModeId,
      });
      if (!nextModeId) return false;
      modeControl.onSelectMode(nextModeId);
      return true;
    },
    [isActiveComposer, isDisabled, modeControl],
  );
  const canCycle = Boolean(modeControl && modeControl.modeOptions.length > 1);
  useKeyboardActionHandler({
    handlerId: keyboardHandlerIdRef.current,
    actions: ["message-input.mode-cycle"],
    enabled: isActiveComposer && !isDisabled && canCycle,
    priority: 200,
    handle: handleKeyboardAction,
  });

  if (!hasPlanFeature && !modeToggle) return null;
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild triggerRefProp="ref">
        <AgentControlTrigger
          icon={PlanModeIcon}
          iconColor={active ? styles.active.color : undefined}
          surface="toolbar"
          label={label}
          showToolbarLabel={presentation.showPlanLabel}
          open={active}
          disabled={isDisabled}
          onPress={togglePlan}
          accessibilityLabel={t("shell.commandCenter.planModeGroupLabel")}
          accessibilityState={accessibilityState}
          aria-pressed={active}
          testID="agent-feature-plan_mode"
        />
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{t("shell.commandCenter.planModeGroupLabel")}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const EMPTY_MODES: AgentMode[] = [];

function compareAvailableModes(a: AgentMode[], b: AgentMode[]): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export function useLiveAgentModeControl(
  serverId: string,
  agentId: string,
): AgentModeControlValue | null {
  const slice = useSessionStore(
    useShallow((state) => {
      const agent = state.sessions[serverId]?.agents?.get(agentId);
      if (!agent) return null;
      return {
        provider: agent.provider,
        cwd: agent.cwd,
        currentModeId: agent.currentModeId,
      };
    }),
  );
  const availableModes = useStoreWithEqualityFn(
    useSessionStore,
    (state) => state.sessions[serverId]?.agents?.get(agentId)?.availableModes ?? EMPTY_MODES,
    compareAvailableModes,
  );
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const { updatePreferences } = useFormPreferences();
  const toast = useToast();
  const { entries: snapshotEntries } = useProvidersSnapshot(serverId, { cwd: slice?.cwd });

  const providerDefinitions = useMemo<AgentProviderDefinition[]>(() => {
    if (!slice?.provider) return [];
    const definition = resolveProviderDefinition(slice.provider, snapshotEntries);
    return definition ? [definition] : [];
  }, [slice?.provider, snapshotEntries]);

  const handleSelectMode = useCallback(
    (modeId: string) => {
      if (!client || !slice?.provider) return;
      void updatePreferences((current) =>
        mergeProviderPreferences({
          preferences: current,
          provider: slice.provider,
          updates: { mode: modeId || undefined },
        }),
      ).catch((error) => {
        console.warn("[AgentModeControl] persist mode preference failed", error);
      });
      void client
        .setAgentMode(agentId, modeId)
        .then((notice) => showProviderNoticeToast(toast, notice))
        .catch((error) => {
          console.warn("[AgentModeControl] setAgentMode failed", error);
          toast.error(toErrorMessage(error));
        });
    },
    [agentId, client, slice?.provider, toast, updatePreferences],
  );

  return useMemo(() => {
    if (!slice || availableModes.length === 0) return null;
    return {
      provider: slice.provider,
      providerDefinitions,
      modeOptions: availableModes,
      selectedModeId: slice.currentModeId,
      onSelectMode: handleSelectMode,
      disabled: !client,
    };
  }, [availableModes, client, handleSelectMode, providerDefinitions, slice]);
}

const styles = StyleSheet.create((theme) => ({
  active: { color: theme.colors.accent },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
}));
