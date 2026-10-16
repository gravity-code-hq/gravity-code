import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { router } from "expo-router";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink as ExternalLinkIcon,
  MoreVertical,
  RotateCw,
  Unplug,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import type {
  LinearIssue,
  LinearIssueDetail,
  LinearIssueListFilter,
  LinearTeam,
} from "@gravity/protocol/linear/types";
import { MenuHeader } from "@/components/headers/menu-header";
import { LinearIcon } from "@/components/icons/linear-icon";
import { LinearConnectCard } from "@/components/linear/connect-card";
import { LinearStartAgentSheet } from "@/components/linear/start-agent-sheet";
import { LinearIssueDetailSheet } from "@/components/linear/issue-detail-sheet";
import { LinearIssueRow } from "@/components/linear/issue-row";
import {
  useLinearStartProjects,
  type LinearStartChoice,
} from "@/components/linear/start-agent-menu";
import { LinearTeamFilter } from "@/components/linear/team-filter";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { isNative } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { describeLinearError } from "@/linear/error-copy";
import { buildLinearIssuePrompt, buildLinearIssueWorkspaceName } from "@/linear/issue-prompt";
import { useLinearQuickStart } from "@/linear/use-quick-start";
import { getHostProjectId, getHostProjectSourceDirectory } from "@/projects/host-project-model";
import {
  LINEAR_ISSUES_PAGE_SIZE,
  linearQueryBaseKey,
  useLinearIssueFetcher,
  useLinearIssues,
  useLinearStatus,
  useLinearTeams,
  type LinearIssueListQuery,
  type LinearStatusView,
} from "@/linear/use-linear";
import { useHosts } from "@/runtime/host-runtime";
import { useHostFeature } from "@/runtime/host-features";
import type { HostProjectListItem } from "@/projects/host-project-model";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { NEW_WORKSPACE_DRAFT_KEY } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import type { Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";
import { buildNewWorkspaceRoute } from "@/utils/host-routes";
import { openExternalUrl } from "@/utils/open-external-url";

const ThemedChevronLeft = withUnistyles(ChevronLeft);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedKebab = withUnistyles(MoreVertical);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedExternalLink = withUnistyles(ExternalLinkIcon);
const ThemedUnplug = withUnistyles(Unplug);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });

const MENU_ICON_SIZE = 14;
const SEARCH_DEBOUNCE_MS = 300;
const EMPTY_ISSUES: LinearIssue[] = [];
const EMPTY_TEAMS: LinearTeam[] = [];

export function LinearScreen(): ReactElement {
  const isFocused = useIsFocused();
  if (!isFocused) {
    return <View style={styles.container} />;
  }
  return <LinearScreenContent />;
}

/**
 * Linear is per host (the API key lives on the daemon), so the screen pins one
 * host: the host the sidebar is pinned to, otherwise the active workspace's
 * host, otherwise the first one. Switching happens in the sidebar footer.
 */
function useSelectedLinearHost(): string | null {
  const hosts = useHosts();
  const hostFilters = useSidebarViewStore((state) => state.hostFilters);
  const activeSelection = useActiveWorkspaceSelection();
  const pinnedHost = hostFilters.length === 1 ? hostFilters[0] : null;
  if (pinnedHost && hosts.some((host) => host.serverId === pinnedHost)) return pinnedHost;
  return activeSelection?.serverId ?? hosts[0]?.serverId ?? null;
}

function LinearScreenContent(): ReactElement {
  const { t } = useTranslation();
  const selectedHost = useSelectedLinearHost();

  return (
    <View style={styles.container}>
      {selectedHost ? (
        <LinearHostScreen key={selectedHost} serverId={selectedHost} />
      ) : (
        <>
          <MenuHeader title={t("linear.title")} />
          <View style={styles.centered}>
            <Text style={styles.message}>{t("linear.states.noHosts")}</Text>
          </View>
        </>
      )}
    </View>
  );
}

