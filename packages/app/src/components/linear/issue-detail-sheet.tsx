import { ExternalLink as ExternalLinkIcon, GitBranch } from "lucide-react-native";
import { useCallback, useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type {
  LinearIssueDetail,
  LinearTeam,
  LinearWorkflowState,
} from "@gravity/protocol/linear/types";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { LinearPriorityIcon, linearPriorityKey } from "@/components/linear/priority-icon";
import { LinearStateBadge } from "@/components/linear/state-badge";
import { LinearStartAgentButton } from "@/components/linear/start-agent-menu";
import { LinearStatePicker } from "@/components/linear/state-picker";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useToast } from "@/contexts/toast-context";
import { describeLinearError } from "@/linear/error-copy";
import { useLinearIssue, useLinearSetIssueState, useLinearTeams } from "@/linear/use-linear";
import type { Theme } from "@/styles/theme";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { openExternalUrl } from "@/utils/open-external-url";
import { formatTimeAgo } from "@/utils/time";

const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedExternalLink = withUnistyles(ExternalLinkIcon);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const MENU_ICON_SIZE = 14;
const openExternalLeading = (
  <ThemedExternalLink size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />
);
const copyBranchLeading = <ThemedGitBranch size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;

interface LinearIssueDetailSheetProps {
  serverId: string;
  /** The issue to show; `null` keeps the sheet closed. */
  issueId: string | null;
  onClose: () => void;
  onStartAgent: (issue: LinearIssueDetail) => void;
}

/**
 * The issue drawer: title, editable status, properties, description, sub-issues,
 * and comments, with "Start agent" as the one primary action.
 */
export function LinearIssueDetailSheet({
  serverId,
  issueId,
  onClose,
  onStartAgent,
}: LinearIssueDetailSheetProps): ReactElement | null {
  if (issueId === null) return null;
  return (
    <LinearIssueDetailSheetContent
      key={issueId}
      serverId={serverId}
      issueId={issueId}
      onClose={onClose}
      onStartAgent={onStartAgent}
    />
  );
}

function LinearIssueDetailSheetContent({
  serverId,
  issueId,
  onClose,
  onStartAgent,
}: LinearIssueDetailSheetProps & { issueId: string }): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const issueQuery = useLinearIssue(serverId, issueId);
  const teamsQuery = useLinearTeams(serverId, true);
  const setState = useLinearSetIssueState(serverId);
  const issue = issueQuery.data ?? null;

  const team = useMemo<LinearTeam | null>(
    () => teamsQuery.data?.find((candidate) => candidate.id === issue?.team.id) ?? null,
    [issue?.team.id, teamsQuery.data],
  );

  const handleOpenInLinear = useCallback(() => {
    if (!issue) return;
    void openExternalUrl(issue.url);
  }, [issue]);

  const handleCopyBranch = useCallback(() => {
    if (!issue) return;
    void (async () => {
      await copyToClipboard(issue.branchName);
      toast.copied(t("linear.issue.branchCopied"));
    })();
  }, [issue, t, toast]);

  const handleStartAgent = useCallback(() => {
    if (!issue) return;
    onStartAgent(issue);
  }, [issue, onStartAgent]);

  const handleSelectState = useCallback(
    (state: LinearWorkflowState) => {
      if (!issue || state.id === issue.state.id) return;
      setState.mutate(
        { issueId: issue.id, stateId: state.id },
        {
          onError: (error) => {
            toast.error(`${t("linear.issue.stateUpdateFailed")}: ${describeLinearError(error, t)}`);
          },
        },
      );
    },
    [issue, setState, t, toast],
  );

  const header = useMemo(
    () => ({
      title: issue?.identifier ?? issueId,
      subtitle: issue ? <Text style={styles.headerSubtitle}>{issue.team.name}</Text> : undefined,
      actions: issue ? (
        <Button
          variant="ghost"
          size="sm"
          onPress={handleOpenInLinear}
          accessibilityLabel={t("linear.issue.open")}
          leftIcon={openExternalLeading}
          testID="linear-issue-open-external"
        />
      ) : undefined,
    }),
    [handleOpenInLinear, issue, issueId, t],
  );

  const footer = useMemo(
    () =>
      issue ? (
        <View style={styles.footer}>
          <Button
            style={styles.footerButton}
            variant="outline"
            onPress={handleCopyBranch}
            leftIcon={copyBranchLeading}
            testID="linear-issue-copy-branch"
          >
            {t("linear.issue.copyBranch")}
          </Button>
          <LinearStartAgentButton
            identifier={issue.identifier}
            isStarting={false}
            onStart={handleStartAgent}
          />
        </View>
      ) : undefined,
    [handleCopyBranch, handleStartAgent, issue, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      footer={footer}
      desktopMaxWidth={720}
      testID="linear-issue-sheet"
    >
      {issue ? (
        <LinearIssueBody
          issue={issue}
          states={team?.states ?? []}
          isUpdatingState={setState.isPending}
          onSelectState={handleSelectState}
        />
      ) : (
        <LinearIssueLoadState error={issueQuery.isError ? issueQuery.error : null} />
      )}
    </AdaptiveModalSheet>
  );
}

