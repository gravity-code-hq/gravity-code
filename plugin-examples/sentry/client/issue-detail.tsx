import type { PluginTheme } from "@gravity/plugin";
import { useRpc } from "@gravity/plugin/client";
import { Icon, Modal } from "@gravity/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import {
  getIssueRpc,
  type SentryEvent,
  type SentryException,
  type SentryIssueDetail,
  type SentryIssueSummary,
} from "../shared/contracts";
import { buildFrameRows, type FrameRow } from "../shared/frames";
import { Button } from "./controls";
import { describeError, formatAge, formatCount, levelColor } from "./format";
import { sentryKeys } from "./queries";
import { openExternal } from "./web";

const FRAME_ROW_LIMIT = 20;
const MONOSPACE = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });
const BODY_LAYOUT = { gap: 24 };
const ACTIONS = { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 };

interface IssueDetailProps {
  theme: PluginTheme;
  compact: boolean;
  organization: string;
  issue: SentryIssueSummary | null;
  onClose(): void;
  onStart(issue: SentryIssueSummary): void;
}

export function useIssueDetail(organization: string, issueId: string | null) {
  const getIssue = useRpc(getIssueRpc);
  return useQuery({
    queryKey: sentryKeys.issue(organization, issueId ?? ""),
    queryFn: () => getIssue({ organization, issueId: issueId ?? "" }),
    enabled: issueId !== null,
    staleTime: 60_000,
  });
}

export function IssueDetail({
  theme,
  compact,
  organization,
  issue,
  onClose,
  onStart,
}: IssueDetailProps) {
  const icon = useMemo(
    () => <Icon name="Bug" size={18} color={theme.colors.foreground} />,
    [theme],
  );
  const changeOpen = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );
  return (
    <Modal
      title={issue?.shortId ?? "Issue"}
      icon={icon}
      size="wide"
      open={issue !== null}
      onOpenChange={changeOpen}
    >
      <Modal.Content contentContainerStyle={BODY_LAYOUT}>
        {issue ? (
          <IssueDetailBody
            theme={theme}
            compact={compact}
            organization={organization}
            issue={issue}
            onStart={onStart}
          />
        ) : null}
      </Modal.Content>
    </Modal>
  );
}

function IssueDetailBody({
  theme,
  compact,
  organization,
  issue,
  onStart,
}: {
  theme: PluginTheme;
  compact: boolean;
  organization: string;
  issue: SentryIssueSummary;
  onStart(issue: SentryIssueSummary): void;
}) {
  const detail = useIssueDetail(organization, issue.id);
  const current: SentryIssueSummary = detail.data ?? issue;
  const error = useMemo(() => ({ color: theme.colors.statusDanger, fontSize: 13 }), [theme]);
  return (
    <>
      <IssueSummary theme={theme} issue={current} />
      <IssueActions theme={theme} issue={current} onStart={onStart} />
      <IssueStats theme={theme} compact={compact} issue={current} />
      {detail.error ? <Text style={error}>{describeError(detail.error)}</Text> : null}
      {detail.isPending ? <ActivityIndicator color={theme.colors.foregroundMuted} /> : null}
      {detail.data ? <EventSections theme={theme} detail={detail.data} /> : null}
    </>
  );
}

function IssueSummary({ theme, issue }: { theme: PluginTheme; issue: SentryIssueSummary }) {
  const styles = useMemo(
    () => ({
      summary: { gap: 6 },
      title: { color: theme.colors.foreground, fontSize: 15, fontWeight: "500" as const },
      culprit: { color: theme.colors.foregroundMuted, fontSize: 13, fontFamily: MONOSPACE },
      meta: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        gap: 6,
        marginTop: 2,
      },
      dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: levelColor(issue.level, theme),
      },
      text: { color: theme.colors.foregroundMuted, fontSize: 13 },
      unhandled: { color: theme.colors.statusWarning, fontSize: 13 },
    }),
    [issue.level, theme],
  );
  return (
    <View style={styles.summary}>
      <Text selectable style={styles.title}>
        {issue.title}
      </Text>
      {issue.culprit ? (
        <Text selectable numberOfLines={2} style={styles.culprit}>
          {issue.culprit}
        </Text>
      ) : null}
      <View style={styles.meta}>
        <View style={styles.dot} />
        <Text style={styles.text}>{capitalize(issue.level)}</Text>
        {issue.isUnhandled ? (
          <>
            <Text style={styles.text}>·</Text>
            <Text style={styles.unhandled}>Unhandled</Text>
          </>
        ) : null}
        <Text style={styles.text}>·</Text>
        <Text style={styles.text}>{capitalize(issue.status)}</Text>
        <Text style={styles.text}>·</Text>
        <Text style={styles.text}>{issue.project.slug}</Text>
      </View>
    </View>
  );
}

