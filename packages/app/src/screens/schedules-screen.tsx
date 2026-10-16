import { useCallback, useMemo, useState, useSyncExternalStore, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { CalendarClock, CircleDot, ListFilter, Plus } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { ExternalLink } from "@/components/ui/external-link";
import { ScheduleFormSheet } from "@/components/schedules/schedule-form-sheet";
import {
  ScheduleFilterMenu,
  type ScheduleFilterOption,
} from "@/components/schedules/schedule-filter-menu";
import { SchedulesTable, type ScheduleRowView } from "@/components/schedules/schedules-table";
import { ScheduleRunsSummary, ScheduleRunsTable } from "@/components/schedules/schedule-runs-table";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useProjects } from "@/hooks/use-projects";
import { useScheduleRuns } from "@/hooks/use-schedule-runs";
import {
  useSchedules,
  type AggregateLoadState,
  type AggregatedSchedule,
  type ScheduleHostError,
} from "@/hooks/use-schedules";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import {
  resolveSchedule,
  type ScheduleBucket,
  type ScheduleTargetAgent,
} from "@/schedules/schedule-derivation";
import { filterScheduleRows, type ScheduleStatusFilter } from "@/schedules/schedule-list-filter";
import {
  countScheduleRunOutcomes,
  filterScheduleRunEntries,
  scheduleKey,
  type ScheduleRunStatusFilter,
} from "@/schedules/schedule-runs";
import { resolveSchedulesScreenBodyState } from "./schedules-screen-state";
import {
  buildProjectNameByCwd,
  buildScheduleProjectTargets,
} from "@/schedules/schedule-project-targets";
import { resolveScheduleTitle } from "@/utils/schedule-format";
import type { ScheduleSummary } from "@gravity/protocol/schedule/types";
import { SCHEDULE_TEMPLATES, type ScheduleTemplate } from "@gravity/protocol/schedule/templates";
import type { Theme } from "@/styles/theme";

type FormState =
  | { mode: "closed" }
  | { mode: "create"; templateId?: string }
  | { mode: "edit"; serverId: string; schedule: ScheduleSummary };

type SchedulesView = "automations" | "runs";

const VIEW_OPTIONS: { value: SchedulesView; label: string; testID: string }[] = [
  { value: "automations", label: "Automations", testID: "schedules-view-automations" },
  { value: "runs", label: "Runs", testID: "schedules-view-runs" },
];

const SCHEDULE_STATUS_OPTIONS: ScheduleFilterOption<ScheduleStatusFilter>[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "ended", label: "Ended" },
];

const RUN_STATUS_OPTIONS: ScheduleFilterOption<ScheduleRunStatusFilter>[] = [
  { value: "all", label: "All statuses" },
  { value: "running", label: "Running" },
  { value: "succeeded", label: "Done" },
  { value: "failed", label: "Failed" },
];

const ALL_AUTOMATIONS = "all";

const ThemedListFilter = withUnistyles(ListFilter);
const ThemedCircleDot = withUnistyles(CircleDot);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const statusFilterLeading = <ThemedListFilter size={14} uniProps={mutedColorMapping} />;
const automationFilterLeading = <ThemedCircleDot size={14} uniProps={mutedColorMapping} />;

// Automations that can still run sit above the ones that never will again.
const BUCKET_ORDER: Record<ScheduleBucket, number> = { runnable: 0, ended: 1 };

const EMPTY_SCHEDULES: AggregatedSchedule[] = [];

export function SchedulesScreen(): ReactElement {
  const isFocused = useIsFocused();

  if (!isFocused) {
    return <View style={styles.container} />;
  }

  return <SchedulesScreenContent />;
}

/**
 * Automations are per host (each daemon owns its own), so the screen pins one:
 * the host the sidebar footer is pinned to, otherwise the active workspace's
 * host, otherwise the first one. Switching happens in the sidebar footer.
 */
function useSelectedScheduleHost(): string | null {
  const hosts = useHosts();
  const hostFilters = useSidebarViewStore((state) => state.hostFilters);
  const activeSelection = useActiveWorkspaceSelection();
  const pinnedHost = hostFilters.length === 1 ? hostFilters[0] : null;
  if (pinnedHost && hosts.some((host) => host.serverId === pinnedHost)) return pinnedHost;
  return activeSelection?.serverId ?? hosts[0]?.serverId ?? null;
}

