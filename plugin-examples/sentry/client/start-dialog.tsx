import type { PluginTheme } from "@gravity/plugin";
import {
  type PluginSurfaceProps,
  type SettingsState,
  useGravity,
  useRpc,
  useSettings,
} from "@gravity/plugin/client";
import { Icon, Modal, TextInput, useToast } from "@gravity/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Text, View } from "react-native";
import {
  listModelsRpc,
  type SentryIssueDetail,
  type SentryIssueSummary,
  type SentryModelOption,
} from "../shared/contracts";
import {
  type SentryStartGoal,
  type SentryStartTarget,
  startPreferences,
} from "../shared/preferences";
import {
  buildSentryIssuePrompt,
  buildSentryWorkspaceSlug,
  replaceSentryAsk,
} from "../shared/prompt";
import { Button, ChoiceChips, InlineSelect, type PickerOption } from "./controls";
import { describeError } from "./format";
import { useIssueDetail } from "./issue-detail";
import { sentryKeys } from "./queries";

const TITLE_MAX_CHARS = 80;
const LOADING = { gap: 8, alignItems: "center" as const };
const MONOSPACE = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

const GOALS: PickerOption<SentryStartGoal>[] = [
  { value: "pull-request", label: "Fix and open a PR" },
  { value: "fix", label: "Fix, don't commit" },
  { value: "investigate", label: "Investigate only" },
];

const TARGETS: PickerOption<SentryStartTarget>[] = [
  { value: "worktree", label: "New worktree" },
  { value: "checkout", label: "Project checkout" },
];

type StartPreferences = Extract<SettingsState<typeof startPreferences.schema>, { status: "ready" }>;

interface GravityProject {
  projectId: string;
  projectDisplayName: string;
  projectRootPath: string;
  projectKind: "git" | "non_git" | "directory";
}

interface StartDialogProps {
  theme: PluginTheme;
  organization: string;
  issue: SentryIssueSummary | null;
  navigation: PluginSurfaceProps["navigation"];
  onClose(): void;
}

export function StartDialog({ theme, organization, issue, navigation, onClose }: StartDialogProps) {
  const icon = useMemo(
    () => <Icon name="Bot" size={18} color={theme.colors.foreground} />,
    [theme],
  );
  const changeOpen = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );
  return (
    <Modal title="Start agent" icon={icon} open={issue !== null} onOpenChange={changeOpen}>
      <Modal.Content>
        {issue ? (
          <StartDialogBody
            theme={theme}
            organization={organization}
            issue={issue}
            navigation={navigation}
            onClose={onClose}
          />
        ) : null}
      </Modal.Content>
    </Modal>
  );
}

function StartDialogBody({
  theme,
  organization,
  issue,
  navigation,
  onClose,
}: StartDialogProps & { issue: SentryIssueSummary }) {
  const gravity = useGravity();
  const listModels = useRpc(listModelsRpc);
  const detail = useIssueDetail(organization, issue.id);
  const settings = useSettings(startPreferences);
  const projects = useQuery({
    queryKey: sentryKeys.gravityProjects(),
    queryFn: async () => (await gravity.projects.list()).projects as GravityProject[],
  });
  const models = useQuery({
    queryKey: sentryKeys.models(),
    queryFn: async () => (await listModels({})).models,
    staleTime: 5 * 60_000,
  });
  const muted = useMemo(() => ({ color: theme.colors.foregroundMuted, fontSize: 13 }), [theme]);
  const danger = useMemo(() => ({ color: theme.colors.statusDanger, fontSize: 13 }), [theme]);

  const error = detail.error ?? projects.error ?? models.error;
  if (error) return <Text style={danger}>{describeError(error)}</Text>;
  if (settings.status === "error" || settings.status === "invalid") {
    return <Text style={danger}>{settings.error}</Text>;
  }
  if (!detail.data || !projects.data || !models.data || settings.status === "loading") {
    return (
      <View style={LOADING}>
        <ActivityIndicator color={theme.colors.foregroundMuted} />
        <Text style={muted}>Loading the issue, repositories, and models…</Text>
      </View>
    );
  }
  if (projects.data.length === 0) {
    return <Text style={muted}>Add a project to Gravity on this host, then start the agent.</Text>;
  }
  if (models.data.length === 0) {
    return <Text style={muted}>No agent provider is ready on this host.</Text>;
  }
  return (
    <StartForm
      theme={theme}
      issue={detail.data}
      projects={projects.data}
      models={models.data}
      settings={settings}
      navigation={navigation}
      onClose={onClose}
    />
  );
}

