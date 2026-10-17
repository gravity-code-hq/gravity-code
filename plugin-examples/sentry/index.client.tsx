import type { PluginClientContext } from "@gravity/plugin/client";
import { ConnectionSettings } from "./client/connection-settings";
import { SentryScreen } from "./client/sentry-screen";

export default function contribute(client: PluginClientContext) {
  client.addSurface("issues", SentryScreen);
  client.addSidebarItem({ id: "issues", title: "Sentry", icon: "Bug", surface: "issues" });
  client.addSettingsScreen({
    id: "connection",
    title: "Connection",
    icon: "PlugZap",
    Component: ConnectionSettings,
  });
  client.addCommandCenterItem({
    id: "open-issues",
    title: "Open Sentry issues",
    icon: "Bug",
    keywords: ["sentry", "errors", "crash"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("issues");
    },
  });
  client.addCommandCenterItem({
    id: "connect",
    title: "Connect Sentry",
    icon: "PlugZap",
    keywords: ["sentry", "token", "auth"],
    context: "global",
    onSelect({ openSettings }) {
      openSettings("connection");
    },
  });
  return () => {};
}
