import { describe, expect, it } from "vitest";
import { availableStarterTriggerConnections } from "./starter-trigger.js";

describe("starter trigger connections", () => {
  it("returns only concrete connections that can back the generated trigger", () => {
    expect(
      availableStarterTriggerConnections(
        {
          github: [
            {
              slug: "github-gravity-code-hq",
              accountLogin: "gravity-code-hq",
              accountType: "Organization",
              repositories: ["gravity-code-hq/gravity"],
            },
          ],
          slack: [{ slug: "gravity", teamName: "Gravity" }],
          discord: [{ slug: "gravity-discord", guildName: "Gravity Discord" }],
          daemons: [],
          linear: [],
        },
        "gravity-code-hq/gravity",
      ),
    ).toEqual([
      {
        id: "github:gravity-code-hq/gravity",
        label: "GitHub — gravity-code-hq/gravity",
        provider: "github",
        filters: { connection: "github-gravity-code-hq", repo: "gravity-code-hq/gravity" },
      },
      {
        id: "slack:gravity",
        label: "Slack — Gravity",
        provider: "slack",
        filters: { connection: "gravity" },
      },
      {
        id: "discord:gravity-discord",
        label: "Discord — Gravity Discord",
        provider: "discord",
        filters: { connection: "gravity-discord" },
      },
    ]);
  });

  it("does not offer GitHub when the current repository is not connected", () => {
    expect(
      availableStarterTriggerConnections(
        {
          github: [
            {
              slug: "github-gravity-code-hq",
              accountLogin: "gravity-code-hq",
              accountType: "Organization",
              repositories: ["gravity-code-hq/hub"],
            },
          ],
          slack: [],
          discord: [],
          daemons: [],
          linear: [],
        },
        "gravity-code-hq/gravity",
      ),
    ).toEqual([]);
  });
});
