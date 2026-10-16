import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useFetchQuery } from "@/data/query";
import type { AgentModelDefinition } from "@gravity/protocol/agent-types";
import type { LinearIssueDetail } from "@gravity/protocol/linear/types";
import type { WorkspaceDescriptorPayload } from "@gravity/protocol/messages";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField } from "@/components/ui/select-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useLinearStartProjects } from "@/components/linear/start-agent-menu";
import { useIsCompactFormFactor } from "@/constants/layout";
import { buildLinearIssuePrompt } from "@/linear/issue-prompt";
import { openLinearStartForm } from "@/linear/start-form";
import { type LinearStartTarget, useLinearQuickStart } from "@/linear/use-quick-start";
import {
  getHostProjectId,
  getHostProjectSourceDirectory,
  getWorktreeSupportForHostProject,
} from "@/projects/host-project-model";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { generateDraftId } from "@/stores/draft-keys";

interface LinearStartAgentSheetProps {
  serverId: string;
  issue: LinearIssueDetail;
  onClose: () => void;
}

function useStartWorkspaces(serverId: string, projectId: string | null, enabled: boolean) {
  const client = useHostRuntimeClient(serverId);
  return useFetchQuery({
    dataShape: "list",
    staleTimeMs: 0,
    queryKey: ["linear-start-workspaces", serverId, projectId],
    enabled: client !== null && projectId !== null && enabled,
    queryFn: async () => {
      if (!client || !projectId) throw new Error("Repository unavailable");
      const entries: WorkspaceDescriptorPayload[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.fetchWorkspaces({
          filter: { projectId },
          page: { limit: 200, cursor },
        });
        entries.push(...page.entries.filter((workspace) => !workspace.archivingAt));
        cursor = page.pageInfo.nextCursor ?? undefined;
      } while (cursor);
      return entries;
    },
  });
}

function isSameDirectory(left: string, right: string): boolean {
  return left.replace(/\/+$/, "") === right.replace(/\/+$/, "");
}

/**
 * Existing workspace with nothing picked runs in the repository checkout on its
 * current branch. The checkout's own workspace is reused when it has one, so
 * repeated starts don't pile up duplicate workspaces. Null until the pick and
 * the workspace list are known.
 */
function resolveStartTarget(input: {
  kind: "new" | "existing";
  pickedWorkspaceId: string | null;
  repoWorkspaces: WorkspaceDescriptorPayload[] | null;
  sourceDirectory: string | null;
}): LinearStartTarget | null {
  if (input.kind === "new") return { kind: "worktree" };
  if (!input.repoWorkspaces || !input.sourceDirectory) return null;
  const sourceDirectory = input.sourceDirectory;
  const picked = input.pickedWorkspaceId
    ? input.repoWorkspaces.find((entry) => entry.id === input.pickedWorkspaceId)
    : input.repoWorkspaces.find(
        (entry) =>
          entry.workspaceKind !== "worktree" &&
          entry.workspaceDirectory !== undefined &&
          isSameDirectory(entry.workspaceDirectory, sourceDirectory),
      );
  if (input.pickedWorkspaceId && !picked?.workspaceDirectory) return null;
  return picked?.workspaceDirectory
    ? {
        kind: "workspace",
        workspace: { id: picked.id, workspaceDirectory: picked.workspaceDirectory },
      }
    : { kind: "checkout" };
}

function useLinearStartSheet({ serverId, issue, onClose }: LinearStartAgentSheetProps) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const size: "md" | "sm" = compact ? "md" : "sm";
  const [model] = useState(() => openLinearStartForm(buildLinearIssuePrompt(issue)));
  const [draftId] = useState(generateDraftId);
  const state = useSyncExternalStore(model.subscribe, model.getState);
  useEffect(() => () => model.close(), [model]);
  const projects = useLinearStartProjects(serverId);
  const project = projects.find((entry) => entry.viewKey === state.project?.id) ?? null;
  const projectId = project ? getHostProjectId(project, serverId) : null;
  const workspaces = useStartWorkspaces(serverId, projectId, state.workspaceKind === "existing");
  const repoWorkspaces = (workspaces.data ?? []).filter((entry) => entry.projectId === projectId);
  const workspace = repoWorkspaces.find((entry) => entry.id === state.workspace?.id) ?? null;
  const sourceDirectory = project ? getHostProjectSourceDirectory(project, serverId) : null;
  const workingDir = workspace?.workspaceDirectory ?? sourceDirectory ?? "";
  const launch = useLinearQuickStart(serverId, workingDir);
  const target = resolveStartTarget({
    kind: state.workspaceKind,
    pickedWorkspaceId: state.workspace?.id ?? null,
    repoWorkspaces: workspaces.isSuccess ? repoWorkspaces : null,
    sourceDirectory,
  });
  const form = launch.formState;
  const modelOptions = useMemo(
    () =>
      Array.from(form.allProviderModels.values()).flatMap((models) =>
        models
          .filter((entry) => entry.isSelectable !== false)
          .map((entry) => ({
            id: `${entry.provider}:${entry.id}`,
            value: entry,
            label: `${entry.provider} · ${entry.label}`,
          })),
      ),
    [form.allProviderModels],
  );
  const selectedModel = modelOptions.find(
    (entry) =>
      entry.value.provider === form.selectedProvider && entry.value.id === form.selectedModel,
  );
  const supportsWorktree =
    project === null || getWorktreeSupportForHostProject({ project, serverId }) !== "unsupported";
  const newWorkspaceLabel = supportsWorktree
    ? t("linear.start.newWorktree")
    : t("linear.start.newWorkspace");
  const workspaceOptions = repoWorkspaces.map((entry) => ({
    id: entry.id,
    value: entry.id,
    label: entry.title || entry.name,
    testID: `linear-start-workspace-${entry.id}`,
  }));
  const canSubmit = state.canSubmit && project !== null && target !== null && launch.target.ready;
  const close = useCallback(() => {
    if (!state.pending) onClose();
  }, [onClose, state.pending]);
  const submit = useCallback(() => {
    if (!canSubmit || !project || !target) return;
    void model.submit(async (draft) => {
      await launch.start(issue, project, { prompt: draft.prompt, target, idempotencyKey: draftId });
      onClose();
    });
  }, [canSubmit, project, target, model, launch, issue, draftId, onClose]);
  return {
    state,
    model,
    projects,
    project,
    workspaces,
    workspaceOptions,
    newWorkspaceLabel,
    canSubmit,
    close,
    submit,
    form,
    modelOptions,
    selectedModel,
    size,
  };
}

