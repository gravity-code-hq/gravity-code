import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { LinearIssueDetail } from "@gravity/protocol/linear/types";
import { ensureCheckoutStatus } from "@/git/checkout-status-cache";
import { useAgentFormState, type UseAgentFormStateResult } from "@/hooks/use-agent-form-state";
import { useDraftAgentFeatures } from "@/hooks/use-draft-agent-features";
import { buildLinearIssuePrompt, buildLinearIssueWorkspaceName } from "@/linear/issue-prompt";
import {
  getHostProjectId,
  getHostProjectSourceDirectory,
  getWorktreeSupportForHostProject,
  type HostProjectListItem,
} from "@/projects/host-project-model";
import {
  resolveEffectiveComposerModelId,
  resolveEffectiveComposerThinkingOptionId,
  type ProviderSelectionState,
} from "@/provider-selection/provider-selection";
import {
  getHostRuntimeStore,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
} from "@/runtime/host-runtime";
import {
  defaultBasePickerItem,
  pickerItemToCheckoutRequest,
} from "@/screens/new-workspace-picker-item";
import { generateDraftId } from "@/stores/draft-keys";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { normalizeWorkspaceDescriptor } from "@/stores/session-store";

/**
 * Whether a start can go straight to the daemon. When not ready the caller
 * falls back to the New workspace screen, which has the same defaults and lets
 * the user fill the gap (pick a model, connect the host).
 */
export type LinearQuickStartTarget =
  | { ready: false; reason: "offline" | "no-model" }
  | { ready: true };

/**
 * Where the agent runs. `checkout` runs in the project's own folder on its
 * current branch, with no worktree and no new branch.
 */
export type LinearStartTarget =
  | { kind: "worktree" }
  | { kind: "checkout" }
  | { kind: "workspace"; workspace: { id: string; workspaceDirectory: string } };

export interface LinearStartOptions {
  prompt: string;
  target: LinearStartTarget;
  idempotencyKey: string;
}

export interface LinearQuickStart {
  formState: UseAgentFormStateResult;
  target: LinearQuickStartTarget;
  /** Creates the workspace and its first agent, then navigates. Throws on failure. */
  start: (
    issue: LinearIssueDetail,
    project: HostProjectListItem,
    options?: LinearStartOptions,
  ) => Promise<void>;
}

/**
 * Starts an agent on a Linear issue in a repo the user just picked, without
 * the New workspace screen. Provider, model, mode, thinking option, and
 * feature values are the composer's remembered choices, resolved through the
 * same form state the composer uses so both paths agree. Worktrees branch off
 * the project checkout's current upstream, which is the composer's base picker
 * default as well.
 */
export function useLinearQuickStart(serverId: string, workingDir = ""): LinearQuickStart {
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  // The repo is chosen per click, so the form state runs without a working
  // directory. Remembered provider and model are per host, not per directory.
  const formState = useAgentFormState({
    serverId,
    workingDir,
    isVisible: true,
    isCreateFlow: true,
  });
  const selection = useMemo<ProviderSelectionState>(
    () => ({
      provider: formState.selectedProvider,
      modelId: formState.selectedModel,
      modeId: formState.selectedMode,
      thinkingOptionId: formState.selectedThinkingOptionId,
      availableModels: formState.availableModels,
      modeOptions: formState.modeOptions,
    }),
    [
      formState.availableModels,
      formState.modeOptions,
      formState.selectedMode,
      formState.selectedModel,
      formState.selectedProvider,
      formState.selectedThinkingOptionId,
    ],
  );
  const effectiveModelId = useMemo(() => resolveEffectiveComposerModelId(selection), [selection]);
  const effectiveThinkingOptionId = useMemo(
    () => resolveEffectiveComposerThinkingOptionId(selection, effectiveModelId),
    [effectiveModelId, selection],
  );
  const { featureValues } = useDraftAgentFeatures({
    serverId,
    provider: formState.selectedProvider,
    cwd: workingDir || null,
    modeId: formState.selectedMode,
    modelId: effectiveModelId,
    thinkingOptionId: effectiveThinkingOptionId,
  });

  const target = useMemo<LinearQuickStartTarget>(() => {
    if (!client || !isConnected) return { ready: false, reason: "offline" };
    if (!formState.selectedProvider || !effectiveModelId)
      return { ready: false, reason: "no-model" };
    return { ready: true };
  }, [client, effectiveModelId, formState.selectedProvider, isConnected]);

  const start = useCallback(
    async (
      issue: LinearIssueDetail,
      project: HostProjectListItem,
      options: LinearStartOptions = {
        prompt: buildLinearIssuePrompt(issue),
        target: { kind: "worktree" },
        idempotencyKey: generateDraftId(),
      },
    ) => {
      const provider = formState.selectedProvider;
      if (!target.ready || !client || !provider) throw new Error("Quick start is not available");
      const projectId = getHostProjectId(project, serverId);
      const sourceDirectory = getHostProjectSourceDirectory(project, serverId);
      if (!projectId || !sourceDirectory) throw new Error("Project is not available on this host");
      const prompt = options.prompt;
      const draftId = options.idempotencyKey;
      const startTarget = options.target;
      const config = {
        provider,
        cwd:
          startTarget.kind === "workspace"
            ? startTarget.workspace.workspaceDirectory
            : sourceDirectory,
        modeId: formState.selectedMode || undefined,
        model: effectiveModelId || undefined,
        thinkingOptionId: effectiveThinkingOptionId || undefined,
        featureValues,
      };
      if (startTarget.kind === "workspace") {
        const agent = await client.createAgent({
          config,
          workspaceId: startTarget.workspace.id,
          initialPrompt: prompt,
          idempotencyKey: draftId,
          clientMessageId: `${draftId}:initial-message`,
        });
        navigateToWorkspace({
          serverId,
          workspaceId: startTarget.workspace.id,
          target: { kind: "agent", agentId: agent.id },
        });
        return;
      }
      // A repo that cannot host a worktree attaches the workspace to its directory.
      const isWorktree =
        startTarget.kind === "worktree" &&
        getWorktreeSupportForHostProject({ project, serverId }) !== "unsupported";
      const checkoutRequest = isWorktree
        ? pickerItemToCheckoutRequest(
            defaultBasePickerItem(
              await ensureCheckoutStatus({ queryClient, client, serverId, cwd: sourceDirectory }),
            ),
          )
        : undefined;
      const payload = await client.createWorkspace({
        idempotencyKey: draftId,
        source: isWorktree
          ? {
              kind: "worktree",
              cwd: sourceDirectory,
              projectId,
              worktreeSlug: buildLinearIssueWorkspaceName(issue),
              ...checkoutRequest,
            }
          : { kind: "directory", path: sourceDirectory, projectId },
        firstAgentContext: { prompt, attachments: [] },
        agent: {
          config,
          initialPrompt: prompt,
          clientMessageId: `${draftId}:initial-message`,
        },
      });
      if (payload.error || !payload.workspace) {
        throw new Error(payload.error ?? "Failed to create workspace");
      }
      const workspace = normalizeWorkspaceDescriptor(payload.workspace);
      getHostRuntimeStore().acceptWorkspaceSnapshots(serverId, [
        { ...workspace, status: "running", statusEnteredAt: new Date() },
      ]);
      navigateToWorkspace({ serverId, workspaceId: workspace.id });
    },
    [
      client,
      effectiveModelId,
      effectiveThinkingOptionId,
      featureValues,
      formState.selectedMode,
      formState.selectedProvider,
      queryClient,
      serverId,
      target.ready,
    ],
  );

  return { target, start, formState };
}
