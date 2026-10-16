import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useFetchQuery } from "@/data/query";
import { Plus, RotateCw } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ProviderCustomization } from "@gravity/protocol/provider-customizations";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { SelectField } from "@/components/ui/select-field";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import {
  useHostProjects,
  getHostProjectSourceDirectory,
  getHostProjectId,
} from "@/projects/host-projects";
import { settingsStyles } from "@/styles/settings";
import { CustomizationDetail } from "./settings-detail";
import { CreateCommandSheet } from "./create-command-sheet";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

export function ProviderCustomizations(props: {
  serverId: string;
  provider: "codex" | "claude";
  kind: "command" | "skill";
}) {
  const { t } = useTranslation();
  const connected = useHostRuntimeIsConnected(props.serverId);
  // COMPAT(providerCustomizations): added in v0.8.0, remove gate after 2027-03-29 once the daemon floor supports it.
  const supported = useHostFeature(props.serverId, "providerCustomizations");
  if (!connected)
    return <Text style={styles.muted}>{t("common.errors.daemonClientDisconnected")}</Text>;
  if (!supported) return <Text style={styles.muted}>{t("providerCustomizations.updateHost")}</Text>;
  return <ConnectedCustomizations {...props} />;
}

function ConnectedCustomizations({
  serverId,
  provider,
  kind,
}: {
  serverId: string;
  provider: "codex" | "claude";
  kind: "command" | "skill";
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const hostIds = useMemo(() => [serverId], [serverId]);
  const projects = useHostProjects(hostIds);
  const [scope, setScope] = useState("");
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
  return (
    <View style={styles.container}>
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
        testID="provider-customizations-scope"
      />
      <CustomizationList
        key={`${scope}:${kind}`}
        serverId={serverId}
        provider={provider}
        kind={kind}
        cwd={cwd}
        projectId={project ? (getHostProjectId(project, serverId) ?? undefined) : undefined}
        projectName={project?.projectName}
        client={client}
      />
    </View>
  );
}

function CustomizationList({
  serverId,
  provider,
  kind,
  cwd,
  projectId,
  projectName,
  client,
}: {
  serverId: string;
  provider: "codex" | "claude";
  kind: "command" | "skill";
  cwd?: string;
  projectId?: string;
  projectName?: string;
  client: ReturnType<typeof useHostRuntimeClient>;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ProviderCustomization | null>(null);
  const [creating, setCreating] = useState(false);
  // COMPAT(providerCommandCreation): added in v0.8.0, remove gate after 2027-03-30 once the daemon floor supports it.
  const canCreate = useHostFeature(serverId, "providerCommandCreation");
  const query = useFetchQuery({
    dataShape: "value",
    queryKey: ["provider-customizations", serverId, provider, cwd ?? null],
    queryFn: () => {
      if (!client) throw new Error(t("common.errors.daemonClientUnavailable"));
      return client.listProviderCustomizations({ provider, cwd });
    },
    enabled: client !== null,
    staleTimeMs: 30_000,
    retry: false,
  });
  const needle = search.trim().toLocaleLowerCase();
  const refresh = useCallback(() => {
    void query.refetch();
  }, [query]);
  const closeDetail = useCallback(() => setSelected(null), []);
  const openCreate = useCallback(() => setCreating(true), []);
  const closeCreate = useCallback(() => setCreating(false), []);
  const commandCreated = useCallback(() => {
    setCreating(false);
    refresh();
  }, [refresh]);
  const emptyKey =
    kind === "command" ? "providerCustomizations.noCommands" : "providerCustomizations.noSkills";
  const entries = (query.data?.entries ?? []).filter(
    (entry) =>
      entry.kind === kind &&
      `${entry.name} ${entry.description}`.toLocaleLowerCase().includes(needle),
  );
  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder={t(
            kind === "command"
              ? "providerCustomizations.searchCommands"
              : "providerCustomizations.searchSkills",
          )}
          clearAccessibilityLabel={t("sessions.actions.clearSearch")}
        />
        {kind === "command" && canCreate && (provider === "claude" || !cwd) ? (
          <Button
            size="sm"
            variant="secondary"
            leftIcon={Plus}
            onPress={openCreate}
            disabled={!client}
          >
            {t("providerCustomizations.addCommand")}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          leftIcon={RotateCw}
          loading={query.isFetching}
          disabled={query.isFetching}
          accessibilityLabel={t("settings.providers.diagnostic.refresh")}
          onPress={refresh}
        />
      </View>
      {query.isPending ? <ThemedLoadingSpinner /> : null}
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
      {query.data && entries.length === 0 ? (
        <Text style={styles.muted}>{t(needle ? "common.empty.noResults" : emptyKey)}</Text>
      ) : null}
      {entries.length > 0 ? (
        <View style={settingsStyles.card}>
          {entries.map((entry, index) => (
            <CustomizationRow
              key={entry.id}
              entry={entry}
              bordered={index > 0}
              onSelect={setSelected}
            />
          ))}
        </View>
      ) : null}
      {selected ? (
        <CustomizationDetail
          key={selected.id}
          entry={selected}
          serverId={serverId}
          provider={provider}
          cwd={cwd}
          projectId={projectId}
          projectName={projectName}
          onClose={closeDetail}
          onSaved={refresh}
        />
      ) : null}
      {creating && client ? (
        <CreateCommandSheet
          client={client}
          provider={provider}
          cwd={cwd}
          onClose={closeCreate}
          onCreated={commandCreated}
        />
      ) : null}
    </View>
  );
}

function CustomizationRow({
  entry,
  bordered,
  onSelect,
}: {
  entry: ProviderCustomization;
  bordered: boolean;
  onSelect(entry: ProviderCustomization): void;
}) {
  const { t } = useTranslation();
  const select = useCallback(() => onSelect(entry), [entry, onSelect]);
  const rowStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.row,
      bordered && settingsStyles.rowBorder,
      pressed && styles.pressed,
    ],
    [bordered],
  );
  return (
    <Pressable accessibilityRole="button" onPress={select} style={rowStyle}>
      <View style={styles.rowHeader}>
        <Text style={styles.title}>
          {entry.kind === "command" ? "/" : ""}
          {entry.name}
        </Text>
        <Text style={styles.source}>{t(`providerCustomizations.${entry.source}`)}</Text>
      </View>
      {entry.description ? (
        <Text style={styles.muted} numberOfLines={2}>
          {entry.description}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { gap: theme.spacing[4] },
  toolbar: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  row: { padding: theme.spacing[4], gap: theme.spacing[2] },
  rowHeader: { flexDirection: "row", gap: theme.spacing[3], alignItems: "center" },
  title: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.base },
  source: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.base },
  pressed: { backgroundColor: theme.colors.interactionHighlight },
}));