function LinearHostScreen({ serverId }: { serverId: string }): ReactElement {
  const { t } = useTranslation();
  const { view, connect, disconnect, refetch } = useLinearStatus(serverId);
  const queryClient = useQueryClient();
  const connectedStatus =
    view.kind === "ready" && view.status.kind === "connected" ? view.status : null;
  const handleRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [...linearQueryBaseKey, serverId] });
  }, [queryClient, serverId]);
  const hosts = useHosts();
  const hostName = hosts.find((host) => host.serverId === serverId)?.label ?? serverId;

  const handleConnect = useCallback((apiKey: string) => connect.mutate(apiKey), [connect]);
  const handleDisconnect = useCallback(() => {
    void (async () => {
      const confirmed = await confirmDialog({
        title: t("linear.menu.disconnectTitle"),
        message: t("linear.menu.disconnectMessage", { host: hostName }),
        confirmLabel: t("linear.menu.disconnectConfirm"),
        destructive: true,
      });
      if (confirmed) disconnect.mutate();
    })();
  }, [disconnect, hostName, t]);

  const connectError = connect.isError ? describeLinearError(connect.error, t) : null;
  const handleRetryStatus = useCallback(() => void refetch(), [refetch]);
  const menu = useMemo(
    () =>
      connectedStatus ? (
        <LinearScreenMenu
          organizationUrlKey={connectedStatus.organization.urlKey}
          isDisconnecting={disconnect.isPending}
          onRefresh={handleRefresh}
          onDisconnect={handleDisconnect}
        />
      ) : undefined,
    [connectedStatus, disconnect.isPending, handleDisconnect, handleRefresh],
  );

  return (
    <>
      <MenuHeader title={t("linear.title")} rightContent={menu} />
      <LinearHostBody
        serverId={serverId}
        view={view}
        onConnect={handleConnect}
        isConnecting={connect.isPending}
        connectError={connectError}
        onRetryStatus={handleRetryStatus}
      />
    </>
  );
}

function LinearHostBody({
  serverId,
  view,
  onConnect,
  isConnecting,
  connectError,
  onRetryStatus,
}: {
  serverId: string;
  view: LinearStatusView;
  onConnect: (apiKey: string) => void;
  isConnecting: boolean;
  connectError: string | null;
  onRetryStatus: () => void;
}): ReactElement {
  const { t } = useTranslation();

  if (view.kind === "ready" && view.status.kind === "connected") {
    return <LinearIssuesBody serverId={serverId} />;
  }

  let content: ReactElement;
  switch (view.kind) {
    case "loading":
      content = <LoadingSpinner size="large" color={styles.spinner.color} />;
      break;
    case "offline":
      content = <Text style={styles.message}>{t("linear.states.hostOffline")}</Text>;
      break;
    case "unsupported":
      content = <Text style={styles.message}>{t("linear.states.hostUnsupported")}</Text>;
      break;
    case "error":
      content = (
        <>
          <Text style={styles.message}>{describeLinearError(view.error, t)}</Text>
          <Button variant="ghost" onPress={onRetryStatus} testID="linear-status-retry">
            {t("linear.states.retry")}
          </Button>
        </>
      );
      break;
    case "ready":
      content = (
        <LinearConnectCard onConnect={onConnect} isConnecting={isConnecting} error={connectError} />
      );
      break;
  }

  return (
    <View style={styles.body}>
      <View style={styles.centered}>{content}</View>
    </View>
  );
}

const FILTER_OPTIONS: { value: LinearIssueListFilter; labelKey: string; testID: string }[] = [
  { value: "assigned", labelKey: "linear.filters.assigned", testID: "linear-filter-assigned" },
  { value: "created", labelKey: "linear.filters.created", testID: "linear-filter-created" },
  { value: "all", labelKey: "linear.filters.all", testID: "linear-filter-all" },
  { value: "completed", labelKey: "linear.filters.completed", testID: "linear-filter-completed" },
];