function SchedulesScreenContent(): ReactElement {
  const selectedHost = useSelectedScheduleHost();

  if (!selectedHost) {
    return (
      <View style={styles.container}>
        <MenuHeader title="Automations" />
        <View style={styles.centered}>
          <Text style={styles.message}>Connect a host to use automations.</Text>
        </View>
      </View>
    );
  }

  return <SchedulesHostScreen key={selectedHost} serverId={selectedHost} />;
}

function SchedulesHostScreen({ serverId }: { serverId: string }): ReactElement {
  const { loadState, hostErrors, isError, refetch } = useSchedules({ serverId });
  const schedules = loadState.status === "loaded" ? loadState.data : EMPTY_SCHEDULES;
  const { agents } = useAggregatedAgents({ includeArchived: true });
  const { projects } = useProjects();
  const hosts = useHosts();
  const runtime = getHostRuntimeStore();
  const runtimeVersion = useSyncExternalStore(
    (onStoreChange) => runtime.subscribeAll(onStoreChange),
    () => runtime.getVersion(),
    () => runtime.getVersion(),
  );

  // Per-host agent-directory readiness from the runtime, not the aggregate agent
  // flag: the aggregate `isInitialLoad` flips false as soon as *any* host has
  // agents, so a still-loading host would falsely mark its agent-target
  // schedules "gone". `hasEverLoadedAgentDirectory` is true only once that
  // host's directory has loaded at least once.
  const agentDirReadyHosts = useMemo(() => {
    void runtimeVersion;
    const ready = new Set<string>();
    for (const host of hosts) {
      if (runtime.getSnapshot(host.serverId)?.hasEverLoadedAgentDirectory) {
        ready.add(host.serverId);
      }
    }
    return ready;
  }, [hosts, runtime, runtimeVersion]);

  const [form, setForm] = useState<FormState>({ mode: "closed" });
  const [view, setView] = useState<SchedulesView>("automations");

  const openCreate = useCallback(
    (templateId?: string) =>
      setForm(templateId ? { mode: "create", templateId } : { mode: "create" }),
    [],
  );
  const openCreateBlank = useCallback(() => openCreate(), [openCreate]);
  const openEdit = useCallback((schedule: AggregatedSchedule) => {
    setForm({ mode: "edit", serverId: schedule.serverId, schedule });
  }, []);
  const closeForm = useCallback(() => setForm({ mode: "closed" }), []);

  const agentsByKey = useMemo(() => {
    const map = new Map<string, ScheduleTargetAgent>();
    for (const agent of agents) {
      map.set(`${agent.serverId}:${agent.id}`, { title: agent.title, provider: agent.provider });
    }
    return map;
  }, [agents]);

  const projectNameByCwd = useMemo(
    () => buildProjectNameByCwd(buildScheduleProjectTargets(projects)),
    [projects],
  );

  // Resolve every schedule's derived state and target line once.
  const resolvedRows = useMemo(() => {
    const now = Date.now();
    return schedules.map((schedule) => ({
      schedule,
      resolved: resolveSchedule({
        schedule,
        serverId: schedule.serverId,
        now,
        agentsByKey,
        projectNameByCwd,
        agentDataLoaded: agentDirReadyHosts.has(schedule.serverId),
      }),
    }));
  }, [schedules, agentsByKey, projectNameByCwd, agentDirReadyHosts]);

  const providerByScheduleKey = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const { schedule, resolved } of resolvedRows) {
      map.set(`${schedule.serverId}:${schedule.id}`, resolved.target.provider);
    }
    return map;
  }, [resolvedRows]);

  const visibleRows = useMemo<ScheduleRowView[]>(() => {
    return [...resolvedRows]
      .sort(
        (a, b) =>
          BUCKET_ORDER[a.resolved.bucket] - BUCKET_ORDER[b.resolved.bucket] ||
          Date.parse(b.schedule.createdAt) - Date.parse(a.schedule.createdAt),
      )
      .map(({ schedule, resolved }) => ({
        schedule,
        targetLabel: resolved.target.label,
        provider: resolved.target.provider,
        state: resolved.state,
        serverName: schedule.serverName,
        // One host per screen; the footer names it, so rows do not repeat it.
        singleHost: true,
      }));
  }, [resolvedRows]);

  const showLoadError = isError && loadState.status !== "loaded";

  return (
    <View style={styles.container}>
      <MenuHeader title="Automations" />
      <SchedulesScreenBody
        serverId={serverId}
        schedules={schedules}
        providerByScheduleKey={providerByScheduleKey}
        rows={visibleRows}
        loadState={loadState}
        hostErrors={hostErrors}
        showLoadError={showLoadError}
        view={view}
        onViewChange={setView}
        onRetry={refetch}
        onCreate={openCreateBlank}
        onCreateFromTemplate={openCreate}
        onEdit={openEdit}
      />
      <ScheduleFormSheet
        serverId={form.mode === "edit" ? form.serverId : serverId}
        visible={form.mode === "create" || form.mode === "edit"}
        onClose={closeForm}
        mode={form.mode === "edit" ? "edit" : "create"}
        schedule={form.mode === "edit" ? form.schedule : undefined}
        templateId={form.mode === "create" ? form.templateId : undefined}
      />
    </View>
  );
}

