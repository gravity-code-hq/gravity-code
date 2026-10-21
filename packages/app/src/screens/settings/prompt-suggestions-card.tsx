import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type {
  MutableDaemonConfigPatch,
  PromptSuggestionModelSource,
} from "@gravity/protocol/messages";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";

export function PromptSuggestionsCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supported = useHostFeature(serverId, "promptSuggestions");
  const { config, patchConfig } = useDaemonConfig(serverId);
  const mutation = useMutation({
    mutationFn: async (patch: MutableDaemonConfigPatch["promptSuggestions"]) => {
      const result = await patchConfig({ promptSuggestions: patch });
      if (!result) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      return result;
    },
  });
  const { mutate } = mutation;

  const handleEnabledChange = useCallback((enabled: boolean) => mutate({ enabled }), [mutate]);
  const handleModelChange = useCallback(
    (model: PromptSuggestionModelSource) => mutate({ model }),
    [mutate],
  );
  const modelOptions = useMemo(
    () => [
      { value: "agent" as const, label: t("settings.host.promptSuggestions.modelAgent") },
      { value: "metadata" as const, label: t("settings.host.promptSuggestions.modelMetadata") },
    ],
    [t],
  );

  if (!isConnected || !supported || !config) return null;

  const enabled = config.promptSuggestions.enabled;
  const model = config.promptSuggestions.model;

  return (
    <View style={settingsStyles.card} testID="host-page-prompt-suggestions-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.host.promptSuggestions.title")}</Text>
          <Text style={settingsStyles.rowHint}>{t("settings.host.promptSuggestions.hint")}</Text>
          {mutation.error ? (
            <Text style={settingsStyles.rowError} testID="host-page-prompt-suggestions-error">
              {t("settings.host.promptSuggestions.saveFailed", {
                message: mutation.error.message,
              })}
            </Text>
          ) : null}
        </View>
        <Switch
          value={enabled}
          onValueChange={handleEnabledChange}
          disabled={mutation.isPending}
          accessibilityLabel={t("settings.host.promptSuggestions.title")}
        />
      </View>
      {enabled ? (
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.host.promptSuggestions.model")}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {model === "agent"
                ? t("settings.host.promptSuggestions.modelAgentHint")
                : t("settings.host.promptSuggestions.modelMetadataHint")}
            </Text>
          </View>
          <SegmentedControl
            options={modelOptions}
            value={model}
            onValueChange={handleModelChange}
            size="sm"
            testID="host-page-prompt-suggestions-model"
          />
        </View>
      ) : null}
    </View>
  );
}