function LinearIssuesBody({ serverId }: { serverId: string }): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const [filter, setFilter] = useState<LinearIssueListFilter>("assigned");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), SEARCH_DEBOUNCE_MS);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);

  const teamsQuery = useLinearTeams(serverId, true);
  const teams = teamsQuery.data ?? EMPTY_TEAMS;
  useEffect(() => {
    if (teamId && teamsQuery.data && !teamsQuery.data.some((team) => team.id === teamId)) {
      setTeamId(null);
    }
  }, [teamId, teamsQuery.data]);

  const listQuery = useMemo<LinearIssueListQuery>(
    () => ({ filter, teamId, search }),
    [filter, search, teamId],
  );

  const filterOptions = useMemo(
    () =>
      FILTER_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.labelKey),
        testID: option.testID,
      })),
    [t],
  );

  const openIssue = useCallback((issue: LinearIssue) => setSelectedIssueId(issue.id), []);
  const closeIssue = useCallback(() => setSelectedIssueId(null), []);
  const handleOpenExternal = useCallback((issue: LinearIssue) => {
    void openExternalUrl(issue.url);
  }, []);

  const projects = useLinearStartProjects(serverId);
  const quickStart = useLinearQuickStart(serverId);
  const handOffToComposer = useCallback(
    (issue: LinearIssueDetail, choice: LinearStartChoice) => {
      useDraftStore.getState().saveDraftInput({
        draftKey: NEW_WORKSPACE_DRAFT_KEY,
        draft: { text: buildLinearIssuePrompt(issue), attachments: [] },
      });
      const project = choice.project;
      router.push(
        buildNewWorkspaceRoute({
          serverId,
          displayName: buildLinearIssueWorkspaceName(issue),
          projectId: project ? (getHostProjectId(project, serverId) ?? undefined) : undefined,
          sourceDirectory: project
            ? (getHostProjectSourceDirectory(project, serverId) ?? undefined)
            : undefined,
        }),
      );
    },
    [serverId],
  );
  const startAgent = useCallback(
    async (issue: LinearIssueDetail, choice: LinearStartChoice) => {
      setSelectedIssueId(null);
      if (!choice.project || !quickStart.target.ready) {
        handOffToComposer(issue, choice);
        return;
      }
      await quickStart.start(issue, choice.project);
    },
    [handOffToComposer, quickStart],
  );

  // The row only has the list shape; the prompt wants sub-issues and comments,
  // so fetch the detail (through the drawer's cache entry) first.
  const fetchIssue = useLinearIssueFetcher(serverId);
  const [startingIssueId, setStartingIssueId] = useState<string | null>(null);
  const handleStartAgentFromRow = useCallback(
    (issue: LinearIssue, choice: LinearStartChoice) => {
      setStartingIssueId(issue.id);
      void (async () => {
        try {
          await startAgent(await fetchIssue(issue.id), choice);
        } catch (error) {
          toast.error(`${t("linear.issue.startFailed")}: ${describeLinearError(error, t)}`);
        } finally {
          setStartingIssueId((current) => (current === issue.id ? null : current));
        }
      })();
    },
    [fetchIssue, startAgent, t, toast],
  );
  const [setupIssue, setSetupIssue] = useState<LinearIssueDetail | null>(null);
  const closeSetup = useCallback(() => setSetupIssue(null), []);
  const handleStartAgentFromSheet = useCallback((issue: LinearIssueDetail) => {
    setSelectedIssueId(null);
    setSetupIssue(issue);
  }, []);
  const handleConfigureAgent = useCallback(
    (issue: LinearIssue) => {
      setStartingIssueId(issue.id);
      void fetchIssue(issue.id)
        .then(handleStartAgentFromSheet)
        .catch((error: unknown) => {
          toast.error(`${t("linear.issue.startFailed")}: ${describeLinearError(error, t)}`);
        })
        .finally(() => setStartingIssueId(null));
    },
    [fetchIssue, handleStartAgentFromSheet, t, toast],
  );

  return (
    <View style={styles.body}>
      <View style={styles.filterRow}>
        <View style={styles.filterRowControls}>
          <SegmentedControl
            size="sm"
            value={filter}
            onValueChange={setFilter}
            options={filterOptions}
            testID="linear-status-filter"
          />
          {teams.length > 1 ? (
            <LinearTeamFilter teams={teams} selectedTeamId={teamId} onSelectTeam={setTeamId} />
          ) : null}
        </View>
        <View style={styles.search}>
          <SearchField
            value={searchInput}
            onChangeText={setSearchInput}
            placeholder={t("linear.filters.searchPlaceholder")}
            clearAccessibilityLabel={t("linear.filters.clearSearch")}
            testID="linear-search"
          />
        </View>
      </View>
      <LinearIssuePages
        key={JSON.stringify(listQuery)}
        serverId={serverId}
        query={listQuery}
        projects={projects}
        startingIssueId={startingIssueId}
        onOpenIssue={openIssue}
        onStartAgent={handleStartAgentFromRow}
        onConfigureAgent={handleConfigureAgent}
        onOpenExternal={handleOpenExternal}
      />
      {setupIssue ? (
        <LinearStartAgentSheet
          key={setupIssue.id}
          serverId={serverId}
          issue={setupIssue}
          onClose={closeSetup}
        />
      ) : null}
      <LinearIssueDetailSheet
        serverId={serverId}
        issueId={selectedIssueId}
        onClose={closeIssue}
        onStartAgent={handleStartAgentFromSheet}
      />
    </View>
  );
}

