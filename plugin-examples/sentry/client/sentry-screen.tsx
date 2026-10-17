import type { PluginTheme } from "@gravity/plugin";
import {
  type PluginSurfaceProps,
  type SettingsState,
  useRpc,
  useSettings,
} from "@gravity/plugin/client";
import { FlatList, Icon, TextInput } from "@gravity/plugin/client/react-native";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import {
  listIssuesRpc,
  listProjectsRpc,
  type SentryIssueFilter,
  type SentryIssuePeriod,
  type SentryIssueSort,
  type SentryIssueSummary,
  type SentryProject,
  type SentryStatus,
  statusRpc,
} from "../shared/contracts";
import { SENTRY_TOKEN_REJECTED } from "../shared/onboarding";
import { browsePreferences } from "../shared/preferences";
import { ConnectScreen } from "./connect-screen";
import { Button, ChoiceChips, OptionPicker, type PickerOption } from "./controls";
import { describeError, formatAge, formatCount, levelColor } from "./format";
import { IssueDetail } from "./issue-detail";
import { sentryKeys } from "./queries";
import { StartDialog } from "./start-dialog";
import { useDisconnect } from "./use-disconnect";

const SEARCH_DEBOUNCE_MS = 400;
const DISCONNECT_CONFIRM_MS = 4000;
const ALL_PROJECTS = "all";

const FILTERS: PickerOption<SentryIssueFilter>[] = [
  { value: "unresolved", label: "Unresolved" },
  { value: "assigned", label: "Assigned to me" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

const SORTS: PickerOption<SentryIssueSort>[] = [
  { value: "date", label: "Last seen" },
  { value: "new", label: "First seen" },
  { value: "freq", label: "Events" },
  { value: "user", label: "Users" },
];

const PERIODS: PickerOption<SentryIssuePeriod>[] = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "14d", label: "Last 14 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

type Connected = Extract<SentryStatus, { state: "connected" }>;
type BrowseSettings = Extract<SettingsState<typeof browsePreferences.schema>, { status: "ready" }>;
type BrowseValues = BrowseSettings["values"];

export function SentryScreen(props: PluginSurfaceProps) {
  const { theme, layout } = props;
  const getStatus = useRpc(statusRpc);
  const status = useQuery({ queryKey: sentryKeys.status(), queryFn: () => getStatus({}) });
  const browse = useSettings(browsePreferences);
  const { refetch } = status;
  const retry = useCallback(() => void refetch(), [refetch]);
  const styles = useMemo(
    () => ({
      center: {
        flex: 1,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        gap: 12,
        padding: 24,
        backgroundColor: theme.colors.surface0,
      },
      error: { color: theme.colors.statusDanger, fontSize: 14, textAlign: "center" as const },
    }),
    [theme],
  );
  if (status.error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{describeError(status.error)}</Text>
        <Button theme={theme} icon="RefreshCw" label="Try again" onPress={retry} />
      </View>
    );
  }
  if (!status.data || browse.status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.foregroundMuted} />
      </View>
    );
  }
  if (status.data.state === "disconnected") {
    return <ConnectScreen theme={theme} compact={layout.compact} hostLabel={props.host.label} />;
  }
  return (
    <IssuesBrowser
      {...props}
      status={status.data}
      browse={browse.status === "ready" ? browse : null}
    />
  );
}

function initialView(status: Connected, saved: BrowseValues | null): BrowseValues {
  const organization =
    status.organizations.find((candidate) => candidate.slug === saved?.organization)?.slug ??
    status.organizations[0]?.slug ??
    null;
  return {
    organization,
    projectId: saved?.organization === organization ? (saved?.projectId ?? null) : null,
    filter: saved?.filter ?? "unresolved",
    sort: saved?.sort ?? "date",
    period: saved?.period ?? "14d",
  };
}

function emptyMessage(view: BrowseValues, search: string): string {
  if (search) return `No issues match "${search}".`;
  if (view.filter !== "unresolved") return "No issues to show.";
  const period = PERIODS.find((option) => option.value === view.period)?.label ?? "";
  return `No unresolved issues in the ${period.toLowerCase()}.`;
}

function toProjectOption(project: SentryProject): PickerOption<string> {
  return { value: project.id, label: project.slug, detail: project.platform ?? undefined };
}

