import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";

/**
 * Providers a live agent's model picker offers. The agent's own provider keeps
 * its entry (which may be a fallback built from the agent's known models while
 * the snapshot loads); every other runnable provider follows so picking one of
 * its models switches agents through a fork.
 */
export function resolveSwitchableProviders(input: {
  current: ProviderSelectorProvider[];
  all: ProviderSelectorProvider[];
}): ProviderSelectorProvider[] {
  const seen = new Set(input.current.map((provider) => provider.id));
  const others = input.all.filter((provider) => {
    if (seen.has(provider.id)) return false;
    seen.add(provider.id);
    return true;
  });
  return others.length > 0 ? [...input.current, ...others] : input.current;
}
