import type { ModelBrowserView } from "@/components/model-browser-view";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";

export function resolveModelSheetOpening({
  canSwitchProvider,
  startAtSelectedProvider,
  providers,
  selectedProvider,
}: {
  canSwitchProvider: boolean;
  /**
   * Open at the selected provider's models even though switching is allowed.
   * A live agent lands on its own provider and reaches the others through the
   * back button; a draft lands on the provider list.
   */
  startAtSelectedProvider?: boolean;
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
}): ModelBrowserView {
  if (canSwitchProvider && !startAtSelectedProvider) return { kind: "all" };

  const provider = providers.find((entry) => entry.id === selectedProvider) ?? providers[0] ?? null;
  return provider
    ? { kind: "provider", providerId: provider.id, providerLabel: provider.label }
    : { kind: "all" };
}