function guessProject(issue: SentryIssueDetail, projects: GravityProject[]): GravityProject {
  const slug = issue.project.slug.toLowerCase();
  return (
    projects.find((project) => project.projectDisplayName.toLowerCase() === slug) ??
    projects.find((project) => project.projectDisplayName.toLowerCase().includes(slug)) ??
    projects[0]
  );
}

function initialModel(saved: string | null, models: SentryModelOption[]): string {
  if (saved && models.some((model) => model.id === saved)) return saved;
  return (models.find((model) => model.isDefault) ?? models[0]).id;
}

function targetHint(
  target: SentryStartTarget,
  canWorktree: boolean,
  issue: SentryIssueDetail,
): string {
  if (target === "worktree") {
    return `A new branch, ${buildSentryWorkspaceSlug(issue)}, off the default branch.`;
  }
  if (canWorktree) return "The repository folder, on its current branch.";
  return "This folder is not a git repository, so the agent runs in it directly.";
}

type Launched = { kind: "workspace"; id: string } | { kind: "agent"; id: string };

/**
 * A worktree start creates the workspace and its first agent in one request.
 * A checkout start reuses the folder's workspace and adds an agent to it.
 */
async function launchAgent(input: {
  gravity: ReturnType<typeof useGravity>;
  issue: SentryIssueDetail;
  project: GravityProject;
  model: string;
  prompt: string;
  target: SentryStartTarget;
  idempotencyKey: string;
}): Promise<Launched> {
  const { gravity, issue, project, prompt, idempotencyKey } = input;
  const title = `${issue.shortId}: ${issue.title}`.slice(0, TITLE_MAX_CHARS);
  const agent = {
    config: { provider: input.model },
    cwd: project.projectRootPath,
    prompt,
    title,
    labels: { "sentry-issue": issue.shortId },
  };
  if (input.target === "checkout") {
    const workspace = await gravity.workspaces.open(project.projectRootPath);
    const created = await workspace.agents.create({ ...agent, idempotencyKey });
    return { kind: "agent", id: created.id };
  }
  const slug = buildSentryWorkspaceSlug(issue);
  const workspace = await gravity.workspaces.create({
    idempotencyKey,
    title,
    source: {
      kind: "worktree",
      cwd: project.projectRootPath,
      projectId: project.projectId,
      action: "branch-off",
      worktreeSlug: slug,
      branchName: slug,
    },
    firstAgentContext: { prompt, attachments: [] },
    agent,
  });
  return { kind: "workspace", id: workspace.id };
}

