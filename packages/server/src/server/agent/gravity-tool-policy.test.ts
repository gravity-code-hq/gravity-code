import { describe, expect, test } from "vitest";
import type { ProviderGravityToolsPolicy } from "@gravity/protocol/provider-config";

import { isGravityToolEnabled, resolveGravityToolPolicy } from "./gravity-tool-policy.js";

describe("Gravity tool policy", () => {
  test("defaults to all Gravity tools and resolves only the exact provider ID", () => {
    const customPolicy = {
      enabled: true,
      disabledTools: ["list_agents"],
    } satisfies ProviderGravityToolsPolicy;

    expect(
      resolveGravityToolPolicy("custom-claude", {
        claude: { gravityTools: { enabled: false } },
        "custom-claude": { gravityTools: customPolicy },
      }),
    ).toBe(customPolicy);
    expect(
      resolveGravityToolPolicy("other-custom", { claude: { gravityTools: customPolicy } }),
    ).toBe(undefined);
    expect(isGravityToolEnabled(undefined, "list_agents")).toBe(true);
  });

  test("applies the provider gate and sparse disabled tools without filtering speak", () => {
    expect(isGravityToolEnabled({ enabled: false }, "list_agents")).toBe(false);
    expect(isGravityToolEnabled({ enabled: false }, "speak")).toBe(true);
    expect(
      isGravityToolEnabled({ enabled: true, disabledTools: ["list_agents"] }, "list_agents"),
    ).toBe(false);
    expect(
      isGravityToolEnabled({ enabled: true, disabledTools: ["list_agents"] }, "create_agent"),
    ).toBe(true);
  });
});
