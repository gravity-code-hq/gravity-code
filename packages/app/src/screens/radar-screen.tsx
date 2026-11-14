import { useCallback, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { Plus, Radar } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { MenuHeader } from "@/components/headers/menu-header";
import { RadarCard } from "@/components/radar/card";
import {
  RadarCheckHistorySheet,
  type RadarHistoryTarget,
} from "@/components/radar/check-history-sheet";
import { RadarFormSheet } from "@/components/radar/form-sheet";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useProjects } from "@/hooks/use-projects";
import type { AggregatedRadar, RadarHostError } from "@/radar/aggregated";
import { sortRadarsNewestFirst } from "@/radar/presentation";
import { resolveRadarScreenBodyState, type RadarScreenBodyState } from "@/radar/screen-state";
import { useRadarClock } from "@/radar/use-clock";
import { useRadars } from "@/radar/use-radars";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeConnectionStatus, useHosts } from "@/runtime/host-runtime";
import {
  buildProjectNameByCwd,
  buildScheduleProjectTargets,
  describeScheduleCwd,
} from "@/schedules/schedule-project-targets";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";

type FormState = { mode: "closed" } | { mode: "create" } | { mode: "edit"; radar: AggregatedRadar };

const EMPTY_RADARS: AggregatedRadar[] = [];

export function RadarScreen(): ReactElement {
  const isFocused = useIsFocused();

  // Unmounting the content while another route is in front is what stops the
  // list's polling; it resumes with a fresh fetch when the screen is focused.
  if (!isFocused) {
    return <View style={styles.container} />;
  }

  return <RadarScreenContent />;
}

/**
 * Radars are per host (each daemon watches Slack through its own Claude Code),
 * so the screen pins one, the same way Automations and Tasks do: the host the
 * sidebar footer is pinned to, otherwise the active workspace's host, otherwise
 * the first one. Switching happens in the sidebar footer.
 */
function useSelectedRadarHost(): string | null {
  const hosts = useHosts();
  const hostFilters = useSidebarViewStore((state) => state.hostFilters);
  const activeSelection = useActiveWorkspaceSelection();
  const pinnedHost = hostFilters.length === 1 ? hostFilters[0] : null;
  if (pinnedHost && hosts.some((host) => host.serverId === pinnedHost)) return pinnedHost;
  return activeSelection?.serverId ?? hosts[0]?.serverId ?? null;
}

function RadarScreenContent(): ReactElement {
  const { t } = useTranslation();
  const selectedHost = useSelectedRadarHost();

  if (!selectedHost) {
    return (
      <View style={styles.container}>
        <MenuHeader title={t("radar.title")} />
        <View style={styles.centered}>
          <Text style={styles.message}>{t("radar.states.noHosts")}</Text>
        </View>
      </View>
    );
  }

  return <RadarHostScreen key={selectedHost} serverId={selectedHost} />;
}

function RadarHostScreen({ serverId }: { serverId: string }): ReactElement {
  const { t } = useTranslation();
  const connectionStatus = useHostRuntimeConnectionStatus(serverId);
  // The one feature gate: a host without `features.radar` is never asked for
  // radars and renders the update state instead.
  const isSupported = useHostFeature(serverId, "radar");
  const { loadState, hostErrors, error, refetch } = useRadars({
    serverId,
    enabled: connectionStatus === "online" && isSupported,
  });
  const bodyState = resolveRadarScreenBodyState({
    connectionStatus,
    isSupported,
    loadState,
    hasLoadError: error !== null,
  });
  const radars = loadState.status === "loaded" ? loadState.data : EMPTY_RADARS;

  const [form, setForm] = useState<FormState>({ mode: "closed" });
  const openCreate = useCallback(() => setForm({ mode: "create" }), []);
  const openEdit = useCallback((radar: AggregatedRadar) => setForm({ mode: "edit", radar }), []);
  const closeForm = useCallback(() => setForm({ mode: "closed" }), []);
  const [history, setHistory] = useState<RadarHistoryTarget | null>(null);
  const closeHistory = useCallback(() => setHistory(null), []);

  let formSheet: ReactElement | null = null;
  if (form.mode === "create") {
    formSheet = (
      <RadarFormSheet key="create" serverId={serverId} radar={null} onClose={closeForm} />
    );
  } else if (form.mode === "edit") {
    formSheet = (
      <RadarFormSheet
        key={`edit:${form.radar.id}`}
        serverId={serverId}
        radar={form.radar}
        onClose={closeForm}
      />
    );
  }

  return (
    <View style={styles.container}>
      <MenuHeader title={t("radar.title")} />
      <RadarScreenBody
        bodyState={bodyState}
        radars={radars}
        hostErrors={hostErrors}
        loadErrorDetail={error?.message ?? null}
        onRetry={refetch}
        onCreate={openCreate}
        onEdit={openEdit}
        onOpenHistory={setHistory}
      />
      {formSheet}
      {history ? (
        <RadarCheckHistorySheet
          key={history.radarId}
          serverId={serverId}
          radarId={history.radarId}
          channel={history.channel}
          onClose={closeHistory}
        />
      ) : null}
    </View>
  );
}

