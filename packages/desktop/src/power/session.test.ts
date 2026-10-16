import { expect, test } from "vitest";
import { createPowerSession, type PowerLease } from "./session.js";

test("one completed agent cannot release another agent's sleep hold", async () => {
  let releases = 0;
  const lease: PowerLease = {
    isActive: async () => true,
    refresh: async () => {},
    release: async () => {
      releases += 1;
    },
  };
  const statuses = new Map([
    ["a", "running"],
    ["b", "running"],
  ]);
  const session = createPowerSession({
    acquire: async () => lease,
    agentStatus: async (id) => {
      const status = statuses.get(id);
      return status ? { status, lastUserMessageAt: null } : null;
    },
  });
  await session.setAgent({ agentId: "a", enabled: true });
  await session.setAgent({ agentId: "b", enabled: true });
  statuses.set("a", "idle");
  await session.tick();
  expect(session.snapshot().agentIds).toEqual(["b"]);
  expect(releases).toBe(0);
  statuses.set("b", "idle");
  await session.tick();
  expect(releases).toBe(1);
  expect(session.snapshot().active).toBe(false);
});

function fixture() {
  let active = true;
  let releases = 0;
  let acquires = 0;
  let failAcquire = false;
  let failRelease = false;
  const statuses = new Map<string, string>([["agent", "idle"]]);
  const session = createPowerSession({
    async acquire() {
      acquires += 1;
      if (failAcquire) throw new Error("Authorization cancelled");
      return {
        isActive: async () => active,
        refresh: async () => {},
        async release() {
          if (failRelease) throw new Error("Restoration failed");
          releases += 1;
        },
      };
    },
    agentStatus: async (id) => {
      const status = statuses.get(id);
      return status ? { status, lastUserMessageAt: null } : null;
    },
  });
  return {
    session,
    statuses,
    counts: () => ({ releases, acquires }),
    expire: () => {
      active = false;
    },
    deny: () => {
      failAcquire = true;
    },
    allow: () => {
      failAcquire = false;
    },
    failRestore: () => {
      failRelease = true;
    },
    allowRestore: () => {
      failRelease = false;
    },
  };
}

test("denied authorization stays off, exposes the error, and allows retry", async () => {
  const f = fixture();
  f.deny();
  await expect(f.session.setGlobal({ enabled: true })).rejects.toThrow("Authorization cancelled");
  expect(f.session.snapshot()).toMatchObject({
    global: false,
    active: false,
    busy: false,
    error: "Authorization cancelled",
  });
  f.allow();
  await f.session.setGlobal({ enabled: true });
  expect(f.session.snapshot()).toMatchObject({ global: true, active: true, error: null });
});

test("global mode keeps working after the selected agent finishes", async () => {
  const f = fixture();
  f.statuses.set("agent", "running");
  await f.session.setAgent({ agentId: "agent", enabled: true });
  await f.session.setGlobal({ enabled: true });
  f.statuses.set("agent", "idle");
  await f.session.tick();
  expect(f.session.snapshot()).toMatchObject({ active: true, global: true, agentIds: [] });
  expect(f.counts()).toEqual({ acquires: 1, releases: 0 });
  await f.session.setGlobal({ enabled: false });
  expect(f.counts().releases).toBe(1);
});

test("an idle agent stays armed until its next run finishes", async () => {
  const f = fixture();
  await f.session.setAgent({ agentId: "agent", enabled: true });
  await f.session.tick();
  expect(f.session.snapshot().active).toBe(true);
  f.statuses.set("agent", "running");
  await f.session.tick();
  f.statuses.set("agent", "idle");
  await f.session.tick();
  expect(f.session.snapshot().active).toBe(false);
});

test("a permission request releases an agent hold", async () => {
  const f = fixture();
  await f.session.setAgent({ agentId: "agent", enabled: true });
  f.statuses.set("agent", "permission");
  await f.session.tick();
  expect(f.session.snapshot().active).toBe(false);
});

test("a draft transfers its hold without another authorization or a sleep gap", async () => {
  const f = fixture();
  await f.session.setDraft({ draftId: "draft", enabled: true });
  await f.session.transferDraft({ draftId: "draft", agentId: "agent" });
  expect(f.session.snapshot()).toMatchObject({ draftIds: [], agentIds: ["agent"], active: true });
  await f.session.tick();
  expect(f.counts()).toEqual({ acquires: 1, releases: 1 });
});

test("timeout or battery cutoff clears every UI toggle", async () => {
  const f = fixture();
  await f.session.setGlobal({ enabled: true });
  await f.session.setDraft({ draftId: "draft", enabled: true });
  await f.session.setAgent({ agentId: "agent", enabled: true });
  f.expire();
  await f.session.tick();
  expect(f.session.snapshot()).toMatchObject({
    active: false,
    global: false,
    draftIds: [],
    agentIds: [],
  });
});

test("failed restoration remains active and retries instead of claiming success", async () => {
  const f = fixture();
  await f.session.setGlobal({ enabled: true });
  f.failRestore();
  await expect(f.session.setGlobal({ enabled: false })).rejects.toThrow("Restoration failed");
  expect(f.session.snapshot()).toMatchObject({ active: true, error: "Restoration failed" });
  f.allowRestore();
  await f.session.tick();
  expect(f.session.snapshot().active).toBe(false);
});

test("concurrent requests share one authorization and quitting releases all holds", async () => {
  const f = fixture();
  await Promise.all([
    f.session.setGlobal({ enabled: true }),
    f.session.setAgent({ agentId: "agent", enabled: true }),
  ]);
  expect(f.counts().acquires).toBe(1);
  await f.session.close();
  expect(f.session.snapshot().active).toBe(false);
  expect(f.counts().releases).toBe(1);
  await expect(f.session.setGlobal({ enabled: true })).rejects.toThrow("quitting");
});

test("a run that finishes between status polls still releases its hold", async () => {
  let lastUserMessageAt: string | null = null;
  let releases = 0;
  const session = createPowerSession({
    acquire: async () => ({
      isActive: async () => true,
      refresh: async () => {},
      release: async () => {
        releases += 1;
      },
    }),
    agentStatus: async () => ({ status: "idle", lastUserMessageAt }),
  });
  await session.setAgent({ agentId: "agent", enabled: true });
  lastUserMessageAt = "2026-10-06T22:00:00Z";
  await session.tick();
  expect(releases).toBe(1);
});
