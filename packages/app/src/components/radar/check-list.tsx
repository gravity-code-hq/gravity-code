import type { TFunction } from "i18next";
import type { RadarCheck, RadarCheckMessage } from "@gravity/protocol/radar/types";
import { ExternalLink } from "lucide-react-native";
import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { buttonIconSize, CONTROL_HEIGHTS } from "@/components/ui/control-geometry";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  RADAR_CHECK_HISTORY_PAGE_SIZE,
  radarCheckDecisionBadge,
  resolveRadarCheckOutcome,
  slackTsToDate,
  type RadarCheckOutcome,
  type RadarChecksView,
} from "@/radar/checks";
import { useRadarClock } from "@/radar/use-clock";
import { settingsStyles } from "@/styles/settings";
import { openExternalUrl } from "@/utils/open-external-url";
import { formatMessageTimestamp, formatTimeAgo } from "@/utils/time";

/**
 * Checks, newest first, with each message a check read and what it decided
 * about it. The same list serves one radar's history and the all-radars view;
 * a row names its channel only when the item carries one.
 */
export function RadarCheckList({
  view,
  onRetry,
}: {
  view: RadarChecksView;
  onRetry: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const now = useRadarClock(view);

  if (view.kind === "loading") {
    return (
      <View style={styles.centered} testID="radar-check-history-loading">
        <LoadingSpinner size="large" color={styles.spinner.color} />
      </View>
    );
  }

  if (view.kind === "error") {
    return (
      <View style={styles.centered} testID="radar-check-history-error">
        <View style={styles.messageStack}>
          <Text style={styles.message}>{t("radar.checks.loadError")}</Text>
          <Text style={styles.message}>{view.message}</Text>
        </View>
        <Button variant="ghost" onPress={onRetry} testID="radar-check-history-retry">
          {t("radar.states.retry")}
        </Button>
      </View>
    );
  }

  // One container for both loaded outcomes, so "the history has loaded" is a
  // single thing to wait for whether or not a check has run yet.
  return (
    <View style={styles.list} testID="radar-check-history-list">
      {view.items.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.message} testID="radar-check-history-empty">
            {t("radar.checks.empty")}
          </Text>
        </View>
      ) : (
        <View style={settingsStyles.card}>
          {view.items.map((item, index) => (
            <RadarCheckRow
              key={item.key}
              check={item.check}
              channel={item.channel}
              now={now}
              isFirst={index === 0}
            />
          ))}
        </View>
      )}
      {view.isLimited ? (
        <Text style={styles.limitNote} testID="radar-check-history-limited">
          {t("radar.checks.limited", { count: RADAR_CHECK_HISTORY_PAGE_SIZE })}
        </Text>
      ) : null}
    </View>
  );
}

function describeOutcome(outcome: RadarCheckOutcome, t: TFunction): string {
  return outcome.parts
    .map((part) => {
      if (part.kind === "raw") {
        return part.text;
      }
      return part.count === undefined ? t(part.labelKey) : t(part.labelKey, { count: part.count });
    })
    .join(" · ");
}

function RadarCheckRow({
  check,
  channel,
  now,
  isFirst,
}: {
  check: RadarCheck;
  channel: string | null;
  now: number;
  isFirst: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const startedAt = new Date(check.startedAt);
  const nowDate = new Date(now);
  const outcome = resolveRadarCheckOutcome(check);
  const when = `${formatMessageTimestamp(startedAt, nowDate)} · ${formatTimeAgo(startedAt, nowDate)}`;

  return (
    <View
      style={[styles.checkRow, !isFirst && settingsStyles.rowBorder]}
      testID={`radar-check-row-${check.id}`}
    >
      <Text style={settingsStyles.rowTitle} numberOfLines={1}>
        {channel ? `${channel} · ${when}` : when}
      </Text>
      <Text
        style={outcome.tone === "danger" ? settingsStyles.rowError : settingsStyles.rowHint}
        testID={`radar-check-outcome-${check.id}`}
      >
        {describeOutcome(outcome, t)}
      </Text>
      {check.messages.length > 0 ? (
        <View style={styles.messages}>
          {check.messages.map((message) => (
            <RadarCheckMessageRow key={message.ts} message={message} now={now} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function describeMessageMeta(message: RadarCheckMessage, now: number, t: TFunction): string {
  const author = message.author ?? t("radar.checks.message.unknownAuthor");
  const marker = message.isBot ? t("radar.checks.message.bot") : t("radar.checks.message.person");
  const postedAt = slackTsToDate(message.ts);
  const parts = postedAt
    ? [author, marker, formatMessageTimestamp(postedAt, new Date(now))]
    : [author, marker];
  return parts.join(" · ");
}

/**
 * The decision and its reason are always on screen: this row exists so the
 * user can read why a message was or was not picked up.
 */
function RadarCheckMessageRow({
  message,
  now,
}: {
  message: RadarCheckMessage;
  now: number;
}): ReactElement {
  const { t } = useTranslation();
  const { permalink } = message;
  const badge = radarCheckDecisionBadge(message.decision);
  const openSlackMessage = useCallback(() => {
    if (permalink) {
      void openExternalUrl(permalink);
    }
  }, [permalink]);

  return (
    <View style={styles.messageRow} testID={`radar-check-message-${message.ts}`}>
      <View style={styles.textGroup}>
        <Text style={settingsStyles.rowTitle} numberOfLines={3}>
          {message.summary}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {describeMessageMeta(message, now, t)}
        </Text>
        {message.reason ? <Text style={settingsStyles.rowHint}>{message.reason}</Text> : null}
      </View>
      <View style={styles.trailing}>
        <StatusBadge
          label={badge.labelKey ? t(badge.labelKey) : message.decision}
          variant={badge.variant}
        />
        <View style={styles.linkSlot}>
          {permalink ? (
            <Button
              variant="ghost"
              size="xs"
              leftIcon={ExternalLink}
              onPress={openSlackMessage}
              accessibilityLabel={t("radar.task.menu.openSlackMessage")}
              testID={`radar-check-message-open-${message.ts}`}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  centered: {
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[4],
    paddingVertical: theme.spacing[8],
  },
  messageStack: {
    alignItems: "center",
    gap: theme.spacing[2],
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
  list: {
    gap: theme.spacing[3],
  },
  // The settings row's padding, stacked: a check is a title, an outcome, and its messages.
  checkRow: {
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  // A second rail for what a check read, set in from the check's own text.
  messages: {
    marginTop: theme.spacing[3],
    paddingLeft: theme.spacing[3],
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
    gap: theme.spacing[3],
  },
  messageRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
  },
  textGroup: {
    flex: 1,
    minWidth: 0,
  },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  // The box of an icon-only `xs` button (icon, its horizontal padding, its
  // border), held on a message with no permalink so the decision pills share
  // one rail.
  linkSlot: {
    width: buttonIconSize.xs + theme.spacing[3] * 2 + 2,
    height: CONTROL_HEIGHTS.tight,
  },
  limitNote: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