export function LinearStartAgentSheet(props: LinearStartAgentSheetProps) {
  const { t } = useTranslation();
  const {
    state,
    model,
    projects,
    project,
    workspaces,
    workspaceOptions,
    newWorkspaceLabel,
    canSubmit,
    close,
    submit,
    form,
    modelOptions,
    selectedModel,
    size,
  } = useLinearStartSheet(props);
  const workspacePickerDisabled = project === null || state.pending;
  const header = useMemo(
    () => ({
      title: t("linear.issue.startAgent"),
      subtitle: (
        <Text style={styles.headerSubtitle} testID="linear-start-issue-identifier">
          {props.issue.identifier}
        </Text>
      ),
    }),
    [props.issue.identifier, t],
  );
  const retry = useCallback(() => void workspaces.refetch(), [workspaces]);
  const selectModel = useCallback(
    (entry: AgentModelDefinition) => form.setProviderAndModelFromUser(entry.provider, entry.id),
    [form],
  );
  const footer = useMemo(
    () => (
      <Button
        variant="default"
        onPress={submit}
        disabled={!canSubmit}
        loading={state.pending}
        testID="linear-start-submit"
      >
        {t("linear.issue.startAgent")}
      </Button>
    ),
    [submit, canSubmit, state.pending, t],
  );
  return (
    <AdaptiveModalSheet
      visible
      onClose={close}
      header={header}
      desktopMaxWidth={720}
      desktopHeight={720}
      testID="linear-start-sheet"
      footer={footer}
    >
      <View style={styles.fields}>
        <SelectField
          label={t("linear.start.repository")}
          value={state.project?.id ?? null}
          selectedDisplay={state.project?.display ?? null}
          size={size}
          options={projects.map((entry) => ({
            id: entry.viewKey,
            value: entry.viewKey,
            label: entry.projectName,
            testID: `linear-start-repo-${entry.viewKey}`,
          }))}
          onChange={model.setProject}
          placeholder={t("linear.issue.chooseRepo")}
          emptyText={t("linear.issue.noProjects")}
          disabled={state.pending}
          searchable
          triggerTestID="linear-start-repo"
        />
        <Field label={t("linear.start.workspace")}>
          <SegmentedControl
            size={size}
            value={state.workspaceKind}
            onValueChange={model.setWorkspaceKind}
            options={[
              {
                value: "existing",
                disabled: state.pending,
                label: t("linear.start.existingWorkspace"),
                testID: "linear-start-existing",
              },
              {
                value: "new",
                label: newWorkspaceLabel,
                testID: "linear-start-new-worktree",
                disabled: state.pending,
              },
            ]}
          />
        </Field>
        {state.workspaceKind === "existing" ? (
          <SelectField
            label={t("linear.start.workspace")}
            size={size}
            value={state.workspace?.id ?? null}
            selectedDisplay={state.workspace?.display ?? null}
            options={workspaceOptions}
            onChange={model.setWorkspace}
            placeholder={t("linear.start.repositoryCheckout")}
            emptyText={t("linear.start.noWorkspaces")}
            disabled={workspacePickerDisabled}
            loading={workspaces.isFetching}
            searchable
            triggerTestID="linear-start-workspace"
          />
        ) : null}
        {state.workspaceKind === "existing" && workspaces.isError ? (
          <View>
            <Text style={styles.error}>{workspaces.error.message}</Text>
            <Button onPress={retry}>{t("linear.states.retry")}</Button>
          </View>
        ) : null}
        <SelectField
          label={t("linear.start.model")}
          size={size}
          value={selectedModel?.value ?? null}
          selectedDisplay={selectedModel ?? null}
          options={modelOptions}
          onChange={selectModel}
          placeholder={t("linear.start.chooseModel")}
          emptyText={t("linear.start.noModels")}
          loading={form.isAllModelsLoading}
          disabled={state.pending}
          searchable
          triggerTestID="linear-start-model"
        />
        <Field label={t("linear.start.prompt")}>
          <FormTextInput
            initialValue={state.prompt}
            onChangeText={model.setPrompt}
            size={size}
            multiline
            numberOfLines={10}
            style={styles.prompt}
            textAlignVertical="top"
            editable={!state.pending}
            testID="linear-start-prompt"
            accessibilityLabel={t("linear.start.prompt")}
          />
        </Field>
        {state.error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {t("linear.issue.startFailed")}: {state.error}
          </Text>
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  headerSubtitle: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  fields: { gap: theme.spacing[4] },
  prompt: { minHeight: 200 },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
}));