function IssueStats({
  theme,
  compact,
  issue,
}: {
  theme: PluginTheme;
  compact: boolean;
  issue: SentryIssueSummary;
}) {
  const stats = [
    { label: "Events", value: formatCount(issue.count) },
    { label: "Users", value: formatCount(issue.userCount) },
    { label: "Last seen", value: formatAge(issue.lastSeen) },
    { label: "First seen", value: formatAge(issue.firstSeen) },
  ];
  const styles = useMemo(
    () => ({
      card: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        overflow: "hidden" as const,
      },
      cell: {
        width: compact ? ("50%" as const) : ("25%" as const),
        gap: 4,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderLeftWidth: 0,
        borderLeftColor: theme.colors.border,
      },
      label: { color: theme.colors.foregroundMuted, fontSize: 12 },
      value: { color: theme.colors.foreground, fontSize: 15 },
    }),
    [compact, theme],
  );
  const cells = useMemo(
    () => ({ cell: styles.cell, dividedCell: { ...styles.cell, borderLeftWidth: 1 } }),
    [styles.cell],
  );
  return (
    <View style={styles.card}>
      {stats.map((stat, position) => (
        <View
          key={stat.label}
          style={position % (compact ? 2 : 4) === 0 ? cells.cell : cells.dividedCell}
        >
          <Text style={styles.label}>{stat.label}</Text>
          <Text style={styles.value}>{stat.value}</Text>
        </View>
      ))}
    </View>
  );
}

function EventSections({ theme, detail }: { theme: PluginTheme; detail: SentryIssueDetail }) {
  const muted = useMemo(() => ({ color: theme.colors.foregroundMuted, fontSize: 13 }), [theme]);
  if (!detail.event) return <Text style={muted}>Sentry has no stored event for this issue</Text>;
  // Chained exceptions arrive cause-first; the last one is what was thrown.
  const exception = detail.event.exceptions.at(-1) ?? null;
  return (
    <>
      {exception ? <StackTrace theme={theme} exception={exception} /> : null}
      <EventContext theme={theme} event={detail.event} />
    </>
  );
}

function Section({
  theme,
  title,
  trailing,
  children,
}: {
  theme: PluginTheme;
  title: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const styles = useMemo(
    () => ({
      section: { gap: 10 },
      header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        minHeight: 20,
      },
      title: { color: theme.colors.foregroundMuted, fontSize: 13, fontWeight: "500" as const },
    }),
    [theme],
  );
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {trailing}
      </View>
      {children}
    </View>
  );
}