function SchedulesScreenBody({
  serverId,
  schedules,
  providerByScheduleKey,
  rows,
  loadState,
  hostErrors,
  showLoadError,
  view,
  onViewChange,
  onRetry,
  onCreate,
  onCreateFromTemplate,
  onEdit,
}: {
  serverId: string;
  schedules: AggregatedSchedule[];
  providerByScheduleKey: ReadonlyMap<string, string | null>;
  rows: ScheduleRowView[];
  loadState: AggregateLoadState<AggregatedSchedule>;
  hostErrors: ScheduleHostError[];
  showLoadError: boolean;
  view: SchedulesView;
  onViewChange: (value: SchedulesView) => void;
  onRetry: () => void;
  onCreate: () => void;
  onCreateFromTemplate: (templateId: string) => void;
  onEdit: (schedule: AggregatedSchedule) => void;
}): ReactElement {
  const bodyState = resolveSchedulesScreenBodyState({ loadState, showLoadError });

  if (bodyState.kind === "loading") {
    return (
      <View style={styles.centered}>
        <LoadingSpinner size="large" color={styles.spinner.color} />
      </View>
    );
  }

  if (bodyState.kind === "load-error") {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>Unable to load automations</Text>
        <Button variant="ghost" onPress={onRetry} testID="schedules-retry">
          Try again
        </Button>
      </View>
    );
  }

  if (bodyState.kind === "empty") {
    return (
      <View style={styles.centered}>
        {hostErrors.length > 0 ? <ScheduleHostErrorsBanner errors={hostErrors} /> : null}
        <SchedulesEmptyState
          onCreate={onCreate}
          onCreateFromTemplate={onCreateFromTemplate}
          testID="schedules-empty"
        />
      </View>
    );
  }

  let schedulesContent: ReactElement;
  if (view === "runs") {
    schedulesContent = (
      <ScheduleRunsContent
        serverId={serverId}
        schedules={schedules}
        providerByScheduleKey={providerByScheduleKey}
      />
    );
  } else if (rows.length > 0) {
    schedulesContent = <SchedulesListContent rows={rows} onEdit={onEdit} />;
  } else {
    schedulesContent = (
      <View style={styles.filterEmpty}>
        <SchedulesEmptyState
          onCreate={onCreate}
          onCreateFromTemplate={onCreateFromTemplate}
          testID="schedules-empty"
        />
      </View>
    );
  }

  return (
    <View style={styles.body}>
      <View style={styles.filterRow}>
        <View style={styles.filterRowControls}>
          <SegmentedControl
            size="sm"
            value={view}
            onValueChange={onViewChange}
            options={VIEW_OPTIONS}
            testID="schedules-view"
          />
        </View>
        <Button
          variant="outline"
          leftIcon={Plus}
          onPress={onCreate}
          size="sm"
          testID="schedules-new"
        >
          New automation
        </Button>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        testID="schedules-list"
      >
        {hostErrors.length > 0 ? <ScheduleHostErrorsBanner errors={hostErrors} /> : null}
        {schedulesContent}
      </ScrollView>
    </View>
  );
}

