import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestGravityDaemon, type TestGravityDaemon } from "../test-utils/gravity-daemon.js";
import {
  canRunRealProvider,
  createRealProviderClients,
  getRealProviderConfig,
  type RealProvider,
} from "./real-provider-test-config.js";

const TURN_TIMEOUT_MS = 180_000;
const SUGGESTION_TIMEOUT_MS = 120_000;

describe.each(["codex", "claude"] as const satisfies readonly RealProvider[])(
  "daemon E2E (real %s) - prompt suggestions",
  (provider) => {
    let canRun = false;
    let daemon: TestGravityDaemon | undefined;
    let client: DaemonClient | undefined;
    let cwd: string | undefined;

    beforeAll(async () => {
      canRun = await canRunRealProvider(provider);
      if (!canRun) {
        return;
      }
      const logger = pino({ level: "silent" });
      daemon = await createTestGravityDaemon({
        agentClients: createRealProviderClients([provider], logger),
        logger,
      });
      client = new DaemonClient({
        url: `ws://127.0.0.1:${daemon.port}/ws`,
        appVersion: "0.1.70",
      });
      await client.connect();
      await client.fetchAgents({ subscribe: {} });
      cwd = mkdtempSync(path.join(tmpdir(), `daemon-real-${provider}-prompt-suggestions-`));
    }, 30_000);

    afterAll(async () => {
      await client?.close().catch(() => undefined);
      await daemon?.close().catch(() => undefined);
      if (cwd) rmSync(cwd, { recursive: true, force: true });
    });

    beforeEach((context) => {
      if (!canRun) {
        context.skip();
      }
    });

    test(
      "suggests a next message from the agent's own provider once its turn ends",
      async () => {
        if (!client || !cwd) throw new Error("Prompt suggestion harness was not initialized");
        const agent = await client.createAgent({
          cwd,
          title: `${provider}-prompt-suggestions-real`,
          ...getRealProviderConfig(provider),
        });

        await client.sendMessage(
          agent.id,
          [
            "Do not use any tools.",
            "Say that the login test is fixed, then ask me whether you should also update the README.",
          ].join(" "),
        );
        const finish = await client.waitForFinish(agent.id, TURN_TIMEOUT_MS);
        expect(finish.status).toBe("idle");

        const first = await client.getAgentPromptSuggestion(agent.id, {
          timeout: SUGGESTION_TIMEOUT_MS,
        });
        const second = await client.getAgentPromptSuggestion(agent.id);

        expect(first.error).toBeNull();
        expect(first.turnKey).toMatch(/:\d+$/);
        expect(first.suggestion?.trim().length ?? 0).toBeGreaterThan(0);
        expect(first.suggestion?.includes("\n")).toBe(false);
        expect(second).toEqual({ ...first, requestId: second.requestId });

        const agents = await client.fetchAgents();
        const visibleIds = agents.entries.map((entry) => entry.agent.id);
        expect(visibleIds).toEqual([agent.id]);
      },
      TURN_TIMEOUT_MS + SUGGESTION_TIMEOUT_MS,
    );
  },
);
