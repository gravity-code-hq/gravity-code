import { ipcMain, powerSaveBlocker, type IpcMainInvokeEvent } from "electron";
import log from "electron-log/main";
import { resolveGravityHome } from "@gravity/server";
import { z } from "zod";
import { createIdleHold } from "./idle-hold.js";
import { acquireMacPowerLease } from "./macos.js";
import { createPowerSession, PowerSessionError } from "./session.js";

const PowerCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get") }),
  z.object({ action: z.literal("global"), enabled: z.boolean() }),
  z.object({
    action: z.literal("draft"),
    enabled: z.boolean(),
    draftId: z.string().min(1).max(200),
    serverId: z.string().min(1),
  }),
  z.object({
    action: z.literal("transfer"),
    draftId: z.string().min(1).max(200),
    agentId: z.string().uuid(),
    serverId: z.string().min(1),
  }),
  z.object({
    action: z.literal("agent"),
    enabled: z.boolean(),
    agentId: z.string().uuid(),
    serverId: z.string().min(1),
  }),
]);

type LocalClient = Awaited<
  ReturnType<typeof import("@gravity/cli/dist/utils/client.js").connectToDaemon>
>;
let client: LocalClient | null = null;
let connecting: Promise<LocalClient> | null = null;

async function getLocalClient() {
  if (client) return client;
  connecting ??= (async () => {
    const { connectToDaemon } = await import("@gravity/cli/dist/utils/client.js");
    client = await connectToDaemon({
      target: { kind: "instance", home: resolveGravityHome(process.env) },
      timeout: 5_000,
    });
    return client;
  })();
  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

async function closeClient() {
  const previous = client;
  client = null;
  if (previous) await previous.close();
}

const power = createPowerSession({
  acquire: acquireMacPowerLease,
  async agentStatus(agentId) {
    const local = await getLocalClient();
    const result = await local.fetchAgent({ agentId, timeout: 5_000 });
    if (!result || result.agent.archivedAt) return null;
    const status = result.agent.pendingPermissions.length > 0 ? "permission" : result.agent.status;
    return { status, lastUserMessageAt: result.agent.lastUserMessageAt };
  },
});

const idleHold = createIdleHold({
  start: () => powerSaveBlocker.start("prevent-app-suspension"),
  stop: (id) => powerSaveBlocker.stop(id),
  isStarted: (id) => powerSaveBlocker.isStarted(id),
});

// Agents that are working and not waiting on the user. A pending permission means
// the agent is blocked on a human, so holding the machine awake for it is waste.
async function countWorkingLocalAgents() {
  const local = await getLocalClient();
  const result = await local.fetchAgents({
    filter: { statuses: ["running", "initializing"] },
    page: { limit: 200 },
    timeout: 5_000,
  });
  return result.entries.filter(
    (entry) => !entry.agent.archivedAt && entry.agent.pendingPermissions.length === 0,
  ).length;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let stopped = false;
let daemonUnreachable = false;

async function tick() {
  try {
    await power.tick().catch((error) => {
      log.error("[power] Sleep hold could not be refreshed", error);
    });
    const working = await countWorkingLocalAgents();
    idleHold.set(working > 0);
    if (daemonUnreachable) {
      daemonUnreachable = false;
      log.info("[power] Local daemon reachable again; idle hold resumed");
    }
  } catch (error) {
    idleHold.set(false);
    if (!daemonUnreachable) {
      daemonUnreachable = true;
      log.warn("[power] Local daemon unreachable; idle hold paused until it returns", error);
    }
    await closeClient().catch((closeError) => log.error("[power] Client close failed", closeError));
  } finally {
    if (!stopped) timer = setTimeout(() => void tick(), 5_000);
  }
}

export function registerPowerControl(isTrusted: (event: IpcMainInvokeEvent) => boolean) {
  ipcMain.handle("gravity:power", async (event, raw: unknown) => {
    if (process.platform !== "darwin" || !isTrusted(event)) {
      throw new PowerSessionError("Power control is unavailable for this window.");
    }
    const input = PowerCommandSchema.parse(raw);
    if (input.action === "get") return power.snapshot();
    if (input.action === "global") return power.setGlobal({ enabled: input.enabled });
    if (input.action === "agent" && !input.enabled) return power.setAgent(input);
    if (input.action === "draft" && !input.enabled) return power.setDraft(input);
    if (input.action === "transfer" && !power.snapshot().draftIds.includes(input.draftId))
      return power.snapshot();
    const local = await getLocalClient();
    if (local.getLastServerInfoMessage()?.serverId !== input.serverId) {
      if (input.action === "transfer")
        return power.setDraft({ draftId: input.draftId, enabled: false });
      throw new PowerSessionError("Only agents running on this Mac can keep it awake.");
    }
    if (input.action === "draft") return power.setDraft(input);
    if (input.action === "transfer") return power.transferDraft(input);
    return power.setAgent(input);
  });
  timer = setTimeout(() => void tick(), 5_000);
}

export async function closePowerControl() {
  stopped = true;
  if (timer) clearTimeout(timer);
  idleHold.close();
  await power.close();
  await closeClient();
}
