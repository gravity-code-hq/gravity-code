import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { getProviderIcon } from "@/components/provider-icons";
import { StatusBadge } from "@/components/ui/status-badge";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import { ProviderUsageBalanceBar } from "./balance-bar";
import { formatAgo } from "./format";
import type { ProviderUsage } from "./types";
import { ProviderUsageWindowBar } from "./window-bar";

interface ProviderUsageIconProps {
  iconKey: string;
  size: number;
  color?: string;
}

function ProviderUsageIcon({ iconKey, size, color = "" }: ProviderUsageIconProps) {
  const Icon = getProviderIcon(iconKey);
  return <Icon size={size} color={color} />;
}

const ThemedProviderUsageIcon = withUnistyles(ProviderUsageIcon);

const mutedIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function statusText(usage: ProviderUsage): string | null {
  if (usage.status === "available") return null;
  return usage.status === "error" ? "Error" : "Unavailable";
}

function footerText(usage: ProviderUsage): string | null {
  const updated = formatAgo(usage.fetchedAt);
  const parts = [usage.sourceLabel, updated ? `Updated ${updated}` : null].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function ProviderUsageCard({
  usage,
  compact = false,
}: {
  usage: ProviderUsage;
  compact?: boolean;
}) {
  const status = statusText(usage);
  const footer = footerText(usage);
  const balances = usage.balances ?? [];
  const details = usage.details ?? [];
  const meteredBalances = balances.filter((balance) => balance.limit != null && balance.limit > 0);
  const unmeteredBalances = balances.filter(
    (balance) => balance.limit == null || balance.limit <= 0,
  );
  const barBalances = compact ? balances : meteredBalances;
  const footerBalances = compact ? [] : unmeteredBalances;
  const hasBars = usage.windows.length > 0 || barBalances.length > 0;
  const hasDetails = details.length > 0 || footerBalances.length > 0;
  const separateDetails = !compact && hasBars;
  const detailsStyle = useMemo(
    () => [
      compact ? styles.details : styles.sectionDetails,
      separateDetails && styles.detailsBorder,
    ],
    [compact, separateDetails],
  );

  const containerStyle = useMemo(
    () => [styles.container, compact ? styles.containerCompact : styles.containerPadded],
    [compact],
  );
  const dotStyle = useMemo(
    () => [
      styles.statusDot,
      usage.status === "available" && styles.statusDotAvailable,
      usage.status === "error" && styles.statusDotError,
    ],
    [usage.status],
  );
  const sectionIcon = useMemo(
    () => (
      <ThemedProviderUsageIcon iconKey={usage.providerId} size={14} uniProps={mutedIconColor} />
    ),
    [usage.providerId],
  );
  const planBadge = useMemo(
    () => (usage.planLabel ? <StatusBadge label={usage.planLabel} variant="muted" /> : null),
    [usage.planLabel],
  );
  const statusBadge = useMemo(
    () => (status ? <StatusBadge label={status} variant="muted" /> : null),
    [status],
  );

  const header = (
    <View style={styles.header}>
      {sectionIcon}
      <Text style={styles.name} numberOfLines={1}>
        {usage.displayName}
      </Text>
      {planBadge}
      <View style={styles.headerSpacer} />
      {status ? (
        <View style={styles.statusRow}>
          <View style={dotStyle} />
          <Text style={styles.statusLabel}>{status}</Text>
        </View>
      ) : null}
    </View>
  );

  const body = (
    <View style={containerStyle}>
      {compact ? header : null}

      {usage.error ? (
        <Text style={styles.error} numberOfLines={3}>
          {usage.error}
        </Text>
      ) : null}

      {hasBars ? (
        <View style={compact ? styles.bars : styles.sectionBars}>
          {usage.windows.map((window) => (
            <ProviderUsageWindowBar key={window.id} window={window} compact={compact} />
          ))}
          {barBalances.map((balance) => (
            <ProviderUsageBalanceBar key={balance.id} balance={balance} compact={compact} />
          ))}
        </View>
      ) : null}

      {hasDetails ? (
        <View style={detailsStyle}>
          {footerBalances.map((balance) => (
            <ProviderUsageBalanceBar key={balance.id} balance={balance} compact={compact} />
          ))}
          {details.map((detail) => (
            <View key={detail.id} style={styles.detailRow}>
              <Text style={styles.detailLabel} numberOfLines={1}>
                {detail.label}
              </Text>
              <Text style={styles.detailValue} numberOfLines={1}>
                {detail.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {footer ? (
        <Text style={styles.footer} numberOfLines={1}>
          {footer}
        </Text>
      ) : null}
    </View>
  );

  if (compact) return body;

  return (
    <SettingsSection
      title={usage.displayName}
      leading={sectionIcon}
      titleAccessory={planBadge}
      trailing={statusBadge}
      testID={`provider-usage-section-${usage.providerId}`}
    >
      <View style={settingsStyles.card}>{body}</View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[3],
  },
  containerPadded: {
    gap: theme.spacing[4],
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  containerCompact: {
    gap: theme.spacing[3],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  name: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  headerSpacer: {
    flex: 1,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.foregroundMuted,
  },
  statusDotAvailable: {
    backgroundColor: theme.colors.statusSuccess,
  },
  statusDotError: {
    backgroundColor: theme.colors.statusDanger,
  },
  statusLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  bars: {
    gap: theme.spacing[3],
  },
  sectionBars: {
    gap: theme.spacing[6],
  },
  sectionDetails: {
    gap: theme.spacing[3],
  },
  detailsBorder: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing[4],
  },
  details: {
    gap: theme.spacing[1],
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  detailLabel: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  detailValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
  footer: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
