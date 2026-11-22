import { useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { RadarCheckList } from "@/components/radar/check-list";
import { useRadarChecks } from "@/radar/use-checks";

/** Which radar's history to show, with its channel as the card displays it. */
export interface RadarHistoryTarget {
  radarId: string;
  channel: string;
}

interface RadarCheckHistorySheetProps extends RadarHistoryTarget {
  serverId: string;
  onClose: () => void;
}

/**
 * The checks one radar kept, newest first. Mounted only while open, which is
 * also what scopes the history query and its polling.
 */
export function RadarCheckHistorySheet({
  serverId,
  radarId,
  channel,
  onClose,
}: RadarCheckHistorySheetProps): ReactElement {
  const { t } = useTranslation();
  // The sheet's subtitle already names the channel, so rows carry none.
  const targets = useMemo(() => [{ radarId, channel: null }], [radarId]);
  const { view, refetch } = useRadarChecks({ serverId, targets });
  const header = useMemo<SheetHeader>(
    () => ({
      title: t("radar.checks.title"),
      subtitle: <Text style={styles.headerSubtitle}>{channel}</Text>,
    }),
    [channel, t],
  );

  return (
    <AdaptiveModalSheet
      visible
      header={header}
      onClose={onClose}
      desktopMaxWidth={720}
      testID="radar-check-history-sheet"
    >
      <RadarCheckList view={view} onRetry={refetch} />
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  headerSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
