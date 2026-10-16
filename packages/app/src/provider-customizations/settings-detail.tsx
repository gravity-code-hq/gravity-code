import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useFetchQuery } from "@/data/query";
import { router } from "expo-router";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { FileReadResult } from "@gravity/client/internal/daemon-client";
import type { ProviderCustomization } from "@gravity/protocol/provider-customizations";
import { AdaptiveModalSheet, AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ScrollableCodeSurface } from "@/components/ui/scrollable-code-surface";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useDraftStore } from "@/stores/draft-store";
import { generateDraftId } from "@/stores/draft-keys";
import { buildNewWorkspaceRoute } from "@/utils/host-routes";
import { confirmDialog } from "@/utils/confirm-dialog";
import { openCustomizationEditor } from "./editor-model";
import { buildCustomizationPrompt } from "./prompt";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

interface DetailProps {
  entry: ProviderCustomization;
  serverId: string;
  provider: "codex" | "claude";
  cwd?: string;
  projectId?: string;
  projectName?: string;
  onClose(): void;
  onSaved(): void;
}

const EditorInput = withUnistyles(AdaptiveTextInput);

const SNAP_POINTS = ["85%"];

function improveWithAgent(props: DetailProps) {
  const draftKey = `provider-customization:${generateDraftId()}`;
  useDraftStore.getState().saveDraftInput({
    draftKey,
    draft: { text: buildCustomizationPrompt(props.entry), attachments: [] },
  });
  props.onClose();
  router.push(
    buildNewWorkspaceRoute({
      serverId: props.serverId,
      provider: props.provider,
      draftKey,
      sourceDirectory: props.cwd,
      projectId: props.projectId,
      displayName: props.projectName,
    }),
  );
}

export function CustomizationDetail(props: DetailProps) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(props.serverId);
  const file = props.entry.file;
  const header = useMemo(() => ({ title: props.entry.name }), [props.entry.name]);
  const query = useFetchQuery({
    dataShape: "value",
    queryKey: ["provider-customization-file", props.serverId, props.entry.id],
    queryFn: () => {
      if (!client || !file) throw new Error(t("common.errors.daemonClientUnavailable"));
      return client.readFile(file.cwd, file.path, undefined, 1024 * 1024);
    },
    enabled: Boolean(client && file),
    staleTimeMs: 0,
    gcTime: 0,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const reload = useCallback(() => {
    void query.refetch();
  }, [query]);
  const improve = useCallback(() => improveWithAgent(props), [props]);
  if (query.data && client && file)
    return (
      <LoadedDetail
        key={`${query.data.modifiedAt}:${query.data.revision ?? ""}`}
        {...props}
        file={query.data}
        location={file}
        client={client}
        reload={reload}
      />
    );
  return (
    <AdaptiveModalSheet
      visible
      onClose={props.onClose}
      header={header}
      snapPoints={SNAP_POINTS}
      testID="provider-customization-detail"
    >
      <View style={styles.content}>
        {file && query.isPending ? <ThemedLoadingSpinner /> : null}
        {query.error ? (
          <>
            <Text style={styles.error}>{query.error.message}</Text>
            <Button size="sm" onPress={reload}>
              {t("common.actions.retry")}
            </Button>
          </>
        ) : null}
        {!file ? (
          <>
            <Text style={styles.muted}>{props.entry.description}</Text>
            <Text style={styles.muted}>{t("providerCustomizations.readOnly")}</Text>
          </>
        ) : null}
        {!file && props.entry.kind === "skill" ? (
          <Button size="sm" onPress={improve}>
            {t("providerCustomizations.improve")}
          </Button>
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}

function LoadedDetail(
  props: DetailProps & {
    file: FileReadResult;
    location: NonNullable<ProviderCustomization["file"]>;
    client: NonNullable<ReturnType<typeof useHostRuntimeClient>>;
    reload(): void;
  },
) {
  const { t } = useTranslation();
  const [model] = useState(() =>
    openCustomizationEditor(
      {
        content: new TextDecoder().decode(props.file.bytes),
        modifiedAt: props.file.modifiedAt,
        revision: props.file.revision,
      },
      (input) => props.client.writeFile({ ...props.location, ...input }),
    ),
  );
  const state = useSyncExternalStore(model.subscribe, model.getState);
  useEffect(() => () => model.close(), [model]);
  const saving = state.save.status === "saving";
  const header = useMemo(() => ({ title: props.entry.name }), [props.entry.name]);
  const discardIfNeeded = useCallback(async () => {
    if (saving) return false;
    return (
      !state.dirty ||
      confirmDialog({
        title: t("providerCustomizations.discardTitle"),
        message: t("providerCustomizations.discardMessage"),
        confirmLabel: t("providerCustomizations.discard"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      })
    );
  }, [saving, state.dirty, t]);
  const close = useCallback(async () => {
    if (await discardIfNeeded()) props.onClose();
  }, [discardIfNeeded, props]);
  const improve = useCallback(async () => {
    if (await discardIfNeeded()) improveWithAgent(props);
  }, [discardIfNeeded, props]);
  const reload = useCallback(async () => {
    if (await discardIfNeeded()) props.reload();
  }, [discardIfNeeded, props]);
  const save = useCallback(async () => {
    await model.save();
    if (model.getState().save.status === "saved") props.onSaved();
  }, [model, props]);
  return (
    <AdaptiveModalSheet
      visible
      onClose={close}
      header={header}
      desktopMaxWidth={720}
      snapPoints={SNAP_POINTS}
      testID="provider-customization-detail"
    >
      <View style={styles.content}>
        <Text selectable style={styles.path}>
          {props.entry.id}
        </Text>
        {props.entry.editable ? (
          <EditorInput
            style={styles.editor}
            initialValue={state.content}
            onChangeText={model.setContent}
            multiline
            numberOfLines={14}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!saving}
            accessibilityLabel={t("providerCustomizations.instructions")}
            testID="provider-customization-editor"
          />
        ) : (
          <>
            <Text style={styles.muted}>{t("providerCustomizations.readOnly")}</Text>
            <ScrollableCodeSurface maxHeight={360}>{state.content}</ScrollableCodeSurface>
          </>
        )}
        {state.save.status === "error" ? (
          <Text style={styles.error}>{state.save.error}</Text>
        ) : null}
        {state.save.status === "conflict" ? (
          <View style={styles.content}>
            <Text style={styles.error}>{t("providerCustomizations.conflict")}</Text>
            <Button variant="outline" size="sm" onPress={reload}>
              {t("common.actions.reload")}
            </Button>
          </View>
        ) : null}
        {state.save.status === "saved" ? (
          <Text style={styles.muted}>{t("providerCustomizations.saved")}</Text>
        ) : null}
        <View style={styles.actions}>
          {props.entry.kind === "skill" ? (
            <Button size="sm" variant="secondary" onPress={improve} disabled={saving}>
              {t("providerCustomizations.improve")}
            </Button>
          ) : null}
          <View style={styles.spacer} />
          <Button size="sm" variant="ghost" onPress={close} disabled={saving}>
            {t("common.actions.close")}
          </Button>
          {props.entry.editable ? (
            <Button
              size="sm"
              variant="default"
              loading={saving}
              disabled={!state.dirty || saving}
              onPress={save}
            >
              {t("providerCustomizations.save")}
            </Button>
          ) : null}
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  editor: {
    minHeight: 280,
    maxHeight: 420,
    padding: theme.spacing[4],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    textAlignVertical: "top",
  },
  content: { gap: theme.spacing[4] },
  path: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.base },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2], alignItems: "center" },
  spacer: { flex: 1 },
}));