function SchedulesEmptyState({
  onCreate,
  onCreateFromTemplate,
  testID,
}: {
  onCreate: () => void;
  onCreateFromTemplate: (templateId: string) => void;
  testID?: string;
}): ReactElement {
  return (
    <View style={styles.emptyState} testID={testID}>
      <CalendarClock size={styles.emptyIcon.width} color={styles.emptyIcon.color} />
      <View style={styles.emptyTextStack}>
        <Text style={styles.emptyTitle}>No automations yet</Text>
        <Text style={styles.emptyDescription}>Automations run agents on a cadence.</Text>
        <ExternalLink
          href="https://github.com/gravity-code-hq/gravity-code/docs/schedules"
          label="See docs"
        />
      </View>
      <Button variant="outline" leftIcon={Plus} onPress={onCreate} testID="schedules-empty-new">
        New automation
      </Button>
      <View style={styles.templates} testID="schedules-templates">
        <Text style={styles.templatesTitle}>Or start from a template</Text>
        <View style={styles.templateCard}>
          {SCHEDULE_TEMPLATES.map((template, index) => (
            <ScheduleTemplateRow
              key={template.id}
              template={template}
              bordered={index > 0}
              onSelect={onCreateFromTemplate}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

function ScheduleTemplateRow({
  template,
  bordered,
  onSelect,
}: {
  template: ScheduleTemplate;
  bordered: boolean;
  onSelect: (templateId: string) => void;
}): ReactElement {
  const select = useCallback(() => onSelect(template.id), [onSelect, template.id]);
  const rowStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.templateRow,
      bordered && styles.templateRowBorder,
      pressed && styles.templateRowPressed,
    ],
    [bordered],
  );
  return (
    <Pressable
      accessibilityRole="button"
      onPress={select}
      style={rowStyle}
      testID={`schedules-template-${template.id}`}
    >
      <Text style={styles.templateLabel}>{template.label}</Text>
      <Text style={styles.templateDescription}>{template.description}</Text>
    </Pressable>
  );
}

function SchedulesListContent({
  rows,
  onEdit,
}: {
  rows: ScheduleRowView[];
  onEdit: (schedule: AggregatedSchedule) => void;
}): ReactElement {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ScheduleStatusFilter>("all");
  const visibleRows = useMemo(
    () => filterScheduleRows(rows, { query, status }),
    [rows, query, status],
  );

  return (
    <View style={styles.listSection}>
      <View style={styles.toolbar}>
        <View style={styles.toolbarSearch}>
          <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder="Search automations"
            clearAccessibilityLabel="Clear automation search"
            testID="schedules-search"
          />
        </View>
        <ScheduleFilterMenu
          leading={statusFilterLeading}
          name="Status"
          value={status}
          options={SCHEDULE_STATUS_OPTIONS}
          onChange={setStatus}
          testID="schedules-status-filter"
        />
      </View>
      {visibleRows.length > 0 ? (
        <SchedulesTable rows={visibleRows} onEditSchedule={onEdit} />
      ) : (
        <View style={styles.inlineEmptyState} testID="schedules-filter-empty">
          <CalendarClock size={styles.emptyIcon.width} color={styles.emptyIcon.color} />
          <Text style={styles.emptyTitle}>No automations match these filters</Text>
        </View>
      )}
    </View>
  );
}

function ScheduleRunsContent({
  serverId,
  schedules,
  providerByScheduleKey,
}: {
  serverId: string;
  schedules: AggregatedSchedule[];
  providerByScheduleKey: ReadonlyMap<string, string | null>;
}): ReactElement {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ScheduleRunStatusFilter>("all");
  const [automation, setAutomation] = useState<string>(ALL_AUTOMATIONS);
  const runs = useScheduleRuns({ serverId, schedules, enabled: true });
  const automationOptions = useMemo<ScheduleFilterOption<string>[]>(
    () => [
      { value: ALL_AUTOMATIONS, label: "All automations" },
      ...schedules.map((schedule) => ({
        value: scheduleKey(schedule),
        label: resolveScheduleTitle(schedule),
      })),
    ],
    [schedules],
  );
  // The summary cards follow the automation filter only: they are the status
  // breakdown, so the status filter and search would just zero them out.
  const automationEntries = useMemo(
    () =>
      filterScheduleRunEntries(runs.data?.entries ?? [], {
        scheduleKey: automation === ALL_AUTOMATIONS ? null : automation,
      }),
    [runs.data, automation],
  );
  const counts = useMemo(
    () => countScheduleRunOutcomes(automationEntries, Date.now()),
    [automationEntries],
  );
  const visibleEntries = useMemo(
    () => filterScheduleRunEntries(automationEntries, { query, status }),
    [automationEntries, query, status],
  );
  const isFiltered = query.trim() !== "" || status !== "all" || automation !== ALL_AUTOMATIONS;

  let list: ReactElement;
  if (!runs.data) {
    list = runs.isError ? (
      <View style={styles.inlineEmptyState}>
        <Text style={styles.message}>Unable to load runs</Text>
        <Button variant="ghost" onPress={runs.refetch} testID="schedule-runs-retry">
          Try again
        </Button>
      </View>
    ) : (
      <View style={styles.inlineEmptyState}>
        <LoadingSpinner size="large" color={styles.spinner.color} />
      </View>
    );
  } else if (visibleEntries.length > 0) {
    list = (
      <ScheduleRunsTable entries={visibleEntries} providerByScheduleKey={providerByScheduleKey} />
    );
  } else {
    list = (
      <View style={styles.inlineEmptyState} testID="schedule-runs-empty">
        <CalendarClock size={styles.emptyIcon.width} color={styles.emptyIcon.color} />
        <Text style={styles.emptyTitle}>
          {isFiltered ? "No runs match these filters" : "No runs yet"}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.listSection}>
      <View style={styles.toolbar}>
        <View style={styles.toolbarSearch}>
          <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder="Search runs"
            clearAccessibilityLabel="Clear run search"
            testID="schedule-runs-search"
          />
        </View>
        <ScheduleFilterMenu
          leading={statusFilterLeading}
          name="Status"
          value={status}
          options={RUN_STATUS_OPTIONS}
          onChange={setStatus}
          testID="schedule-runs-status-filter"
        />
        <ScheduleFilterMenu
          leading={automationFilterLeading}
          name="Automation"
          value={automation}
          options={automationOptions}
          onChange={setAutomation}
          testID="schedule-runs-automation-filter"
        />
      </View>
      <View style={styles.runsBody}>
        <ScheduleRunsSummary counts={counts} />
        {runs.data && runs.data.failures.length > 0 ? (
          <View style={styles.errorsBanner} testID="schedule-runs-errors">
            {runs.data.failures.map((failure) => (
              <Text key={failure.schedule.id} style={styles.errorsBannerText}>
                {`Could not load runs for ${resolveScheduleTitle(failure.schedule)}`}
              </Text>
            ))}
          </View>
        ) : null}
        {list}
      </View>
    </View>
  );
}

function ScheduleHostErrorsBanner({ errors }: { errors: ScheduleHostError[] }): ReactElement {
  return (
    <View style={styles.errorsBannerWrap}>
      <View style={styles.errorsBanner} testID="schedules-host-errors">
        {errors.map((error) => (
          <Text key={error.serverId} style={styles.errorsBannerText}>
            {`${error.serverName}: Could not load automations`}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[6],
    padding: theme.spacing[6],
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: theme.spacing[4],
  },
  filterRowControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    flexShrink: 1,
    flexWrap: "wrap",
  },
  listSection: {
    gap: theme.spacing[3],
  },
  toolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
  },
  runsBody: {
    gap: theme.spacing[3],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
  },
  toolbarSearch: {
    flexGrow: 1,
    flexBasis: 200,
    maxWidth: 320,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    flexGrow: 1,
    gap: theme.spacing[3],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[6],
  },
  errorsBannerWrap: {
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
  },
  errorsBanner: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
    gap: theme.spacing[1],
  },
  errorsBannerText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
  filterEmpty: {
    flexGrow: 1,
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingVertical: theme.spacing[6],
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    alignItems: "center",
    gap: theme.spacing[4],
    maxWidth: 420,
    width: "100%",
  },
  inlineEmptyState: {
    alignItems: "center",
    gap: theme.spacing[3],
  },
  emptyTextStack: {
    alignItems: "center",
    gap: theme.spacing[2],
  },
  templates: {
    width: "100%",
    gap: theme.spacing[3],
    paddingTop: theme.spacing[4],
  },
  templatesTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  templateCard: {
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  templateRow: {
    padding: theme.spacing[4],
    gap: theme.spacing[1],
  },
  templateRowBorder: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  templateRowPressed: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  templateLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  templateDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    textAlign: "center",
  },
  emptyDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  // Static color holder read by the spinner; keeps the muted token without
  // useUnistyles (banned in new code).
  spinner: {
    color: theme.colors.foregroundMuted,
  },
  emptyIcon: {
    color: theme.colors.foregroundMuted,
    width: theme.iconSize.lg,
  },
}));
