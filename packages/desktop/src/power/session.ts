export interface PowerLease {
  isActive(): Promise<boolean>;
  refresh(): Promise<void>;
  release(): Promise<void>;
}

interface PowerSessionDependencies {
  acquire(): Promise<PowerLease>;
  agentStatus(agentId: string): Promise<PowerAgentState | null>;
}

export interface PowerAgentState {
  status: string;
  lastUserMessageAt: string | null;
}

interface AgentHold {
  hasRun: boolean;
  lastUserMessageAt: string | null;
}

export class PowerSessionError extends Error {}

export function createPowerSession(deps: PowerSessionDependencies) {
  let lease: PowerLease | null = null;
  let global = false;
  let busy = false;
  let error: string | null = null;
  let closing = false;
  const agents = new Map<string, AgentHold>();
  const drafts = new Map<string, number>();
  let operation: Promise<unknown> = Promise.resolve();
  let queued = 0;

  function snapshot() {
    return {
      global,
      agentIds: [...agents.keys()],
      draftIds: [...drafts.keys()],
      active: lease !== null,
      busy,
      error,
    };
  }

  async function run(action: () => Promise<void>) {
    if (closing) throw new PowerSessionError("Gravity is quitting.");
    queued += 1;
    busy = true;
    error = null;
    const task = operation.catch(() => undefined).then(action);
    operation = task;
    try {
      await task;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    } finally {
      queued -= 1;
      busy = queued > 0;
    }
    return snapshot();
  }

  async function releaseIfUnused() {
    if (global || agents.size > 0 || drafts.size > 0 || !lease) return;
    await lease.release();
    lease = null;
  }

  return {
    snapshot,
    setDraft({ draftId, enabled }: { draftId: string; enabled: boolean }) {
      return run(async () => {
        if (enabled) {
          if (!lease) lease = await deps.acquire();
          drafts.set(draftId, Date.now() + 15 * 60_000);
        } else drafts.delete(draftId);
        await releaseIfUnused();
      });
    },
    transferDraft({ draftId, agentId }: { draftId: string; agentId: string }) {
      return run(async () => {
        if (!drafts.has(draftId)) return;
        agents.set(agentId, { hasRun: true, lastUserMessageAt: null });
        drafts.delete(draftId);
      });
    },
    setGlobal({ enabled }: { enabled: boolean }) {
      return run(async () => {
        if (enabled && !lease) lease = await deps.acquire();
        global = enabled;
        await releaseIfUnused();
      });
    },
    setAgent({ agentId, enabled }: { agentId: string; enabled: boolean }) {
      return run(async () => {
        if (enabled) {
          const agent = await deps.agentStatus(agentId);
          if (agent === null) throw new PowerSessionError("The local agent is unavailable.");
          if (!lease) lease = await deps.acquire();
          agents.set(agentId, {
            hasRun: agent.status === "running" || agent.status === "initializing",
            lastUserMessageAt: agent.lastUserMessageAt,
          });
        } else {
          agents.delete(agentId);
        }
        await releaseIfUnused();
      });
    },
    async tick() {
      if (busy || closing || !lease) return;
      await run(async () => {
        if (!lease) return;
        if (!(await lease.isActive())) {
          await lease.release();
          lease = null;
          global = false;
          agents.clear();
          drafts.clear();
          return;
        }
        await lease.refresh();
        for (const [id, deadline] of drafts) {
          if (Date.now() >= deadline) drafts.delete(id);
        }
        const statuses = await Promise.all(
          [...agents].map(async ([id, hold]) => ({ id, hold, agent: await deps.agentStatus(id) })),
        );
        for (const { id, hold, agent } of statuses) {
          if (!agent) {
            agents.delete(id);
            continue;
          }
          if (agent.status === "running" || agent.status === "initializing") {
            hold.hasRun = true;
          } else if (
            hold.hasRun ||
            agent.lastUserMessageAt !== hold.lastUserMessageAt ||
            agent.status === "error" ||
            agent.status === "closed" ||
            agent.status === "permission"
          ) {
            agents.delete(id);
          }
        }
        await releaseIfUnused();
      });
    },
    async close() {
      closing = true;
      await operation.catch(() => undefined);
      global = false;
      agents.clear();
      drafts.clear();
      await releaseIfUnused();
    },
  };
}