function StackTrace({ theme, exception }: { theme: PluginTheme; exception: SentryException }) {
  const [showLibrary, setShowLibrary] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(() => buildFrameRows(exception, showLibrary), [exception, showLibrary]);
  const hasAppFrames = exception.frames.some((frame) => frame.inApp);
  const hasLibraryFrames = exception.frames.some((frame) => !frame.inApp);
  const visible = expanded ? rows : rows.slice(0, FRAME_ROW_LIMIT);
  const hidden = rows.length - visible.length;
  const toggleLibrary = useCallback(() => setShowLibrary((current) => !current), []);
  const revealLibrary = useCallback(() => setShowLibrary(true), []);
  const expand = useCallback(() => setExpanded(true), []);
  const styles = useMemo(
    () => ({
      exception: { gap: 2 },
      type: { color: theme.colors.statusDanger, fontSize: 13, fontWeight: "500" as const },
      value: { color: theme.colors.foreground, fontSize: 13, lineHeight: 19 },
      card: {
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        overflow: "hidden" as const,
      },
      toggle: { color: theme.colors.foregroundMuted, fontSize: 12 },
      more: { color: theme.colors.foregroundMuted, fontSize: 12, padding: 12 },
    }),
    [theme],
  );
  const trailing = useMemo(
    () =>
      hasAppFrames && hasLibraryFrames ? (
        <Pressable accessibilityRole="button" onPress={toggleLibrary}>
          <Text style={styles.toggle}>
            {showLibrary ? "Hide library frames" : "Show library frames"}
          </Text>
        </Pressable>
      ) : null,
    [hasAppFrames, hasLibraryFrames, showLibrary, styles.toggle, toggleLibrary],
  );
  return (
    <Section theme={theme} title="Stack trace" trailing={trailing}>
      <View style={styles.exception}>
        <Text selectable style={styles.type}>
          {exception.type ?? "Exception"}
        </Text>
        {exception.value ? (
          <Text selectable style={styles.value}>
            {exception.value}
          </Text>
        ) : null}
      </View>
      {rows.length > 0 ? (
        <View style={styles.card}>
          {visible.map((row, position) =>
            row.kind === "frame" ? (
              <FrameLine key={row.key} theme={theme} row={row} divided={position > 0} />
            ) : (
              <LibraryLine
                key={row.key}
                theme={theme}
                count={row.count}
                divided={position > 0}
                onPress={revealLibrary}
              />
            ),
          )}
          {hidden > 0 ? (
            <Pressable accessibilityRole="button" onPress={expand}>
              <Text style={styles.more}>
                Show {hidden} more {hidden === 1 ? "frame" : "frames"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Section>
  );
}

function FrameLine({
  theme,
  row,
  divided,
}: {
  theme: PluginTheme;
  row: Extract<FrameRow, { kind: "frame" }>;
  divided: boolean;
}) {
  const styles = useMemo(
    () => ({
      row: {
        gap: 2,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderTopWidth: divided ? 1 : 0,
        borderTopColor: theme.colors.border,
        backgroundColor: row.inApp ? theme.colors.surface1 : "transparent",
      },
      name: {
        color: row.inApp ? theme.colors.foreground : theme.colors.foregroundMuted,
        fontFamily: MONOSPACE,
        fontSize: 12,
      },
      location: { color: theme.colors.foregroundMuted, fontFamily: MONOSPACE, fontSize: 12 },
    }),
    [divided, row.inApp, theme],
  );
  return (
    <View style={styles.row}>
      <Text selectable numberOfLines={1} style={styles.name}>
        {row.name}
      </Text>
      <Text selectable numberOfLines={1} style={styles.location}>
        {row.location}
      </Text>
    </View>
  );
}

function LibraryLine({
  theme,
  count,
  divided,
  onPress,
}: {
  theme: PluginTheme;
  count: number;
  divided: boolean;
  onPress(): void;
}) {
  const styles = useMemo(
    () => ({
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderTopWidth: divided ? 1 : 0,
        borderTopColor: theme.colors.border,
      },
      text: { color: theme.colors.foregroundMuted, fontSize: 12 },
    }),
    [divided, theme],
  );
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
      <Icon name="ChevronRight" size={12} color={theme.colors.foregroundMuted} />
      <Text style={styles.text}>
        {count} library {count === 1 ? "frame" : "frames"}
      </Text>
    </Pressable>
  );
}

function EventContext({ theme, event }: { theme: PluginTheme; event: SentryEvent }) {
  const rows = [
    ...(event.request
      ? [
          {
            label: "Request",
            value: [event.request.method, event.request.url].filter(Boolean).join(" "),
          },
        ]
      : []),
    ...(event.transaction ? [{ label: "Transaction", value: event.transaction }] : []),
    ...(event.environment ? [{ label: "Environment", value: event.environment }] : []),
    ...(event.release ? [{ label: "Release", value: event.release }] : []),
    { label: "Seen", value: formatAge(event.dateCreated) },
  ];
  const styles = useMemo(
    () => ({
      card: {
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        overflow: "hidden" as const,
      },
      row: {
        flexDirection: "row" as const,
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 9,
      },
      dividedRow: {
        flexDirection: "row" as const,
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
      },
      label: { width: 96, color: theme.colors.foregroundMuted, fontSize: 13 },
      value: { flex: 1, color: theme.colors.foreground, fontSize: 13 },
    }),
    [theme],
  );
  return (
    <Section theme={theme} title="Latest event">
      <View style={styles.card}>
        {rows.map((row, position) => (
          <View key={row.label} style={position > 0 ? styles.dividedRow : styles.row}>
            <Text style={styles.label}>{row.label}</Text>
            <Text selectable numberOfLines={2} style={styles.value}>
              {row.value}
            </Text>
          </View>
        ))}
      </View>
    </Section>
  );
}

function IssueActions({
  theme,
  issue,
  onStart,
}: {
  theme: PluginTheme;
  issue: SentryIssueSummary;
  onStart(issue: SentryIssueSummary): void;
}) {
  const start = useCallback(() => onStart(issue), [issue, onStart]);
  const openInSentry = useCallback(() => void openExternal(issue.permalink), [issue.permalink]);
  return (
    <View style={ACTIONS}>
      <Button theme={theme} variant="primary" icon="Bot" label="Start agent" onPress={start} />
      <Button theme={theme} icon="ExternalLink" label="Open in Sentry" onPress={openInSentry} />
    </View>
  );
}

function capitalize(text: string): string {
  return text ? `${text[0]?.toUpperCase()}${text.slice(1)}` : text;
}