interface LinearIssuePagesProps {
  serverId: string;
  query: LinearIssueListQuery;
  projects: HostProjectListItem[];
  startingIssueId: string | null;
  onOpenIssue: (issue: LinearIssue) => void;
  onConfigureAgent: (issue: LinearIssue) => void;
  onStartAgent: (issue: LinearIssue, choice: LinearStartChoice) => void;
  onOpenExternal: (issue: LinearIssue) => void;
}

function LinearIssuePages({
  serverId,
  query,
  projects,
  startingIssueId,
  onOpenIssue,
  onStartAgent,
  onConfigureAgent,
  onOpenExternal,
}: LinearIssuePagesProps): ReactElement {
  const { t } = useTranslation();
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const after = cursors[cursors.length - 1];
  const issuesQuery = useLinearIssues(serverId, query, after);
  const issues = issuesQuery.data?.issues ?? EMPTY_ISSUES;
  const supportsPagination = useHostFeature(serverId, "linearIssuePagination");
  const nextCursor = issuesQuery.data?.endCursor;
  const canGoNext = supportsPagination && issuesQuery.data?.hasMore && nextCursor;
  const needsUpdate = !supportsPagination && issuesQuery.data?.hasMore;
  const handleRefresh = useCallback(() => void issuesQuery.refetch(), [issuesQuery]);
  const handlePrevious = useCallback(() => setCursors((current) => current.slice(0, -1)), []);
  const handleNext = useCallback(() => {
    if (nextCursor) setCursors((current) => [...current, nextCursor]);
  }, [nextCursor]);

  const pageOffset = (cursors.length - 1) * LINEAR_ISSUES_PAGE_SIZE;
  let rangeLabel = "—";
  if (issuesQuery.isSuccess) {
    rangeLabel =
      issues.length === 0
        ? t("linear.states.empty")
        : t("linear.pagination.range", { start: pageOffset + 1, end: pageOffset + issues.length });
  }

  let listContent: ReactElement;
  if (issuesQuery.isError) {
    listContent = (
      <View style={styles.filterEmpty}>
        <Text style={styles.message}>{t("linear.states.loadError")}</Text>
        <Text style={styles.message}>{describeLinearError(issuesQuery.error, t)}</Text>
        <Button
          variant="ghost"
          loading={issuesQuery.isFetching}
          disabled={issuesQuery.isFetching}
          onPress={handleRefresh}
          testID="linear-issues-retry"
        >
          {t("linear.states.retry")}
        </Button>
      </View>
    );
  } else if (!issuesQuery.data) {
    listContent = (
      <View style={styles.filterEmpty}>
        <LoadingSpinner size="large" color={styles.spinner.color} />
      </View>
    );
  } else if (issues.length === 0) {
    listContent = (
      <View style={styles.filterEmpty}>
        <LinearIcon size={styles.emptyIcon.width} color={styles.emptyIcon.color} />
        <Text style={styles.message}>
          {query.search ? t("linear.states.searchEmpty") : t("linear.states.empty")}
        </Text>
      </View>
    );
  } else {
    listContent = (
      <View style={styles.listContent} testID="linear-issues-list">
        <View style={styles.list}>
          {issues.map((issue, index) => (
            <LinearIssueRow
              key={issue.id}
              issue={issue}
              projects={projects}
              isFirst={index === 0}
              isStartingAgent={startingIssueId === issue.id}
              onPress={onOpenIssue}
              onStartAgent={onStartAgent}
              onConfigureAgent={onConfigureAgent}
              onOpenExternal={onOpenExternal}
            />
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.scroll}>
      <ScrollView
        key={after ?? "first"}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {listContent}
      </ScrollView>
      <View style={styles.pagination} testID="linear-pagination">
        {needsUpdate ? (
          <Text style={styles.message}>{t("linear.pagination.updateHost")}</Text>
        ) : null}
        <View style={styles.paginationRow}>
          <Text
            style={styles.rangeLabel}
            testID="linear-page-range"
            accessibilityLiveRegion="polite"
          >
            {rangeLabel}
          </Text>
          <View style={styles.paginationControls}>
            <Text style={styles.pageLabel} testID="linear-page-number">
              {t("linear.pagination.page", { page: cursors.length })}
            </Text>
            <Button
              variant="outline"
              size="sm"
              leftIcon={previousPageIcon}
              disabled={cursors.length === 1 || issuesQuery.isFetching}
              onPress={handlePrevious}
              testID="linear-page-previous"
            >
              {t("linear.pagination.previous")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              trailing={nextPageIcon}
              disabled={!canGoNext || issuesQuery.isFetching || issuesQuery.isError}
              onPress={handleNext}
              testID="linear-page-next"
            >
              {t("linear.pagination.next")}
            </Button>
          </View>
        </View>
      </View>
    </View>
  );
}

function renderKebabTriggerIcon({ hovered }: { hovered?: boolean }): ReactElement {
  return (
    <ThemedKebab
      size={MENU_ICON_SIZE}
      uniProps={hovered ? foregroundColorMapping : mutedColorMapping}
    />
  );
}

const previousPageIcon = <ThemedChevronLeft size={14} uniProps={foregroundColorMapping} />;
const nextPageIcon = <ThemedChevronRight size={14} uniProps={foregroundColorMapping} />;

const refreshLeading = <ThemedRotateCw size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const openLeading = <ThemedExternalLink size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const disconnectLeading = <ThemedUnplug size={MENU_ICON_SIZE} uniProps={destructiveColorMapping} />;

function LinearScreenMenu({
  organizationUrlKey,
  isDisconnecting,
  onRefresh,
  onDisconnect,
}: {
  organizationUrlKey: string;
  isDisconnecting: boolean;
  onRefresh: () => void;
  onDisconnect: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const handleOpenLinear = useCallback(() => {
    void openExternalUrl(`https://linear.app/${organizationUrlKey}`);
  }, [organizationUrlKey]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        hitSlop={8}
        style={styles.kebabTrigger}
        accessibilityRole={isNative ? "button" : undefined}
        accessibilityLabel={t("linear.menu.actions")}
        testID="linear-menu-trigger"
      >
        {renderKebabTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={220}>
        <DropdownMenuItem
          leading={refreshLeading}
          onSelect={onRefresh}
          testID="linear-menu-refresh"
        >
          {t("linear.menu.refresh")}
        </DropdownMenuItem>
        <DropdownMenuItem
          leading={openLeading}
          onSelect={handleOpenLinear}
          testID="linear-menu-open"
        >
          {t("linear.menu.openLinear")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          leading={disconnectLeading}
          destructive
          status={isDisconnecting ? "pending" : "idle"}
          pendingLabel={t("linear.menu.disconnecting")}
          onSelect={onDisconnect}
          testID="linear-menu-disconnect"
        >
          {t("linear.menu.disconnect")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
    gap: theme.spacing[4],
    padding: theme.spacing[6],
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    flexWrap: "wrap",
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
  search: {
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
  // Rows carry their own 16px horizontal padding for the hover highlight, so
  // the list inset is the toolbar inset minus that: row ink lands on the same
  // rail as the toolbar controls.
  listContent: {
    paddingHorizontal: { xs: 0, md: theme.spacing[2] },
    gap: theme.spacing[3],
  },
  list: {
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  filterEmpty: {
    flexGrow: 1,
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingVertical: theme.spacing[6],
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  pagination: {
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingVertical: theme.spacing[3],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    gap: theme.spacing[2],
  },
  paginationRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  paginationControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginLeft: "auto",
  },
  rangeLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  pageLabel: {
    display: { xs: "none", md: "flex" },
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
    marginRight: theme.spacing[2],
  },
  spinner: {
    color: theme.colors.foregroundMuted,
  },
  emptyIcon: {
    color: theme.colors.foregroundMuted,
    width: theme.iconSize.lg,
  },
  kebabTrigger: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
  },
}));
