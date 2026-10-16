import { ChevronRight } from "lucide-react-native";
import { useCallback, useState, type ReactElement } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { getProviderIcon } from "@/components/provider-icons";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { ScheduleRunEntry, ScheduleRunOutcomeCounts } from "@/schedules/schedule-runs";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { formatDuration, formatMessageTimestamp, formatTimeAgo } from "@/utils/time";
import type { ScheduleRun } from "@gravity/protocol/schedule/types";

const ThemedChevronRight = withUnistyles(ChevronRight);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const PROVIDER_ICON_SIZE = 16;

const RUN_STATUS_BADGE: Record<
  ScheduleRun["status"],
  { label: string; variant: StatusBadgeVariant }
> = {
  running: { label: "Running", variant: "warning" },
  succeeded: { label: "Done", variant: "success" },
  failed: { label: "Failed", variant: "error" },
};

export function ScheduleRunsSummary({
  counts,
}: {
  counts: ScheduleRunOutcomeCounts;
}): ReactElement {
  return (
    <View style={styles.summary} testID="schedule-runs-summary">
      <SummaryCard label="Successful · 24h" value={counts.succeeded24h} />
      <SummaryCard label="Failed · 24h" value={counts.failed24h} />
      <SummaryCard label="Successful · 7d" value={counts.succeeded7d} />
      <SummaryCard label="Failed · 7d" value={counts.failed7d} />
    </View>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

/**
 * Every run across the host's automations, newest first. A run that started an
 * agent opens it; a run that failed before one existed shows its error inline.
 */
export function ScheduleRunsTable({
  entries,
  providerByScheduleKey,
}: {
  entries: readonly ScheduleRunEntry[];
  providerByScheduleKey: ReadonlyMap<string, string | null>;
}): ReactElement {
  return (
    <View style={settingsStyles.card} testID="schedule-runs-table">
      {entries.map((entry, index) => (
        <ScheduleRunRow
          key={entry.key}
          entry={entry}
          provider={
            providerByScheduleKey.get(`${entry.schedule.serverId}:${entry.schedule.id}`) ?? null
          }
          isFirst={index === 0}
        />
      ))}
    </View>
  );
}

function buildRunMeta(entry: ScheduleRunEntry): string {
  const { run } = entry;
  const startedAt = new Date(run.startedAt);
  const parts = [
    `Run ${entry.runNumber}`,
    `${formatMessageTimestamp(startedAt)} (${formatTimeAgo(startedAt)})`,
  ];
  if (run.endedAt) {
    parts.push(formatDuration(Date.parse(run.endedAt) - startedAt.getTime()));
  }
  return parts.join(" · ");
}

// Hover lives on the outer plain View and press on the inner Pressable
// (docs/hover.md), matching the automation rows above it.
function ScheduleRunRow({
  entry,
  provider,
  isFirst,
}: {
  entry: ScheduleRunEntry;
  provider: string | null;
  isFirst: boolean;
}): ReactElement {
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const { run, schedule } = entry;
  const agentId = run.agentId;
  const canOpen = agentId !== null;
  const badge = RUN_STATUS_BADGE[run.status];

  const handlePress = useCallback(() => {
    if (!agentId) {
      return;
    }
    navigateToAgent({
      serverId: schedule.serverId,
      agentId,
      workspaceId: run.workspaceId,
      pin: true,
    });
  }, [agentId, run.workspaceId, schedule.serverId]);

  const rowStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      settingsStyles.row,
      styles.row,
      !isFirst && settingsStyles.rowBorder,
      canOpen && isHovered && !isCompact && styles.rowHovered,
      canOpen && pressed && styles.rowPressed,
    ],
    [canOpen, isFirst, isHovered, isCompact],
  );

  return (
    <View
      style={styles.rowContainer}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Pressable
        style={rowStyle}
        onPress={handlePress}
        disabled={!canOpen}
        accessibilityRole="button"
        accessibilityLabel={`Open run ${entry.runNumber} of ${entry.title}`}
        testID={`schedule-run-row-${run.id}`}
      >
        <View style={styles.main}>
          <View style={styles.leading}>
            <ProviderGlyph provider={provider} serverId={schedule.serverId} />
          </View>
          <View style={styles.textGroup}>
            <Text style={settingsStyles.rowTitle} numberOfLines={1}>
              {entry.title}
            </Text>
            <Text style={settingsStyles.rowHint} numberOfLines={1}>
              {buildRunMeta(entry)}
            </Text>
            {run.status === "failed" && run.error ? (
              <Text style={settingsStyles.rowError} numberOfLines={2}>
                {run.error}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.trailing}>
          <StatusBadge label={badge.label} variant={badge.variant} />
          <View style={styles.chevronSlot}>
            {canOpen ? <ThemedChevronRight size={14} uniProps={mutedColorMapping} /> : null}
          </View>
        </View>
      </Pressable>
    </View>
  );
}

function ProviderGlyph({
  provider,
  serverId,
}: {
  provider: string | null;
  serverId: string;
}): ReactElement | null {
  if (!provider) {
    return null;
  }
  const Icon = getProviderIcon(provider, serverId);
  return <Icon size={PROVIDER_ICON_SIZE} color={styles.providerIcon.color} />;
}

const styles = StyleSheet.create((theme) => ({
  summary: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  summaryCard: {
    flexGrow: 1,
    flexBasis: { xs: "40%", md: 0 },
    minWidth: 120,
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[1],
  },
  summaryLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  summaryValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontVariant: ["tabular-nums"],
  },
  // Static color holder for the dynamic provider icon (compliant idiom).
  providerIcon: {
    color: theme.colors.foregroundMuted,
  },
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
  main: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
  },
  leading: {
    width: PROVIDER_ICON_SIZE,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  textGroup: {
    flex: 1,
    minWidth: 0,
  },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  chevronSlot: {
    width: 14,
    alignItems: "center",
  },
}));
