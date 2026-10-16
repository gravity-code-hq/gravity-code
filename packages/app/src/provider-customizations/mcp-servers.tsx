import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { RotateCw } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type {
  ProviderMcpServer,
  ProviderMcpServerStatus,
} from "@gravity/protocol/provider-mcp-servers";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external-link";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SelectField } from "@/components/ui/select-field";
import { useFetchQuery } from "@/data/query";
import { useHostProjects, getHostProjectSourceDirectory } from "@/projects/host-projects";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import { formatTimeAgo } from "@/utils/time";

const CLAUDE_AI_CONNECTORS_URL = "https://claude.ai/settings/connectors";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

export function ProviderMcpServers(props: { serverId: string; provider: "codex" | "claude" }) {
  const { t } = useTranslation();
  const connected = useHostRuntimeIsConnected(props.serverId);
  if (!connected) {
    return <Text style={styles.muted}>{t("common.errors.daemonClientDisconnected")}</Text>;
  }
  return <ConnectedMcpServers {...props} />;
}

function ConnectedMcpServers({
  serverId,
  provider,
}: {
  serverId: string;
  provider: "codex" | "claude";
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const hostIds = useMemo(() => [serverId], [serverId]);
  const projects = useHostProjects(hostIds);
  const [scope, setScope] = useState("");
  // Claude Code merges project-scoped servers only when run inside that
  // project, so the scope picker chooses the directory the probe runs in.
  const options = [
    { id: "personal", value: "", label: t("providerCustomizations.personal") },
    ...projects.flatMap((project) => {
      const cwd = getHostProjectSourceDirectory(project, serverId);
      return cwd
        ? [{ id: project.viewKey, value: project.viewKey, label: project.projectName }]
        : [];
    }),
  ];
  const project = projects.find((entry) => entry.viewKey === scope);
  const cwd = project ? (getHostProjectSourceDirectory(project, serverId) ?? undefined) : undefined;

  const query = useFetchQuery({
    dataShape: "value",
    queryKey: ["provider-mcp-servers", serverId, provider, cwd ?? null],
    queryFn: () => {
      if (!client) throw new Error(t("common.errors.daemonClientUnavailable"));
      return client.listProviderMcpServers({ provider, cwd });
    },
    enabled: client !== null,
    staleTimeMs: 60_000,
    retry: false,
  });
  const refresh = useCallback(() => {
    void query.refetch();
  }, [query]);
  const updatedAt = query.dataUpdatedAt ? formatTimeAgo(new Date(query.dataUpdatedAt)) : null;

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        {provider === "claude" ? (
          <View style={styles.scope}>
            <SelectField
              label={t("providerCustomizations.scope")}
              field={false}
              size="sm"
              value={scope}
              options={options}
              selectedDisplay={options.find((entry) => entry.value === scope) ?? options[0]}
              onChange={setScope}
              placeholder={t("providerCustomizations.scope")}
              emptyText={t("common.empty.noResults")}
              testID="provider-mcp-scope"
            />
          </View>
        ) : (
          <View style={styles.scope} />
        )}
        {updatedAt ? (
          <Text style={styles.updated}>
            {t("providerCustomizations.mcp.updated", { time: updatedAt })}
          </Text>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          leftIcon={RotateCw}
          loading={query.isFetching}
          disabled={query.isFetching}
          accessibilityLabel={t("settings.providers.diagnostic.refresh")}
          onPress={refresh}
          testID="provider-mcp-refresh"
        />
      </View>

      {query.isPending ? (
        <View style={styles.pending}>
          <ThemedLoadingSpinner />
          <Text style={styles.muted}>{t("providerCustomizations.mcp.checking")}</Text>
        </View>
      ) : null}
      {query.error ? (
        <View style={styles.container}>
          <Text style={styles.error}>{query.error.message}</Text>
          <Button size="sm" variant="outline" onPress={refresh}>
            {t("common.actions.retry")}
          </Button>
        </View>
      ) : null}
      {query.data?.warnings.map((warning) => (
        <Text key={warning} style={styles.muted}>
          {warning}
        </Text>
      ))}
      {query.data && !query.data.healthChecked ? (
        <Text style={styles.muted}>{t("providerCustomizations.mcp.notHealthChecked")}</Text>
      ) : null}
      {query.data && query.data.servers.length === 0 ? (
        <Text style={styles.muted} testID="provider-mcp-empty">
          {t("providerCustomizations.mcp.empty")}
        </Text>
      ) : null}
      {query.data && query.data.servers.length > 0 ? (
        <View style={settingsStyles.card} testID="provider-mcp-list">
          {query.data.servers.map((server, index) => (
            <McpServerRow key={server.name} server={server} bordered={index > 0} />
          ))}
        </View>
      ) : null}

      <ConnectMoreSection provider={provider} />
    </View>
  );
}

function McpServerRow({ server, bordered }: { server: ProviderMcpServer; bordered: boolean }) {
  const { t } = useTranslation();
  const scopeLabel =
    server.scope === "unknown" ? null : t(`providerCustomizations.mcp.scope.${server.scope}`);
  return (
    <View style={[styles.row, bordered && settingsStyles.rowBorder]}>
      <View style={styles.rowHeader}>
        <StatusDot status={server.status} />
        <Text style={styles.title} numberOfLines={1}>
          {server.name}
        </Text>
        <Text style={styles.status}>{t(`providerCustomizations.mcp.status.${server.status}`)}</Text>
      </View>
      <View style={styles.rowMeta}>
        {scopeLabel ? <Text style={styles.metaText}>{scopeLabel}</Text> : null}
        {server.endpoint ? (
          <Text style={styles.endpoint} numberOfLines={1}>
            {server.endpoint}
          </Text>
        ) : null}
      </View>
      {server.detail && server.status !== "connected" && server.status !== "configured" ? (
        <Text style={styles.metaText}>{server.detail}</Text>
      ) : null}
    </View>
  );
}

function StatusDot({ status }: { status: ProviderMcpServerStatus }) {
  return <View style={[styles.dot, DOT_STYLE_BY_STATUS[status]]} />;
}

function ConnectMoreSection({ provider }: { provider: "codex" | "claude" }) {
  const { t } = useTranslation();
  return (
    <View style={styles.connect} testID="provider-mcp-connect">
      <Text style={styles.connectTitle}>{t("providerCustomizations.mcp.connectTitle")}</Text>
      {provider === "claude" ? (
        <>
          <Text style={styles.muted}>{t("providerCustomizations.mcp.claudeConnectors")}</Text>
          <ExternalLink
            href={CLAUDE_AI_CONNECTORS_URL}
            label={t("providerCustomizations.mcp.claudeConnectorsLink")}
            testID="provider-mcp-claude-connectors"
          />
          <Text style={styles.muted}>{t("providerCustomizations.mcp.claudeLocal")}</Text>
          <CommandLine text="claude mcp add --transport http <name> <url>" />
        </>
      ) : (
        <>
          <Text style={styles.muted}>{t("providerCustomizations.mcp.codexAdd")}</Text>
          <CommandLine text="codex mcp add <name> --url <url>" />
          <Text style={styles.muted}>{t("providerCustomizations.mcp.codexLogin")}</Text>
          <CommandLine text="codex mcp login <name>" />
        </>
      )}
      <Text style={styles.muted}>{t("providerCustomizations.mcp.thenRefresh")}</Text>
    </View>
  );
}

function CommandLine({ text }: { text: string }) {
  return (
    <View style={styles.command}>
      <Text style={styles.commandText} selectable>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { gap: theme.spacing[4] },
  toolbar: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  scope: { flex: 1, minWidth: 0 },
  updated: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  pending: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  row: { padding: theme.spacing[4], gap: theme.spacing[2] },
  rowHeader: { flexDirection: "row", gap: theme.spacing[3], alignItems: "center" },
  rowMeta: { flexDirection: "row", gap: theme.spacing[3], alignItems: "center", minWidth: 0 },
  title: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.base },
  status: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  metaText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  endpoint: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotSuccess: { backgroundColor: theme.colors.statusSuccess },
  dotDanger: { backgroundColor: theme.colors.statusDanger },
  dotWarning: { backgroundColor: theme.colors.statusWarning },
  dotNeutral: { backgroundColor: theme.colors.foregroundMuted },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.base },
  connect: { gap: theme.spacing[3], paddingTop: theme.spacing[2] },
  connectTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  command: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    alignSelf: "flex-start",
  },
  commandText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
  },
}));

const DOT_STYLE_BY_STATUS: Record<ProviderMcpServerStatus, object> = {
  connected: styles.dotSuccess,
  failed: styles.dotDanger,
  pending_approval: styles.dotWarning,
  disabled: styles.dotNeutral,
  configured: styles.dotNeutral,
  unknown: styles.dotNeutral,
};
