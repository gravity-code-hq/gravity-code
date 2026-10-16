import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PRIVATE_FILE_MODE } from "../../server/private-files.js";
import { ProviderAccountStore, type StoredProviderAccount } from "./store.js";

let root: string;
let store: ProviderAccountStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "provider-accounts-"));
  store = new ProviderAccountStore(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function record(id: string, addedAt: string): StoredProviderAccount {
  return {
    version: 1,
    id,
    providerId: "claude",
    identity: {
      email: `${id}@example.com`,
      accountUuid: null,
      organizationUuid: "org-1",
      organizationName: "Org",
      displayName: null,
    },
    login: { credential: { claudeAiOauth: { accessToken: "at", refreshToken: "rt" } } },
    addedAt,
    updatedAt: addedAt,
    reloginRequired: false,
  };
}

describe("ProviderAccountStore", () => {
  it("lists nothing for a provider with no saved logins", async () => {
    expect(await store.list("claude")).toEqual([]);
  });

  it("round-trips records as private files ordered by when they were added", async () => {
    const later = record("acc_00000000000000b2", "2026-02-01T00:00:00.000Z");
    const earlier = record("acc_00000000000000a1", "2026-01-01T00:00:00.000Z");
    await store.save(later);
    await store.save(earlier);

    expect(await store.list("claude")).toEqual([earlier, later]);
    expect(await store.get("claude", later.id)).toEqual(later);
    expect(await store.get("claude", "acc_missing")).toBeNull();
    const mode = statSync(join(root, "claude", `${later.id}.json`)).mode & 0o777;
    expect(mode).toBe(PRIVATE_FILE_MODE);
  });

  it("ignores files that are not account records", async () => {
    await store.save(record("acc_00000000000000a1", "2026-01-01T00:00:00.000Z"));
    writeFileSync(join(root, "claude", "notes.txt"), "hello");

    expect((await store.list("claude")).map((entry) => entry.id)).toEqual(["acc_00000000000000a1"]);
  });

  it("removes a record and tolerates removing it twice", async () => {
    const entry = record("acc_00000000000000a1", "2026-01-01T00:00:00.000Z");
    await store.save(entry);

    await store.remove("claude", entry.id);
    await store.remove("claude", entry.id);

    expect(await store.list("claude")).toEqual([]);
  });
});
