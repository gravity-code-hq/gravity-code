import { useMemo } from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { clampPct, formatAmount, formatResetLabel } from "./format";
import type { ProviderUsageBalance, ProviderUsageTone } from "./types";

interface ResolvedBalance {
  amountText: string;
  usedPct: number | null;
}

function resolveBalance(balance: ProviderUsageBalance): ResolvedBalance {
  const { used, remaining, limit, unit } = balance;
  if (limit != null && limit > 0) {
    const usedAmount = used ?? (remaining != null ? limit - remaining : null);
    const usedPct = usedAmount != null ? (usedAmount / limit) * 100 : null;
    const usedText = usedAmount != null ? formatAmount(usedAmount, unit) : "—";
    return { amountText: `${usedText} / ${formatAmount(limit, unit)}`, usedPct };
  }
  if (remaining != null) {
    return { amountText: `${formatAmount(remaining, unit)} left`, usedPct: null };
  }
  if (used != null) {
    return { amountText: formatAmount(used, unit), usedPct: null };
  }
  return { amountText: "—", usedPct: null };
}

function fillToneStyle(tone: ProviderUsageTone) {
  switch (tone) {
    case "ok":
      return styles.fillOk;
    case "warning":
      return styles.fillWarning;
    case "danger":
      return styles.fillDanger;
    default:
      return styles.fillDefault;
  }
}

export function ProviderUsageBalanceBar({
  balance,
  compact = true,
}: {
  balance: ProviderUsageBalance;
  compact?: boolean;
}) {
  const { amountText, usedPct } = resolveBalance(balance);
  const tone = balance.tone ?? "default";
  const resetLabel = formatResetLabel(balance.resetsAt);

  const fillStyle = useMemo<StyleProp<ViewStyle>>(
    () => [styles.fill, fillToneStyle(tone), { width: `${clampPct(usedPct ?? 0)}%` }],
    [usedPct, tone],
  );

  return (
    <View style={compact ? styles.container : styles.sectionContainer}>
      <View style={compact ? styles.labelRow : styles.sectionLabelRow}>
        <Text style={compact ? styles.label : styles.sectionLabel}>{balance.label}</Text>
        <Text style={compact ? styles.value : styles.sectionValue}>
          {amountText}
          {compact && resetLabel ? <Text style={styles.reset}>{` · ${resetLabel}`}</Text> : null}
        </Text>
        {!compact && resetLabel ? <Text style={styles.resetLabel}>{resetLabel}</Text> : null}
        {!compact && usedPct != null && usedPct > 100 ? (
          <Text style={styles.overLimit}>Above plan</Text>
        ) : null}
      </View>
      {usedPct != null ? (
        <View style={styles.track}>
          <View style={fillStyle} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: 3,
  },
  sectionContainer: {
    gap: theme.spacing[2],
  },
  sectionLabelRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: theme.spacing[3],
    rowGap: theme.spacing[1],
  },
  sectionLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  sectionValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    fontVariant: ["tabular-nums"],
  },
  resetLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  overLimit: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  label: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  value: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  reset: {
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.normal,
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.surface3,
    overflow: "hidden",
  },
  fill: {
    height: 4,
    borderRadius: 2,
  },
  fillDefault: {
    backgroundColor: theme.colors.foregroundMuted,
  },
  fillOk: {
    backgroundColor: theme.colors.statusSuccess,
  },
  fillWarning: {
    backgroundColor: theme.colors.statusWarning,
  },
  fillDanger: {
    backgroundColor: theme.colors.statusDanger,
  },
}));
