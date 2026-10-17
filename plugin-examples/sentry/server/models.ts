import type { RpcOutput } from "@gravity/plugin";
import type { PluginHandlerContext } from "@gravity/plugin/server";
import type { listModelsRpc, SentryModelOption } from "../shared/contracts";

const PROVIDER_WAIT_MS = 15_000;

/**
 * Lists the models the start dialog can offer. This runs on the daemon because
 * the app's connection receives provider snapshots in compact wire form.
 */
export async function listModels(
  _input: unknown,
  { gravity }: PluginHandlerContext,
): Promise<RpcOutput<typeof listModelsRpc>> {
  const snapshot = await gravity.providers
    .waitForReady({ timeoutMs: PROVIDER_WAIT_MS })
    .catch(() => gravity.providers.snapshot());
  const models: SentryModelOption[] = [];
  for (const entry of snapshot.entries) {
    if (entry.enabled === false || entry.status !== "ready") continue;
    const providerLabel = entry.label ?? entry.provider;
    for (const model of entry.models ?? []) {
      if (model.isSelectable === false) continue;
      models.push({
        id: `${entry.provider}/${model.id}`,
        label: model.label,
        providerLabel,
        isDefault: model.isDefault === true,
      });
    }
  }
  return { models };
}
