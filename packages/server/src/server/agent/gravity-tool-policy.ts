import type { ProviderGravityToolsPolicy } from "@gravity/protocol/provider-config";

interface ProviderGravityToolSettings {
  gravityTools?: ProviderGravityToolsPolicy;
}

export function resolveGravityToolPolicy(
  providerId: string,
  providerSettings: Readonly<Record<string, ProviderGravityToolSettings>> | undefined,
): ProviderGravityToolsPolicy | undefined {
  return providerSettings?.[providerId]?.gravityTools;
}

export function isGravityToolEnabled(
  policy: ProviderGravityToolsPolicy | undefined,
  toolName: string,
): boolean {
  if (toolName === "speak") {
    return true;
  }
  if (!isGravityToolPolicyEnabled(policy)) {
    return false;
  }
  return !policy?.disabledTools?.includes(toolName);
}

export function isGravityToolPolicyEnabled(
  policy: ProviderGravityToolsPolicy | undefined,
): boolean {
  return policy?.enabled !== false;
}