function IssuesBrowser({
  theme,
  layout,
  navigation,
  status,
  browse,
}: PluginSurfaceProps & { status: Connected; browse: BrowseSettings | null }) {
  const listProjects = useRpc(listProjectsRpc);
  const listIssues = useRpc(listIssuesRpc);
  const [view, setView] = useState(() => initialView(status, browse?.values ?? null));
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [detailIssue, setDetailIssue] = useState<SentryIssueSummary | null>(null);
  const [startIssue, setStartIssue] = useState<SentryIssueSummary | null>(null);
  const organization = view.organization ?? "";
  const compact = layout.compact;

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchDraft.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  const updateView = useCallback(
    (patch: Partial<BrowseValues>) => {
      setView((current) => {
        const next = { ...current, ...patch };
        // Remembering the view is best effort; a conflicting save from another client wins.
        if (browse) void browse.save(next, browse.revision);
        return next;
      });
    },
    [browse],
  );
  const changeOrganization = useCallback(
    (next: string) => updateView({ organization: next, projectId: null }),
    [updateView],
  );
  const changeProject = useCallback(
    (next: string) => updateView({ projectId: next === ALL_PROJECTS ? null : next }),
    [updateView],
  );
  const changePeriod = useCallback(
    (period: SentryIssuePeriod) => updateView({ period }),
    [updateView],
  );
  const changeSort = useCallback((sort: SentryIssueSort) => updateView({ sort }), [updateView]);
  const changeFilter = useCallback(
    (filter: SentryIssueFilter) => updateView({ filter }),
    [updateView],
  );
  const submitSearch = useCallback(() => setSearch(searchDraft.trim()), [searchDraft]);
  const clearSearch = useCallback(() => {
    setSearchDraft("");
    setSearch("");
  }, []);

  const projects = useQuery({
    queryKey: sentryKeys.projects(organization),
    queryFn: async () => (await listProjects({ organization })).projects,
    enabled: organization !== "",
    staleTime: 5 * 60_000,
  });

  const listInput = useMemo(
    () => ({
      organization,
      projectId: view.projectId,
      filter: view.filter,
      sort: view.sort,
      period: view.period,
      search,
    }),
    [organization, search, view.filter, view.period, view.projectId, view.sort],
  );
  const issues = useInfiniteQuery({
    queryKey: sentryKeys.issues(listInput),
    queryFn: ({ pageParam }) => listIssues({ ...listInput, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled: organization !== "",
  });
  const { fetchNextPage, hasNextPage, isFetchingNextPage, refetch } = issues;
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const unique: SentryIssueSummary[] = [];
    for (const issue of (issues.data?.pages ?? []).flatMap((page) => page.issues)) {
      // A new event can move an issue between pages while paging.
      if (seen.has(issue.id)) continue;
      seen.add(issue.id);
      unique.push(issue);
    }
    return unique;
  }, [issues.data]);
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);
  const reload = useCallback(() => void refetch(), [refetch]);
  // A revoked or expired token: forget it so the screen shows the connect guide again.
  const { mutate: forgetToken } = useDisconnect();
  const reconnect = useCallback(() => forgetToken(), [forgetToken]);

  const organizationOptions = useMemo<PickerOption<string>[]>(
    () =>
      status.organizations.map((org) => ({ value: org.slug, label: org.name, detail: org.slug })),
    [status.organizations],
  );
  const projectOptions = useMemo<PickerOption<string>[]>(
    () => [
      { value: ALL_PROJECTS, label: "All projects" },
      ...(projects.data ?? []).map(toProjectOption),
    ],
    [projects.data],
  );

  const closeDetail = useCallback(() => setDetailIssue(null), []);
  const closeStart = useCallback(() => setStartIssue(null), []);
  const startFromDetail = useCallback((issue: SentryIssueSummary) => {
    // Only one host modal is open at a time.
    setDetailIssue(null);
    setStartIssue(issue);
  }, []);

  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      toolbar: {
        gap: 10,
        paddingHorizontal: compact ? 12 : 20,
        paddingTop: compact ? 10 : 16,
        paddingBottom: 10,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      toolbarRow: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        gap: 8,
      },
      spacer: { flexGrow: 1 },
      search: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      searchInput: { flex: 1, color: theme.colors.foreground, fontSize: 14, paddingVertical: 8 },
      list: { flex: 1 },
      footer: { padding: 16, alignItems: "center" as const },
    }),
    [compact, theme],
  );

  const keyOf = useCallback((issue: SentryIssueSummary) => issue.id, []);
  const renderIssue = useCallback(
    ({ item }: { item: SentryIssueSummary }) => (
      <IssueRow
        theme={theme}
        compact={compact}
        issue={item}
        onOpen={setDetailIssue}
        onStart={setStartIssue}
      />
    ),
    [compact, theme],
  );

  const listEmpty = useMemo(
    () => (
      <IssuesEmpty
        theme={theme}
        pending={issues.isPending}
        error={issues.error}
        message={emptyMessage(view, search)}
        onRetry={reload}
        onReconnect={status.source === "saved" ? reconnect : null}
      />
    ),
    [issues.error, issues.isPending, reconnect, reload, search, status.source, theme, view],
  );
  const listFooter = useMemo(
    () =>
      hasNextPage ? (
        <View style={styles.footer}>
          <Button theme={theme} label="Load more" pending={isFetchingNextPage} onPress={loadMore} />
        </View>
      ) : null,
    [hasNextPage, isFetchingNextPage, loadMore, styles.footer, theme],
  );

  return (
    <View style={styles.screen}>
      <View style={styles.toolbar}>
        <View style={styles.toolbarRow}>
          {organizationOptions.length > 1 ? (
            <OptionPicker
              theme={theme}
              title="Organization"
              icon="Building2"
              value={view.organization}
              placeholder="Organization"
              options={organizationOptions}
              onChange={changeOrganization}
            />
          ) : null}
          <OptionPicker
            theme={theme}
            title="Project"
            icon="FolderGit2"
            value={view.projectId ?? ALL_PROJECTS}
            placeholder="All projects"
            options={projectOptions}
            onChange={changeProject}
          />
          <OptionPicker
            theme={theme}
            title="Time range"
            icon="Calendar"
            value={view.period}
            placeholder="Time range"
            options={PERIODS}
            onChange={changePeriod}
          />
          <OptionPicker
            theme={theme}
            title="Sort by"
            icon="ArrowDownWideNarrow"
            value={view.sort}
            placeholder="Sort"
            options={SORTS}
            onChange={changeSort}
          />
          <View style={styles.spacer} />
          <Button
            theme={theme}
            variant="ghost"
            icon="RefreshCw"
            label={compact ? "" : "Refresh"}
            accessibilityLabel="Refresh issues"
            pending={issues.isRefetching && !isFetchingNextPage}
            onPress={reload}
          />
          <ConnectionControl theme={theme} compact={compact} status={status} />
        </View>
        <ChoiceChips theme={theme} options={FILTERS} value={view.filter} onChange={changeFilter} />
        <View style={styles.search}>
          <Icon name="Search" size={14} color={theme.colors.foregroundMuted} />
          <TextInput
            value={searchDraft}
            onChangeText={setSearchDraft}
            onSubmitEditing={submitSearch}
            placeholder="Search issues, or paste a short ID like WEB-3K"
            placeholderTextColor={theme.colors.foregroundMuted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={styles.searchInput}
          />
          {searchDraft ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={clearSearch}
            >
              <Icon name="X" size={14} color={theme.colors.foregroundMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <FlatList
        style={styles.list}
        data={rows}
        keyExtractor={keyOf}
        renderItem={renderIssue}
        onEndReachedThreshold={0.5}
        onEndReached={loadMore}
        ListEmptyComponent={listEmpty}
        ListFooterComponent={listFooter}
      />
      <IssueDetail
        theme={theme}
        compact={compact}
        organization={organization}
        issue={detailIssue}
        onClose={closeDetail}
        onStart={startFromDetail}
      />
      <StartDialog
        theme={theme}
        organization={organization}
        issue={startIssue}
        navigation={navigation}
        onClose={closeStart}
      />
    </View>
  );
}

function IssuesEmpty({
  theme,
  pending,
  error,
  message,
  onRetry,
  onReconnect,
}: {
  theme: PluginTheme;
  pending: boolean;
  error: Error | null;
  message: string;
  onRetry(): void;
  onReconnect: (() => void) | null;
}) {
  const styles = useMemo(
    () => ({
      empty: { alignItems: "center" as const, gap: 8, padding: 32 },
      message: {
        color: theme.colors.foregroundMuted,
        fontSize: 14,
        textAlign: "center" as const,
      },
      error: { color: theme.colors.statusDanger, fontSize: 14, textAlign: "center" as const },
    }),
    [theme],
  );
  if (pending) {
    return (
      <View style={styles.empty}>
        <ActivityIndicator color={theme.colors.foregroundMuted} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.empty}>
        <Text style={styles.error}>{describeError(error)}</Text>
        {onReconnect && describeError(error).startsWith(SENTRY_TOKEN_REJECTED) ? (
          <Button
            theme={theme}
            variant="primary"
            icon="KeyRound"
            label="Connect a new token"
            onPress={onReconnect}
          />
        ) : (
          <Button theme={theme} icon="RefreshCw" label="Try again" onPress={onRetry} />
        )}
      </View>
    );
  }
  return (
    <View style={styles.empty}>
      <Icon name="PartyPopper" size={24} color={theme.colors.foregroundMuted} />
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

/** Disconnect for a saved token; a label for a daemon environment token, which the app cannot remove. */
function ConnectionControl({
  theme,
  compact,
  status,
}: {
  theme: PluginTheme;
  compact: boolean;
  status: Connected;
}) {
  const [confirming, setConfirming] = useState(false);
  const mutation = useDisconnect();
  const { mutate } = mutation;

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), DISCONNECT_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirming]);

  const press = useCallback(() => {
    if (confirming) mutate();
    else setConfirming(true);
  }, [confirming, mutate]);
  const source = useMemo(() => ({ color: theme.colors.foregroundMuted, fontSize: 12 }), [theme]);

  if (status.source === "environment") return <Text style={source}>SENTRY_AUTH_TOKEN</Text>;
  let label = compact ? "" : "Disconnect";
  if (confirming) label = "Confirm disconnect";
  return (
    <Button
      theme={theme}
      variant="ghost"
      icon="Unplug"
      label={label}
      accessibilityLabel="Disconnect Sentry"
      pending={mutation.isPending}
      onPress={press}
    />
  );
}

