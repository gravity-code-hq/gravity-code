import type { TFunction } from "i18next";
import { RADAR_LOOK_BACK_MS } from "@gravity/protocol/radar/types";
import {
  History,
  MoreVertical,
  Pause,
  Pencil,
  Play,
  Rewind,
  RotateCw,
  Trash2,
} from "lucide-react-native";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { RadarHistoryTarget } from "@/components/radar/check-history-sheet";
import { RadarTaskRow } from "@/components/radar/task-row";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/ui/status-badge";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import type { AggregatedRadar } from "@/radar/aggregated";
import {
  RADAR_TASK_PREVIEW_COUNT,
  formatRadarChannel,
  radarStatusBadge,
  resolveRadarNextCheck,
  selectRadarTasks,
  type RadarNextCheck,
} from "@/radar/presentation";
import { useRadarMutations } from "@/radar/use-mutations";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import { formatTimeAgo } from "@/utils/time";

const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedRewind = withUnistyles(Rewind);
const ThemedHistory = withUnistyles(History);
const ThemedPause = withUnistyles(Pause);
const ThemedPlay = withUnistyles(Play);
const ThemedPencil = withUnistyles(Pencil);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedKebab = withUnistyles(MoreVertical);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });

const MENU_ICON_SIZE = 14;

const checkNowLeading = <ThemedRotateCw size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const lookBackLeading = <ThemedRewind size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const historyLeading = <ThemedHistory size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const pauseLeading = <ThemedPause size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const resumeLeading = <ThemedPlay size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const editLeading = <ThemedPencil size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const deleteLeading = <ThemedTrash2 size={MENU_ICON_SIZE} uniProps={destructiveColorMapping} />;

type RadarAction = "checkNow" | "lookBack" | "pause" | "resume" | "delete";

const ACTION_ERROR_KEYS: Record<RadarAction, string> = {
  checkNow: "radar.errors.checkNow",
  lookBack: "radar.errors.lookBack",
  pause: "radar.errors.pause",
  resume: "radar.errors.resume",
  delete: "radar.errors.delete",
};

interface RadarCardProps {
  radar: AggregatedRadar;
  /** Client-derived project name for the radar's cwd, or the shortened path. */
  projectName: string;
  /** Shared clock for the relative times, so every card ages together. */
  now: number;
  onEdit: (radar: AggregatedRadar) => void;
  onOpenHistory: (target: RadarHistoryTarget) => void;
}

/**
 * One radar and what it has done: a header row that opens the editor and owns
 * the radar's actions, then its newest tasks. The card owns its host-scoped
 * mutations and their pending and failure UI.
 */