function LinearIssueLoadState({ error }: { error: unknown }): ReactElement {
  const { t } = useTranslation();
  if (error !== null) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{t("linear.issue.loadError")}</Text>
        <Text style={styles.mutedText}>{describeLinearError(error, t)}</Text>
      </View>
    );
  }
  return (
    <View style={styles.centered}>
      <LoadingSpinner size="large" color={styles.spinner.color} />
    </View>
  );
}

function LinearIssueBody({
  issue,
  states,
  isUpdatingState,
  onSelectState,
}: {
  issue: LinearIssueDetail;
  states: LinearWorkflowState[];
  isUpdatingState: boolean;
  onSelectState: (state: LinearWorkflowState) => void;
}): ReactElement {
  const { t } = useTranslation();
  const description = issue.description?.trim() ?? "";
  return (
    <View style={styles.body}>
      <Text style={styles.title}>{issue.title}</Text>

      <View style={styles.properties}>
        <PropertyRow label={t("linear.issue.state")}>
          <LinearStatePicker
            state={issue.state}
            states={states}
            isUpdating={isUpdatingState}
            onSelectState={onSelectState}
            testID="linear-issue-state-trigger"
          />
        </PropertyRow>
        <PropertyRow label={t("linear.issue.priority")}>
          <View style={styles.inlineValue}>
            <LinearPriorityIcon
              priority={issue.priority}
              accessibilityLabel={t(`linear.priority.${linearPriorityKey(issue.priority)}`)}
            />
            <Text style={styles.valueText}>
              {t(`linear.priority.${linearPriorityKey(issue.priority)}`)}
            </Text>
          </View>
        </PropertyRow>
        <PropertyRow label={t("linear.issue.assignee")}>
          <Text style={styles.valueText}>
            {issue.assignee?.displayName ?? t("linear.issue.unassigned")}
          </Text>
        </PropertyRow>
        {issue.labels.length > 0 ? (
          <PropertyRow label={t("linear.issue.labels")}>
            <View style={styles.labels}>
              {issue.labels.map((label) => (
                <View key={label.id} style={styles.label}>
                  <View style={[styles.labelDot, { backgroundColor: label.color }]} />
                  <Text style={styles.labelText}>{label.name}</Text>
                </View>
              ))}
            </View>
          </PropertyRow>
        ) : null}
        {issue.project ? (
          <PropertyRow label={t("linear.issue.project")}>
            <Text style={styles.valueText}>{issue.project.name}</Text>
          </PropertyRow>
        ) : null}
        {issue.dueDate ? (
          <PropertyRow label={t("linear.issue.dueDate")}>
            <Text style={styles.valueText}>{issue.dueDate}</Text>
          </PropertyRow>
        ) : null}
        <PropertyRow label={t("linear.issue.updated")}>
          <Text style={styles.valueText}>{formatTimeAgo(new Date(issue.updatedAt))}</Text>
        </PropertyRow>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("linear.issue.description")}</Text>
        {description ? (
          <MarkdownRenderer text={description} compact />
        ) : (
          <Text style={styles.mutedText}>{t("linear.issue.noDescription")}</Text>
        )}
      </View>

      {issue.children.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("linear.issue.subIssues")}</Text>
          {issue.children.map((child) => (
            <View key={child.id} style={styles.childRow}>
              <LinearPriorityIcon
                priority={child.priority}
                accessibilityLabel={t(`linear.priority.${linearPriorityKey(child.priority)}`)}
              />
              <Text style={styles.childIdentifier}>{child.identifier}</Text>
              <Text style={styles.childTitle} numberOfLines={1}>
                {child.title}
              </Text>
              <LinearStateBadge state={child.state} />
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("linear.issue.comments")}</Text>
        {issue.comments.length === 0 ? (
          <Text style={styles.mutedText}>{t("linear.issue.noComments")}</Text>
        ) : (
          issue.comments.map((comment) => (
            <View key={comment.id} style={styles.comment}>
              <Text style={styles.commentMeta}>
                {`${comment.user?.displayName ?? t("linear.issue.unknownUser")} · ${formatTimeAgo(
                  new Date(comment.createdAt),
                )}`}
              </Text>
              <MarkdownRenderer text={comment.body} compact />
            </View>
          ))
        )}
      </View>
    </View>
  );
}

function PropertyRow({ label, children }: { label: string; children: ReactElement }) {
  return (
    <View style={styles.propertyRow}>
      <Text style={styles.propertyLabel}>{label}</Text>
      <View style={styles.propertyValue}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[6],
  },
  headerSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[8],
  },
  spinner: {
    color: theme.colors.foregroundMuted,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.normal,
  },
  properties: {
    gap: theme.spacing[3],
  },
  propertyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    minHeight: 24,
  },
  propertyLabel: {
    width: 88,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  propertyValue: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
  },
  inlineValue: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  valueText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  labels: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  label: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingVertical: theme.spacing[0.5],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  labelDot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
  },
  labelText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  section: {
    gap: theme.spacing[3],
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  mutedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  errorText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.base,
  },
  childRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  childIdentifier: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  childTitle: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  comment: {
    gap: theme.spacing[1],
    paddingTop: theme.spacing[3],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  commentMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  footer: {
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  footerButton: {
    flex: 1,
  },
}));
