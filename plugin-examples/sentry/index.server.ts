import type { PluginServerContext } from "@gravity/plugin/server";
import { createCredentialStore, defaultCredentialsPath } from "./server/credentials";
import { listModels } from "./server/models";
import { createSentryService } from "./server/service";
import {
  connectRpc,
  disconnectRpc,
  getIssueRpc,
  listIssuesRpc,
  listModelsRpc,
  listProjectsRpc,
  statusRpc,
} from "./shared/contracts";
import { browsePreferences, startPreferences } from "./shared/preferences";

export default function contribute(server: PluginServerContext) {
  const sentry = createSentryService({
    store: createCredentialStore(defaultCredentialsPath()),
  });
  server.registerSettings(startPreferences);
  server.registerSettings(browsePreferences);
  server.handle(statusRpc, () => sentry.status());
  server.handle(connectRpc, (input) => sentry.connect(input));
  server.handle(disconnectRpc, () => sentry.disconnect());
  server.handle(listProjectsRpc, (input) => sentry.listProjects(input));
  server.handle(listIssuesRpc, (input) => sentry.listIssues(input));
  server.handle(getIssueRpc, (input) => sentry.getIssue(input));
  server.handle(listModelsRpc, listModels);
  return () => {};
}