function IssueRow({
  theme,
  compact,
  issue,
  onOpen,
  onStart,
}: {
  theme: PluginTheme;
  compact: boolean;
  issue: SentryIssueSummary;
  onOpen(issue: SentryIssueSummary): void;
  onStart(issue: SentryIssueSummary): void;
}) {
  const styles = useMemo(
    () => ({
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 12,
        paddingHorizontal: compact ? 12 : 20,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      level: {
        width: 3,
        alignSelf: "stretch" as const,
        borderRadius: 2,
        backgroundColor: levelColor(issue.level, theme),
      },
      body: { flex: 1, gap: 3 },
      titleLine: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      title: {
        flexShrink: 1,
        color: theme.colors.foreground,
        fontSize: 14,
        fontWeight: "600" as const,
      },
      culprit: { color: theme.colors.foregroundMuted, fontSize: 13 },
      meta: { color: theme.colors.foregroundMuted, fontSize: 12 },
    }),
    [compact, issue.level, theme],
  );
  const open = useCallback(() => onOpen(issue), [issue, onOpen]);
  const start = useCallback(() => onStart(issue), [issue, onStart]);
  const meta = [
    issue.shortId,
    ...(compact ? [] : [issue.project.slug]),
    `${formatCount(issue.count)} events`,
    `${formatCount(issue.userCount)} users`,
    formatAge(issue.lastSeen),
  ].join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${issue.shortId}: ${issue.title}`}
      onPress={open}
      style={styles.row}
    >
      <View style={styles.level} />
      <View style={styles.body}>
        <View style={styles.titleLine}>
          {issue.isUnhandled ? (
            <Icon name="TriangleAlert" size={13} color={theme.colors.statusWarning} />
          ) : null}
          <Text numberOfLines={1} style={styles.title}>
            {issue.title}
          </Text>
        </View>
        {issue.culprit ? (
          <Text numberOfLines={1} style={styles.culprit}>
            {issue.culprit}
          </Text>
        ) : null}
        <Text numberOfLines={1} style={styles.meta}>
          {meta}
        </Text>
      </View>
      <Button
        theme={theme}
        icon="Bot"
        label={compact ? "Start" : "Start agent"}
        accessibilityLabel={`Start agent on ${issue.shortId}`}
        onPress={start}
      />
    </Pressable>
  );
}