function StartForm({
  theme,
  issue,
  projects,
  models,
  settings,
  navigation,
  onClose,
}: {
  theme: PluginTheme;
  issue: SentryIssueDetail;
  projects: GravityProject[];
  models: SentryModelOption[];
  settings: StartPreferences;
  navigation: PluginSurfaceProps["navigation"];
  onClose(): void;
}) {
  const gravity = useGravity();
  const toast = useToast();
  const saved = settings.values;
  const [projectId, setProjectId] = useState(() => {
    const remembered = saved.repositories[issue.project.slug];
    return projects.some((project) => project.projectId === remembered)
      ? remembered
      : guessProject(issue, projects).projectId;
  });
  const [model, setModel] = useState(() => initialModel(saved.model, models));
  const [goal, setGoal] = useState<SentryStartGoal>(saved.goal);
  const [target, setTarget] = useState<SentryStartTarget>(saved.target);
  const [prompt, setPrompt] = useState(() => buildSentryIssuePrompt(issue, saved.goal));
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // One key per dialog, so a retried submit cannot create a second workspace.
  const [idempotencyKey] = useState(() => `sentry-${issue.id}-${Date.now().toString(36)}`);

  const project = projects.find((candidate) => candidate.projectId === projectId) ?? projects[0];
  const canWorktree = project.projectKind === "git";
  const effectiveTarget: SentryStartTarget = canWorktree ? target : "checkout";

  const projectOptions = useMemo<PickerOption<string>[]>(
    () =>
      projects.map((candidate) => ({
        value: candidate.projectId,
        label: candidate.projectDisplayName,
        detail: candidate.projectRootPath,
      })),
    [projects],
  );
  const modelOptions = useMemo<PickerOption<string>[]>(
    () =>
      models.map((option) => ({
        value: option.id,
        label: option.label,
        detail: option.providerLabel,
      })),
    [models],
  );
  const styles = useMemo(
    () => ({
      form: { gap: 16 },
      label: { color: theme.colors.foreground, fontSize: 13, fontWeight: "500" as const },
      field: { gap: 6 },
      hint: { color: theme.colors.foregroundMuted, fontSize: 12 },
      prompt: {
        minHeight: 200,
        maxHeight: 360,
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 8,
        padding: 12,
        fontFamily: MONOSPACE,
        fontSize: 12,
        textAlignVertical: "top" as const,
      },
      error: { color: theme.colors.statusDanger, fontSize: 13 },
      actions: { flexDirection: "row" as const, justifyContent: "flex-end" as const, gap: 8 },
    }),
    [theme],
  );

  const changeTarget = useCallback((next: SentryStartTarget) => setTarget(next), []);
  const changeGoal = useCallback(
    (next: SentryStartGoal) => {
      setGoal(next);
      setPrompt((current) => replaceSentryAsk(current, issue, next));
    },
    [issue],
  );

  const start = useCallback(async () => {
    if (pending || !prompt.trim()) return;
    setPending(true);
    setFailure(null);
    let launched: Launched;
    try {
      launched = await launchAgent({
        gravity,
        issue,
        project,
        model,
        prompt,
        target: effectiveTarget,
        idempotencyKey,
      });
    } catch (error) {
      setFailure(describeError(error));
      setPending(false);
      return;
    }
    if (launched.kind === "workspace") navigation?.openWorkspace({ workspaceId: launched.id });
    else navigation?.openAgent({ agentId: launched.id });
    toast.show(`Agent started on ${issue.shortId}`, { variant: "success" });
    void settings.save(
      {
        model,
        goal,
        target,
        repositories: { ...saved.repositories, [issue.project.slug]: project.projectId },
      },
      settings.revision,
    );
    onClose();
  }, [
    effectiveTarget,
    goal,
    gravity,
    idempotencyKey,
    issue,
    model,
    navigation,
    onClose,
    pending,
    project,
    prompt,
    saved.repositories,
    settings,
    target,
    toast,
  ]);
  const submit = useCallback(() => void start(), [start]);

  return (
    <View style={styles.form}>
      <InlineSelect
        theme={theme}
        label="Repository"
        value={project.projectId}
        placeholder="Choose a repository"
        options={projectOptions}
        onChange={setProjectId}
        disabled={pending}
      />
      <InlineSelect
        theme={theme}
        label="Model"
        value={model}
        placeholder="Choose a model"
        options={modelOptions}
        onChange={setModel}
        disabled={pending}
      />
      <View style={styles.field}>
        <Text style={styles.label}>Goal</Text>
        <ChoiceChips theme={theme} options={GOALS} value={goal} onChange={changeGoal} />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Run in</Text>
        <ChoiceChips
          theme={theme}
          options={TARGETS}
          value={effectiveTarget}
          onChange={changeTarget}
        />
        <Text style={styles.hint}>{targetHint(effectiveTarget, canWorktree, issue)}</Text>
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Prompt</Text>
        <TextInput
          multiline
          value={prompt}
          onChangeText={setPrompt}
          editable={!pending}
          scrollEnabled
          style={styles.prompt}
        />
      </View>
      {failure ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {failure}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button theme={theme} label="Cancel" variant="ghost" onPress={onClose} disabled={pending} />
        <Button
          theme={theme}
          label="Start agent"
          icon="Play"
          variant="primary"
          pending={pending}
          disabled={!prompt.trim()}
          onPress={submit}
        />
      </View>
    </View>
  );
}
