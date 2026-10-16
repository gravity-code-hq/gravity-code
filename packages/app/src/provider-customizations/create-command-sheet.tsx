import { useCallback, useMemo, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { DaemonClient } from "@gravity/client/internal/daemon-client";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useCreateCommandForm } from "./use-create-command-form";

const PromptInput = withUnistyles(FormTextInput);
const SNAP_POINTS = ["90%"];

export function CreateCommandSheet({
  client,
  provider,
  cwd,
  onClose,
  onCreated,
}: {
  client: DaemonClient;
  provider: "codex" | "claude";
  cwd?: string;
  onClose(): void;
  onCreated(): void;
}) {
  const { t } = useTranslation();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const model = useCreateCommandForm((input) =>
    client.createProviderCommand({ provider, cwd, ...input }),
  );
  const state = useSyncExternalStore(model.subscribe, model.getState);
  const saving = state.save.status === "saving";
  const header = useMemo(() => ({ title: t("providerCustomizations.addCommand") }), [t]);
  const close = useCallback(async () => {
    if (saving) return;
    if (
      !state.dirty ||
      (await confirmDialog({
        title: t("providerCustomizations.discardTitle"),
        message: t("providerCustomizations.discardMessage"),
        confirmLabel: t("providerCustomizations.discard"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      }))
    )
      onClose();
  }, [saving, state.dirty, t, onClose]);
  const save = useCallback(async () => {
    if (await model.save()) onCreated();
  }, [model, onCreated]);
  return (
    <AdaptiveModalSheet
      visible
      onClose={close}
      header={header}
      desktopMaxWidth={720}
      snapPoints={SNAP_POINTS}
    >
      <View style={styles.content} testID="create-command-sheet">
        <Field
          label={t("providerCustomizations.commandName")}
          error={state.invalidName ? t("providerCustomizations.invalidName") : undefined}
        >
          <FormTextInput
            size={size}
            initialValue={state.name}
            onChangeText={model.setName}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={100}
            editable={!saving}
            accessibilityLabel={t("providerCustomizations.commandName")}
          />
        </Field>
        <Field label={t("providerCustomizations.prompt")}>
          <PromptInput
            size={size}
            style={styles.prompt}
            initialValue={state.content}
            onChangeText={model.setContent}
            multiline
            numberOfLines={12}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!saving}
            accessibilityLabel={t("providerCustomizations.prompt")}
          />
        </Field>
        {state.save.status === "exists" ? (
          <Text style={styles.error}>{t("providerCustomizations.commandExists")}</Text>
        ) : null}
        {state.save.status === "error" ? (
          <Text style={styles.error}>{state.save.error}</Text>
        ) : null}
        <View style={styles.actions}>
          <Button size="sm" variant="ghost" disabled={saving} onPress={close}>
            {t("common.actions.cancel")}
          </Button>
          <Button
            size="sm"
            variant="default"
            disabled={!state.canSave}
            loading={saving}
            onPress={save}
          >
            {t("providerCustomizations.save")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { gap: theme.spacing[4] },
  prompt: {
    minHeight: 240,
    maxHeight: 360,
    textAlignVertical: "top",
    fontFamily: theme.fontFamily.mono,
  },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.base },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
}));
