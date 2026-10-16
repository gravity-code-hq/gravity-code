import { describe, expect, test } from "vitest";

import { MutableDaemonConfigPatchSchema, MutableDaemonConfigSchema } from "./messages.js";
import { ProviderOverrideSchema, ProviderGravityToolsPolicySchema } from "./provider-config.js";

describe("provider Gravity-tool policy", () => {
  test("accepts arbitrary tool IDs and leaves an empty policy enabled by default", () => {
    expect(
      ProviderGravityToolsPolicySchema.parse({
        disabledTools: ["future_tool", "browser_future_tool"],
      }),
    ).toEqual({
      disabledTools: ["future_tool", "browser_future_tool"],
    });
    expect(ProviderGravityToolsPolicySchema.parse({})).toEqual({});
    expect(ProviderOverrideSchema.parse({}).gravityTools).toBeUndefined();
  });

  test("accepts gravityTools on persisted provider overrides", () => {
    expect(
      ProviderOverrideSchema.parse({
        extends: "claude",
        gravityTools: {
          enabled: false,
          disabledTools: ["create_workspace"],
        },
      }).gravityTools,
    ).toEqual({
      enabled: false,
      disabledTools: ["create_workspace"],
    });
  });

  test("accepts gravityTools when reading and patching mutable daemon providers", () => {
    expect(
      MutableDaemonConfigSchema.parse({
        mcp: { injectIntoAgents: true },
        providers: {
          codex: {
            gravityTools: { enabled: false, disabledTools: ["future_tool"] },
          },
        },
      }).providers.codex?.gravityTools,
    ).toEqual({
      enabled: false,
      disabledTools: ["future_tool"],
    });

    expect(
      MutableDaemonConfigPatchSchema.parse({
        providers: {
          codex: {
            gravityTools: { disabledTools: ["browser_future_tool"] },
          },
        },
      }).providers?.codex?.gravityTools,
    ).toEqual({ disabledTools: ["browser_future_tool"] });
  });
});