export function RadarCard({
  radar,
  projectName,
  now,
  onEdit,
  onOpenHistory,
}: RadarCardProps): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const mutations = useRadarMutations(radar.serverId);
  const [pendingAction, setPendingAction] = useState<RadarAction | null>(null);
  const [showAllTasks, setShowAllTasks] = useState(false);
  const { id } = radar;
  const channel = formatRadarChannel(radar.channel);

  const runAction = useCallback(
    async (action: RadarAction, run: () => Promise<void>): Promise<boolean> => {
      setPendingAction(action);
      try {
        await run();
        return true;
      } catch (error) {
        toast.error(`${t(ACTION_ERROR_KEYS[action], { channel })}: ${toErrorMessage(error)}`);
        return false;
      } finally {
        setPendingAction(null);
      }
    },
    [channel, t, toast],
  );

  const handleEdit = useCallback(() => onEdit(radar), [onEdit, radar]);

  const handleCheckNow = useCallback(() => {
    void (async () => {
      const queued = await runAction("checkNow", () => mutations.checkRadarNow({ radarId: id }));
      if (queued) {
        toast.show(t("radar.menu.checkStarted", { channel }));
      }
    })();
  }, [channel, id, mutations, runAction, t, toast]);

  // Rewinding the cursor can put agents on messages from before the radar
  // existed, so the user confirms first.
  const handleLookBack = useCallback(() => {
    void (async () => {
      const confirmed = await confirmDialog({
        title: t("radar.lookBack.title"),
        message: t("radar.lookBack.message", { channel }),
        confirmLabel: t("radar.lookBack.confirm"),
        cancelLabel: t("radar.form.cancel"),
      });
      if (!confirmed) {
        return;
      }
      const queued = await runAction("lookBack", () =>
        mutations.checkRadarNow({ radarId: id, lookBackMs: RADAR_LOOK_BACK_MS }),
      );
      if (queued) {
        toast.show(t("radar.menu.lookBackStarted", { channel }));
      }
    })();
  }, [channel, id, mutations, runAction, t, toast]);

  const handleOpenHistory = useCallback(
    () => onOpenHistory({ radarId: id, channel }),
    [channel, id, onOpenHistory],
  );

  const handlePause = useCallback(() => {
    void runAction("pause", () => mutations.setRadarStatus(id, "paused"));
  }, [id, mutations, runAction]);

  const handleResume = useCallback(() => {
    void runAction("resume", () => mutations.setRadarStatus(id, "active"));
  }, [id, mutations, runAction]);

  const handleDelete = useCallback(() => {
    void (async () => {
      const confirmed = await confirmDialog({
        title: t("radar.delete.title"),
        message: t("radar.delete.message", { channel }),
        confirmLabel: t("radar.delete.confirm"),
        cancelLabel: t("radar.form.cancel"),
        destructive: true,
      });
      if (confirmed) {
        await runAction("delete", () => mutations.deleteRadar(id));
      }
    })();
  }, [channel, id, mutations, runAction, t]);

  const toggleShowAllTasks = useCallback(() => setShowAllTasks((current) => !current), []);
  const preview = useMemo(
    () => selectRadarTasks(radar.tasks, { showAll: showAllTasks }),
    [radar.tasks, showAllTasks],
  );
  const canToggleTasks = radar.tasks.length > RADAR_TASK_PREVIEW_COUNT;

  return (
    <View style={settingsStyles.card} testID={`radar-card-${id}`}>
      <RadarHeaderRow
        radar={radar}
        channel={channel}
        projectName={projectName}
        now={now}
        pendingAction={pendingAction}
        onEdit={handleEdit}
        onCheckNow={handleCheckNow}
        onLookBack={handleLookBack}
        onOpenHistory={handleOpenHistory}
        onPause={handlePause}
        onResume={handleResume}
        onDelete={handleDelete}
      />
      {preview.tasks.map((task) => (
        <RadarTaskRow key={task.id} serverId={radar.serverId} task={task} />
      ))}
      {radar.tasks.length === 0 ? (
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={styles.textGroup} testID={`radar-tasks-empty-${id}`}>
            <Text style={styles.tasksEmpty}>{t("radar.task.empty")}</Text>
            <Text style={settingsStyles.rowHint}>{t("radar.task.emptyHint")}</Text>
          </View>
        </View>
      ) : null}
      {canToggleTasks ? (
        <View style={[settingsStyles.rowBorder, styles.tasksFooter]}>
          <Button
            variant="ghost"
            size="sm"
            onPress={toggleShowAllTasks}
            testID={`radar-tasks-toggle-${id}`}
          >
            {showAllTasks
              ? t("radar.task.showFewer")
              : t("radar.task.showAll", { count: radar.tasks.length })}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

interface RadarHeaderRowProps {
  radar: AggregatedRadar;
  channel: string;
  projectName: string;
  now: number;
  pendingAction: RadarAction | null;
  onEdit: () => void;
  onCheckNow: () => void;
  onLookBack: () => void;
  onOpenHistory: () => void;
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
}

function describeNextCheck(next: RadarNextCheck, t: TFunction): string | null {
  switch (next.kind) {
    case "none":
      return null;
    case "soon":
      return t("radar.row.nextCheckSoon");
    case "minutes":
      return t("radar.row.nextCheckInMinutes", { minutes: next.minutes });
  }
}

function describeChecks(radar: AggregatedRadar, now: number, t: TFunction): string {
  const lastCheck = radar.lastPollAt
    ? t("radar.row.lastCheck", {
        time: formatTimeAgo(new Date(radar.lastPollAt), new Date(now)),
      })
    : t("radar.row.neverChecked");
  const nextCheck = describeNextCheck(resolveRadarNextCheck(radar, now), t);
  return nextCheck ? `${lastCheck} · ${nextCheck}` : lastCheck;
}

/**
 * Hover lives on the outer plain View and press on the inner Pressable
 * (docs/hover.md). The kebab is always rendered, so native and compact reach
 * every action without hover and an open menu can never lose its trigger.
 */
function RadarHeaderRow({
  radar,
  channel,
  projectName,
  now,
  pendingAction,
  onEdit,
  onCheckNow,
  onLookBack,
  onOpenHistory,
  onPause,
  onResume,
  onDelete,
}: RadarHeaderRowProps): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const badge = radarStatusBadge(radar.status);

  const rowStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      settingsStyles.row,
      styles.row,
      isHovered && !isCompact && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [isHovered, isCompact],
  );

  return (
    <View
      style={styles.rowContainer}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Pressable
        style={rowStyle}
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={t("radar.row.editLabel", { channel })}
        testID={`radar-row-${radar.id}`}
      >
        <View style={styles.textGroup}>
          <Text style={settingsStyles.rowTitle} numberOfLines={1}>
            {channel}
          </Text>
          <Text style={styles.project} numberOfLines={1}>
            {projectName}
          </Text>
          <Text style={settingsStyles.rowHint} numberOfLines={1}>
            {describeChecks(radar, now, t)}
          </Text>
          {radar.lastPollError ? (
            <Text style={settingsStyles.rowError} testID={`radar-poll-error-${radar.id}`}>
              {radar.lastPollError}
            </Text>
          ) : null}
        </View>
        <View style={styles.trailing}>
          {/* The kebab holds this too; compact has no room for a second label. */}
          {isCompact ? null : (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={History}
              onPress={onOpenHistory}
              testID={`radar-history-${radar.id}`}
            >
              {t("radar.menu.checkHistory")}
            </Button>
          )}
          <StatusBadge label={t(badge.labelKey)} variant={badge.variant} />
          <RadarKebabMenu
            radar={radar}
            channel={channel}
            pendingAction={pendingAction}
            onEdit={onEdit}
            onCheckNow={onCheckNow}
            onLookBack={onLookBack}
            onOpenHistory={onOpenHistory}
            onPause={onPause}
            onResume={onResume}
            onDelete={onDelete}
          />
        </View>
      </Pressable>
    </View>
  );
}

type RadarKebabMenuProps = Omit<RadarHeaderRowProps, "projectName" | "now">;

function RadarKebabMenu({
  radar,
  channel,
  pendingAction,
  onEdit,
  onCheckNow,
  onLookBack,
  onOpenHistory,
  onPause,
  onResume,
  onDelete,
}: RadarKebabMenuProps): ReactElement {
  const { t } = useTranslation();
  const isBusy = pendingAction !== null;
  // The daemon refuses to check a paused radar; Resume is the way in.
  const cannotCheck = isBusy || radar.status === "paused";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        hitSlop={8}
        style={kebabTriggerStyle}
        accessibilityRole={isNative ? "button" : undefined}
        accessibilityLabel={t("radar.menu.label", { channel })}
        testID={`radar-kebab-${radar.id}`}
      >
        {renderKebabTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={220}>
        <DropdownMenuItem
          leading={checkNowLeading}
          disabled={cannotCheck}
          status={pendingAction === "checkNow" ? "pending" : "idle"}
          pendingLabel={t("radar.menu.checking")}
          onSelect={onCheckNow}
          testID={`radar-menu-check-${radar.id}`}
        >
          {t("radar.menu.checkNow")}
        </DropdownMenuItem>
        <DropdownMenuItem
          leading={lookBackLeading}
          disabled={cannotCheck}
          status={pendingAction === "lookBack" ? "pending" : "idle"}
          pendingLabel={t("radar.menu.checking")}
          onSelect={onLookBack}
          testID={`radar-menu-look-back-${radar.id}`}
        >
          {t("radar.menu.lookBack")}
        </DropdownMenuItem>
        <DropdownMenuItem
          leading={historyLeading}
          onSelect={onOpenHistory}
          testID={`radar-menu-history-${radar.id}`}
        >
          {t("radar.menu.checkHistory")}
        </DropdownMenuItem>
        {radar.status === "paused" ? (
          <DropdownMenuItem
            leading={resumeLeading}
            disabled={isBusy}
            status={pendingAction === "resume" ? "pending" : "idle"}
            pendingLabel={t("radar.menu.resuming")}
            onSelect={onResume}
            testID={`radar-menu-resume-${radar.id}`}
          >
            {t("radar.menu.resume")}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            leading={pauseLeading}
            disabled={isBusy}
            status={pendingAction === "pause" ? "pending" : "idle"}
            pendingLabel={t("radar.menu.pausing")}
            onSelect={onPause}
            testID={`radar-menu-pause-${radar.id}`}
          >
            {t("radar.menu.pause")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          leading={editLeading}
          onSelect={onEdit}
          testID={`radar-menu-edit-${radar.id}`}
        >
          {t("radar.menu.edit")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          leading={deleteLeading}
          destructive
          disabled={isBusy}
          status={pendingAction === "delete" ? "pending" : "idle"}
          pendingLabel={t("radar.menu.deleting")}
          onSelect={onDelete}
          testID={`radar-menu-delete-${radar.id}`}
        >
          {t("radar.menu.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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

function kebabTriggerStyle({
  hovered = false,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.kebabTrigger, hovered && styles.kebabTriggerHovered];
}

const styles = StyleSheet.create((theme) => ({
  rowContainer: {
    position: "relative",
  },
  row: {
    gap: theme.spacing[3],
  },
  rowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface3,
  },
  textGroup: {
    flex: 1,
    minWidth: 0,
  },
  project: {
    marginTop: theme.spacing[1],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  kebabTrigger: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
  },
  kebabTriggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
  tasksEmpty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  tasksFooter: {
    alignItems: "center",
    paddingVertical: theme.spacing[2],
  },
}));
