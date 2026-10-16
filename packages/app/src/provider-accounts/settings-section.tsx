import { RefreshCw } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ProviderAccount, ProviderAccountsProvider } from "@gravity/protocol/messages";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { ProviderAccountRow, ProviderAccountUsage } from "./account-row";
import { useProviderAccounts, type ProviderAccountsView } from "./use-provider-accounts";

interface ActionFailure {
  title: string;
  message: string;
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  // The client appends the correlation it failed on to every RPC error; the daemon's
  // own sentence is what the user needs.
  if (error.name !== "DaemonRpcError") return error.message;
  return error.message.replace(/ requestType=\S+(?: code=\S+)?$/, "");
}

/** Saved logins for one provider, with switch and remove. */
export function ProviderAccountsSection({
  serverId,
  providerId,
}: {
  serverId: string;
  providerId: string;
}) {
  const { t } = useTranslation();
  const { view, refresh, activate, remove } = useProviderAccounts(serverId);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const busy = view.kind === "loading" || (view.kind === "ready" && view.isRefreshing);

  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  const handleSwitch = useCallback(
    async (account: ProviderAccount) => {
      setFailure(null);
      try {
        await activate.mutateAsync({ providerId, accountId: account.id });
      } catch (error) {
        setFailure({
          title: t("settings.accounts.switchErrorTitle"),
          message: errorMessage(error),
        });
      }
    },
    [activate, providerId, t],
  );

  const handleRemove = useCallback(
    async (account: ProviderAccount) => {
      const confirmed = await confirmDialog({
        title: t("settings.accounts.removeConfirmTitle", { email: account.email }),
        message: t("settings.accounts.removeConfirmMessage"),
        confirmLabel: t("settings.accounts.removeConfirm"),
        destructive: true,
      });
      if (!confirmed) return;
      setFailure(null);
      try {
        await remove.mutateAsync({ providerId, accountId: account.id });
      } catch (error) {
        setFailure({
          title: t("settings.accounts.removeErrorTitle"),
          message: errorMessage(error),
        });
      }
    },
    [providerId, remove, t],
  );

  const dismissFailure = useCallback(() => setFailure(null), []);

  const refreshButton = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        leftIcon={RefreshCw}
        loading={busy}
        onPress={handleRefresh}
        accessibilityLabel={t("settings.accounts.refresh")}
      >
        {busy ? t("settings.accounts.refreshing") : t("settings.accounts.refresh")}
      </Button>
    ),
    [busy, handleRefresh, t],
  );

  return (
    <SettingsSection
      title={t("settings.accounts.title")}
      info={t("settings.accounts.info")}
      trailing={refreshButton}
      testID={`provider-accounts-${providerId}`}
    >
      <ProviderAccountsBody
        serverId={serverId}
        providerId={providerId}
        view={view}
        failure={failure}
        pendingSwitch={activate.isPending ? (activate.variables?.accountId ?? null) : null}
        pendingRemove={remove.isPending ? (remove.variables?.accountId ?? null) : null}
        onRefresh={handleRefresh}
        onSwitch={handleSwitch}
        onRemove={handleRemove}
        onDismissFailure={dismissFailure}
      />
    </SettingsSection>
  );
}

interface ProviderAccountsBodyProps {
  serverId: string;
  providerId: string;
  view: ProviderAccountsView;
  failure: ActionFailure | null;
  pendingSwitch: string | null;
  pendingRemove: string | null;
  onRefresh: () => void;
  onSwitch: (account: ProviderAccount) => void;
  onRemove: (account: ProviderAccount) => void;
  onDismissFailure: () => void;
}

function ProviderAccountsBody({ view, providerId, onRefresh, ...rest }: ProviderAccountsBodyProps) {
  const { t } = useTranslation();

  if (view.kind === "loading") {
    return (
      <View style={[settingsStyles.card, styles.emptyCard]}>
        <Text style={styles.emptyText}>{t("settings.accounts.loading")}</Text>
      </View>
    );
  }

  const provider =
    view.kind === "ready"
      ? view.payload.providers.find((entry) => entry.providerId === providerId)
      : undefined;
  if (view.kind === "error" || !provider) {
    const message =
      view.kind === "error" ? view.message : t("settings.accounts.providerUnsupported");
    return (
      <Alert variant="error" title={t("settings.accounts.errorTitle")} description={message}>
        <Button variant="outline" size="sm" onPress={onRefresh}>
          {t("settings.accounts.retry")}
        </Button>
      </Alert>
    );
  }

  return <ProviderAccountsCard provider={provider} providerId={providerId} {...rest} />;
}

interface ProviderAccountsCardProps extends Omit<ProviderAccountsBodyProps, "view" | "onRefresh"> {
  provider: ProviderAccountsProvider;
}

function ProviderAccountsCard({
  serverId,
  providerId,
  provider,
  failure,
  pendingSwitch,
  pendingRemove,
  onSwitch,
  onRemove,
  onDismissFailure,
}: ProviderAccountsCardProps) {
  const { t } = useTranslation();
  const { displayName, liveLogin, accounts } = provider;
  const unsavedLogin = liveLogin && liveLogin.accountId === null ? liveLogin : null;

  return (
    <>
      {provider.error ? (
        <Alert
          variant="error"
          title={t("settings.accounts.errorTitle")}
          description={provider.error}
        />
      ) : null}
      {failure ? (
        <Alert variant="error" title={failure.title} description={failure.message}>
          <Button variant="outline" size="sm" onPress={onDismissFailure}>
            {t("settings.accounts.dismiss")}
          </Button>
        </Alert>
      ) : null}
      <View style={settingsStyles.card}>
        {unsavedLogin ? (
          <View style={styles.liveAccount} testID={`provider-account-live-${providerId}`}>
            <View style={styles.liveHeader}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle} numberOfLines={1}>
                  {unsavedLogin.email}
                </Text>
                <Text style={settingsStyles.rowHint}>
                  {[unsavedLogin.organizationName, unsavedLogin.planLabel]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
              <StatusBadge label={t("settings.accounts.active")} variant="success" />
            </View>
            <ProviderAccountUsage
              usage={unsavedLogin.usage}
              reloginRequired={!unsavedLogin.isUsable}
              providerLabel={displayName}
            />
          </View>
        ) : null}
        {!liveLogin && accounts.length === 0 ? (
          <View style={[settingsStyles.row, styles.emptyRow]}>
            <Text style={styles.emptyText}>
              {t("settings.accounts.notSignedIn", { provider: displayName })}
            </Text>
          </View>
        ) : null}
        {accounts.map((account, index) => (
          <ProviderAccountRow
            key={account.id}
            serverId={serverId}
            providerId={providerId}
            providerLabel={displayName}
            account={account}
            isFirst={index === 0 && !unsavedLogin}
            isSwitching={pendingSwitch === account.id}
            isRemoving={pendingRemove === account.id}
            onSwitch={onSwitch}
            onRemove={onRemove}
          />
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  liveAccount: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  liveHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  emptyCard: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  emptyRow: {
    justifyContent: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
}));
