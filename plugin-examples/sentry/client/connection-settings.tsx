import { type PluginSurfaceProps, useRpc } from "@gravity/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@gravity/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Text } from "react-native";
import { type SentryStatus, statusRpc } from "../shared/contracts";
import { ConnectGuide } from "./connect-guide";
import { describeError } from "./format";
import { sentryKeys } from "./queries";
import { useDisconnect } from "./use-disconnect";

/** Settings → Plugins → Sentry → Connection. The settings shell owns scrolling and layout. */
export function ConnectionSettings({ theme, host }: PluginSurfaceProps) {
  const getStatus = useRpc(statusRpc);
  const status = useQuery({ queryKey: sentryKeys.status(), queryFn: () => getStatus({}) });
  const { refetch } = status;
  const reload = useCallback(() => void refetch(), [refetch]);
  const text = useMemo(() => ({ color: theme.colors.foreground }), [theme]);

  if (status.error) {
    return (
      <SettingsSection title="Connection">
        <SettingsCard>
          <SettingsRow label="Sentry is unreachable" error={describeError(status.error)} />
          <SettingsAction label="Check again" actionLabel="Retry" onPress={reload} />
        </SettingsCard>
      </SettingsSection>
    );
  }
  if (!status.data) return <Text style={text}>Loading…</Text>;
  if (status.data.state === "disconnected") {
    return <ConnectGuide theme={theme} hostLabel={host.label} />;
  }
  return <ConnectedSettings theme={theme} hostLabel={host.label} status={status.data} />;
}

function ConnectedSettings({
  theme,
  hostLabel,
  status,
}: {
  theme: PluginSurfaceProps["theme"];
  hostLabel: string;
  status: Extract<SentryStatus, { state: "connected" }>;
}) {
  const [replacing, setReplacing] = useState(false);
  const disconnect = useDisconnect();
  const { mutate } = disconnect;
  const forget = useCallback(() => mutate(), [mutate]);
  const toggleReplace = useCallback(() => setReplacing((current) => !current), []);
  const finishReplace = useCallback(() => setReplacing(false), []);
  const text = useMemo(() => ({ color: theme.colors.foreground }), [theme]);
  const saved = status.source === "saved";
  const organizations = status.organizations.map((organization) => organization.name).join(", ");
  return (
    <>
      <SettingsSection title="Connection">
        <SettingsCard>
          <SettingsRow label="Organizations">
            <Text style={text}>{organizations}</Text>
          </SettingsRow>
          <SettingsRow label="Sentry URL">
            <Text style={text}>{status.baseUrl}</Text>
          </SettingsRow>
          <SettingsRow
            label="Token"
            hint={
              saved
                ? `Saved on ${hostLabel}. It never reaches this app.`
                : "Set in the daemon environment. Change it there and restart the daemon."
            }
          >
            <Text style={text}>{saved ? "Personal token" : "SENTRY_AUTH_TOKEN"}</Text>
          </SettingsRow>
          {saved ? (
            <SettingsAction
              label="Use a different token"
              hint="For a new account or more permissions."
              actionLabel={replacing ? "Cancel" : "Replace"}
              onPress={toggleReplace}
            />
          ) : null}
          {saved ? (
            <SettingsAction
              label="Disconnect Sentry"
              hint="Deletes the saved token from this host."
              actionLabel="Disconnect"
              disabled={disconnect.isPending}
              onPress={forget}
            />
          ) : null}
        </SettingsCard>
      </SettingsSection>
      {replacing ? (
        <ConnectGuide theme={theme} hostLabel={hostLabel} onConnected={finishReplace} />
      ) : null}
    </>
  );
}