interface RadarScreenBodyProps {
  bodyState: RadarScreenBodyState;
  radars: AggregatedRadar[];
  hostErrors: RadarHostError[];
  /** The daemon's own words for a failed load, shown under the local summary. */
  loadErrorDetail: string | null;
  onRetry: () => void;
  onCreate: () => void;
  onEdit: (radar: AggregatedRadar) => void;
  onOpenHistory: (target: RadarHistoryTarget) => void;
}

function RadarScreenBody({
  bodyState,
  radars,
  hostErrors,
  loadErrorDetail,
  onRetry,
  onCreate,
  onEdit,
  onOpenHistory,
}: RadarScreenBodyProps): ReactElement {
  const { t } = useTranslation();

  switch (bodyState.kind) {
    case "loading":
      return (
        <View style={styles.centered}>
          <LoadingSpinner size="large" color={styles.spinner.color} />
        </View>
      );
    case "offline":
      return (
        <View style={styles.centered} testID="radar-host-offline">
          <Text style={styles.message}>{t("radar.states.hostOffline")}</Text>
        </View>
      );
    case "unsupported":
      return (
        <View style={styles.centered} testID="radar-host-unsupported">
          <Text style={styles.message}>{t("radar.states.hostUnsupported")}</Text>
        </View>
      );
    case "load-error":
      return (
        <View style={styles.centered} testID="radar-load-error">
          <View style={styles.emptyTextStack}>
            <Text style={styles.message}>{t("radar.states.loadError")}</Text>
            {loadErrorDetail ? <Text style={styles.message}>{loadErrorDetail}</Text> : null}
          </View>
          <Button variant="ghost" onPress={onRetry} testID="radar-retry">
            {t("radar.states.retry")}
          </Button>
        </View>
      );
    case "empty":
      return (
        <View style={styles.centered}>
          <RadarEmptyState onCreate={onCreate} />
        </View>
      );
    case "content":
      return (
        <View style={styles.body}>
          <View style={styles.toolbar}>
            <Button
              variant="outline"
              leftIcon={Plus}
              onPress={onCreate}
              size="sm"
              testID="radar-new"
            >
              {t("radar.newRadar")}
            </Button>
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            testID="radar-list"
          >
            <RadarList
              radars={radars}
              hostErrors={hostErrors}
              onEdit={onEdit}
              onOpenHistory={onOpenHistory}
            />
          </ScrollView>
        </View>
      );
  }
}

function RadarEmptyState({ onCreate }: { onCreate: () => void }): ReactElement {
  const { t } = useTranslation();
  return (
    <View style={styles.emptyState} testID="radar-empty">
      <Radar size={styles.emptyIcon.width} color={styles.emptyIcon.color} />
      <View style={styles.emptyTextStack}>
        <Text style={styles.emptyTitle}>{t("radar.states.emptyTitle")}</Text>
        <Text style={styles.emptyDescription}>{t("radar.states.emptyDescription")}</Text>
      </View>
      <Button variant="outline" leftIcon={Plus} onPress={onCreate} testID="radar-empty-new">
        {t("radar.newRadar")}
      </Button>
    </View>
  );
}

function RadarList({
  radars,
  hostErrors,
  onEdit,
  onOpenHistory,
}: Pick<RadarScreenBodyProps, "radars" | "hostErrors" | "onEdit" | "onOpenHistory">): ReactElement {
  const { t } = useTranslation();
  const { projects } = useProjects();
  const projectNameByCwd = useMemo(
    () => buildProjectNameByCwd(buildScheduleProjectTargets(projects)),
    [projects],
  );
  const sortedRadars = useMemo(() => sortRadarsNewestFirst(radars), [radars]);
  const now = useRadarClock(radars);

  return (
    <View style={styles.list}>
      {hostErrors.length > 0 ? (
        <View style={styles.errorsBanner} testID="radar-host-errors">
          {hostErrors.map((hostError) => (
            <Text key={hostError.serverId} style={styles.errorsBannerText}>
              {t("radar.states.hostLoadError", { host: hostError.serverName })}
            </Text>
          ))}
        </View>
      ) : null}
      {sortedRadars.map((radar) => (
        <RadarCard
          key={`${radar.serverId}:${radar.id}`}
          radar={radar}
          projectName={describeScheduleCwd({
            serverId: radar.serverId,
            cwd: radar.cwd,
            projectNameByCwd,
          })}
          now={now}
          onEdit={onEdit}
          onOpenHistory={onOpenHistory}
        />
      ))}
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
  toolbar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: theme.spacing[4],
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    flexGrow: 1,
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[6],
  },
  list: {
    gap: theme.spacing[3],
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
  emptyState: {
    alignItems: "center",
    gap: theme.spacing[4],
    maxWidth: 420,
    width: "100%",
  },
  emptyTextStack: {
    alignItems: "center",
    gap: theme.spacing[2],
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
  // Static color holder read by the spinner; keeps the muted token without useUnistyles.
  spinner: {
    color: theme.colors.foregroundMuted,
  },
  emptyIcon: {
    color: theme.colors.foregroundMuted,
    width: theme.iconSize.lg,
  },
}));
