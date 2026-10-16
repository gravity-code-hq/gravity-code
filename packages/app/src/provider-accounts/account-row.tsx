import { MoreHorizontal, Trash2 } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ProviderAccount, ProviderUsage } from "@gravity/protocol/messages";
import { getProviderIcon } from "@/components/provider-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/ui/status-badge";
import { ProviderUsageWindowBar } from "@/provider-usage/window-bar";
import { ProviderUsageBalanceBar } from "@/provider-usage/balance-bar";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";

export interface ProviderAccountRowProps {
  serverId: string;
  providerId: string;
  providerLabel: string;
  account: ProviderAccount;
  isFirst: boolean;
  isSwitching: boolean;
  isRemoving: boolean;
  onSwitch: (account: ProviderAccount) => void;
  onRemove: (account: ProviderAccount) => void;
}

interface ProviderIconProps {
  providerId: string;
  serverId: string;
  size: number;
  color?: string;
}

function ProviderIcon({ providerId, serverId, size, color = "" }: ProviderIconProps) {
  const Icon = getProviderIcon(providerId, serverId);
  return <Icon size={size} color={color} />;
}

const ThemedProviderIcon = withUnistyles(ProviderIcon);
const ThemedMoreHorizontal = withUnistyles(MoreHorizontal);
const ThemedTrash = withUnistyles(Trash2);

const foregroundIconColor = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const dangerIconColor = (theme: Theme) => ({ color: theme.colors.statusDanger });

/** "Org · Plan" style context under the email, or null when there is nothing to say. */
export function accountRowHint(account: ProviderAccount): string | null {
  const parts = [account.organizationName, account.planLabel].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

function AccountState({
  account,
  isSwitching,
  isRemoving,
  onSwitch,
}: Pick<ProviderAccountRowProps, "account" | "isSwitching" | "isRemoving" | "onSwitch">) {
  const { t } = useTranslation();
  const handleSwitch = useCallback(() => onSwitch(account), [account, onSwitch]);

  if (account.isActive) {
    return <StatusBadge label={t("settings.accounts.active")} variant="success" />;
  }
  if (account.reloginRequired) {
    return <StatusBadge label={t("settings.accounts.loginExpired")} variant="warning" />;
  }
  return (
    <Button
      variant="outline"
      size="sm"
      loading={isSwitching}
      disabled={isSwitching || isRemoving}
      onPress={handleSwitch}
      testID={`provider-account-switch-${account.id}`}
    >
      {isSwitching ? t("settings.accounts.switching") : t("settings.accounts.switch")}
    </Button>
  );
}

export function ProviderAccountUsage({
  usage,
  reloginRequired,
  providerLabel,
}: {
  usage: ProviderUsage | null | undefined;
  reloginRequired: boolean;
  providerLabel: string;
}) {
  const { t } = useTranslation();

  if (reloginRequired) {
    return (
      <Text style={styles.hint}>
        {t("settings.accounts.loginExpiredHint", { provider: providerLabel })}
      </Text>
    );
  }
  const balances = usage?.balances ?? [];
  const hasUsage =
    usage?.status === "available" && (usage.windows.length > 0 || balances.length > 0);
  if (hasUsage) {
    return (
      <View style={styles.bars}>
        {usage.windows.map((window) => (
          <ProviderUsageWindowBar key={window.id} window={window} />
        ))}
        {balances.map((balance) => (
          <ProviderUsageBalanceBar key={balance.id} balance={balance} />
        ))}
      </View>
    );
  }
  return <Text style={styles.hint}>{usage?.error || t("settings.accounts.usageUnavailable")}</Text>;
}

export function ProviderAccountRow({
  serverId,
  providerId,
  providerLabel,
  account,
  isFirst,
  isSwitching,
  isRemoving,
  onSwitch,
  onRemove,
}: ProviderAccountRowProps) {
  const { t } = useTranslation();
  const hint = accountRowHint(account);

  const handleRemove = useCallback(() => onRemove(account), [account, onRemove]);
  const rowStyle = useMemo(() => [styles.row, !isFirst && settingsStyles.rowBorder], [isFirst]);
  const triggerStyle = useCallback(
    ({
      pressed,
      hovered,
      open,
    }: PressableStateCallbackType & { hovered?: boolean; open?: boolean }) => [
      styles.menuButton,
      (hovered || open) && styles.menuButtonHovered,
      pressed && styles.menuButtonPressed,
    ],
    [],
  );
  const trashLeading = useMemo(
    () => <ThemedTrash size={ICON_SIZE.md} uniProps={dangerIconColor} />,
    [],
  );

  return (
    <View style={rowStyle} testID={`provider-account-${account.id}`}>
      <View style={styles.titleRow}>
        <ThemedProviderIcon
          providerId={providerId}
          serverId={serverId}
          size={ICON_SIZE.md}
          uniProps={foregroundIconColor}
        />
        <View style={styles.textColumn}>
          <Text style={settingsStyles.rowTitle} numberOfLines={1}>
            {account.email}
          </Text>
          {hint ? (
            <Text style={styles.hint} numberOfLines={1}>
              {hint}
            </Text>
          ) : null}
        </View>
        <View style={styles.trailing}>
          <AccountState
            account={account}
            isSwitching={isSwitching}
            isRemoving={isRemoving}
            onSwitch={onSwitch}
          />
          {!account.isActive ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={isRemoving || isSwitching}
                hitSlop={8}
                style={triggerStyle}
                accessibilityRole="button"
                accessibilityLabel={t("settings.accounts.actionsMenu", { email: account.email })}
                testID={`provider-account-actions-${account.id}`}
              >
                {({ hovered, open }) => (
                  <ThemedMoreHorizontal
                    size={ICON_SIZE.sm}
                    uniProps={hovered || open ? foregroundIconColor : mutedIconColor}
                  />
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" width={220}>
                <DropdownMenuItem
                  destructive
                  leading={trashLeading}
                  onSelect={handleRemove}
                  status={isRemoving ? "pending" : "idle"}
                  pendingLabel={t("settings.accounts.removing")}
                  testID={`provider-account-remove-${account.id}`}
                >
                  {t("settings.accounts.remove")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </View>
      </View>
      <ProviderAccountUsage
        usage={account.usage}
        reloginRequired={account.reloginRequired}
        providerLabel={providerLabel}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  bars: {
    gap: theme.spacing[3],
  },
  menuButton: {
    padding: 2,
    borderRadius: 4,
  },
  menuButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  menuButtonPressed: {
    backgroundColor: theme.colors.surface3,
  },
}));
