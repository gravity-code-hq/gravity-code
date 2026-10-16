import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ProjectIconSource } from "@gravity/protocol/messages";
import {
  createPersistedProjectRecord,
  type PersistedProjectRecord,
  type ProjectRegistry,
} from "../server/workspace-registry.js";
import {
  ProjectIconReader,
  readProjectIcon,
  readProjectIconSnapshot,
  removeProjectCustomIcon,
  setProjectCustomIcon,
} from "./project-custom-icon.js";
import { RemoteIconCache } from "./project-remote-icon.js";

const PNG_1X1 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00,
]);
const PNG_1X1_ICON = { data: PNG_1X1.toString("base64"), mimeType: "image/png" };

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn()));
});

async function tempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

/** A project whose root holds no discoverable icon, over an in-memory registry. */
async function project(projectKey: string | null = null) {
  const rootPath = await tempDir("gravity-project-root-");
  const gravityHome = await tempDir("gravity-home-");
  let record = createPersistedProjectRecord({
    projectId: "project-a",
    rootPath,
    kind: "git",
    displayName: "repo",
    projectKey,
    createdAt: "2026-07-22T12:00:00.000Z",
    updatedAt: "2026-07-22T12:00:00.000Z",
  });
  const projects = {
    get: async () => record,
    update: async (_id: string, updater: (r: PersistedProjectRecord) => PersistedProjectRecord) => {
      record = updater(record);
      return record;
    },
  } as unknown as ProjectRegistry;
  const reader = new ProjectIconReader(gravityHome);

  return {
    gravityHome,
    rootPath,
    set: (source: ProjectIconSource) =>
      setProjectCustomIcon({ gravityHome, projectId: "project-a", source, projects }),
    read: () => readProjectIcon({ gravityHome, project: record }),
    snapshot: () => readProjectIconSnapshot({ gravityHome, project: record }),
    advertisedSnapshot: () => reader.snapshot(record),
    readAdvertised: () => reader.read(record),
    revision: () => record.customIconRevision,
    remove: () => removeProjectCustomIcon({ gravityHome, projectId: "project-a" }),
    snapshotWithRemote: (remoteIcons: RemoteIconCache) =>
      readProjectIconSnapshot({ gravityHome, project: record, remoteIcons }),
  };
}

const AVATAR_URL = "https://github.com/nousresearch.png?size=64";
const FAVICON_URL = "https://www.google.com/s2/favicons?domain=nousresearch.com&sz=64";

/** A remote icon cache whose network answers each URL from `answers`, recording what was asked. */
function remoteAnswering(gravityHome: string, answers: Record<string, Buffer | 404>) {
  const requests: string[] = [];
  const cache = new RemoteIconCache(gravityHome, async (url) => {
    requests.push(url);
    const answer = answers[url];
    if (answer === undefined) throw new Error(`Unexpected icon request: ${url}`);
    if (answer === 404) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(answer), { status: 200 });
  });
  return { cache, requests };
}

async function writeHomepage(rootPath: string, homepage: string): Promise<void> {
  await writeFile(join(rootPath, "package.json"), JSON.stringify({ homepage }));
}

function squarePng(size: number): Buffer {
  const png = Buffer.from(PNG_1X1);
  png.writeUInt32BE(size, 16);
  png.writeUInt32BE(size, 20);
  return png;
}

function nonSquarePng(): Buffer {
  const wide = Buffer.from(PNG_1X1);
  wide.writeUInt32BE(2, 16);
  return wide;
}

describe("project custom icon", () => {
  it("stores uploaded bytes as the custom icon", async () => {
    const target = await project();

    await target.set({ type: "upload", data: PNG_1X1.toString("base64") });

    expect(target.revision()).toEqual(expect.any(String));
    await expect(target.read()).resolves.toEqual(PNG_1X1_ICON);
  });

  it("scans the project directory when no custom icon is stored", async () => {
    const target = await project();
    await mkdir(join(target.rootPath, "public"));
    await writeFile(join(target.rootPath, "public", "favicon.png"), PNG_1X1);

    await expect(target.read()).resolves.toEqual(PNG_1X1_ICON);
  });

  it("fingerprints automatic icons and explicit no-icon results", async () => {
    const target = await project();

    const missing = await target.snapshot();
    expect(missing).toEqual({ icon: null, revision: "automatic:none:v1" });

    await mkdir(join(target.rootPath, "public"));
    await writeFile(join(target.rootPath, "public", "favicon.png"), PNG_1X1);
    const first = await target.snapshot();
    await writeFile(
      join(target.rootPath, "public", "favicon.png"),
      Buffer.concat([PNG_1X1, Buffer.from([1])]),
    );
    const changed = await target.snapshot();

    expect(first.icon).toEqual(PNG_1X1_ICON);
    expect(first.revision).toMatch(/^automatic:[a-f0-9]{64}$/);
    expect(changed.revision).not.toBe(first.revision);
  });

  it("serves the bytes that match the advertised revision", async () => {
    const target = await project();
    await mkdir(join(target.rootPath, "public"));
    await writeFile(join(target.rootPath, "public", "favicon.png"), PNG_1X1);
    const advertised = await target.advertisedSnapshot();

    await writeFile(
      join(target.rootPath, "public", "favicon.png"),
      Buffer.concat([PNG_1X1, Buffer.from([1])]),
    );

    await expect(target.readAdvertised()).resolves.toEqual(advertised.icon);
  });

  it("drops the stored image when the project goes back to automatic", async () => {
    const target = await project();
    await target.set({ type: "upload", data: PNG_1X1.toString("base64") });

    await target.set({ type: "automatic" });

    expect(target.revision()).toBeNull();
    await expect(target.read()).resolves.toBeNull();
  });

  it("drops the stored image when the project is removed", async () => {
    const target = await project();
    const stored = await target.set({ type: "upload", data: PNG_1X1.toString("base64") });

    await target.remove();

    await expect(
      readProjectIcon({ gravityHome: target.gravityHome, project: stored }),
    ).resolves.toBeNull();
  });

  it.each([
    ["data that is not an image", Buffer.from("nope"), "Unsupported or invalid icon file"],
    ["a non-square image", nonSquarePng(), "square image up to 1024×1024"],
    ["a file over 512 KB", Buffer.alloc(512 * 1024 + 1), "512 KB or smaller"],
  ])("rejects %s", async (_name, bytes, message) => {
    const target = await project();

    await expect(target.set({ type: "upload", data: bytes.toString("base64") })).rejects.toThrow(
      message,
    );
    expect(target.revision()).toBeNull();
  });

  it("serializes concurrent saves for one project", async () => {
    const target = await project();

    const [first, second] = await Promise.all([
      target.set({ type: "upload", data: PNG_1X1.toString("base64") }),
      target.set({ type: "automatic" }),
    ]);

    expect(first.customIconRevision).toEqual(expect.any(String));
    expect(second.customIconRevision).toBeNull();
    await expect(target.read()).resolves.toBeNull();
  });

  it("falls back to the GitHub owner's avatar when the repo has no icon file", async () => {
    const target = await project("remote:github.com/nousresearch/hermes-agent");
    const remote = remoteAnswering(target.gravityHome, { [AVATAR_URL]: PNG_1X1 });

    const snapshot = await target.snapshotWithRemote(remote.cache);

    expect(snapshot.icon).toEqual(PNG_1X1_ICON);
    expect(snapshot.revision).toMatch(/^automatic:[a-f0-9]{64}$/);
    expect(remote.requests).toEqual([AVATAR_URL]);
  });

  it("prefers the homepage favicon over the GitHub avatar", async () => {
    const target = await project("remote:github.com/nousresearch/hermes-agent");
    await writeHomepage(target.rootPath, "https://nousresearch.com");
    const remote = remoteAnswering(target.gravityHome, {
      [FAVICON_URL]: squarePng(2),
      [AVATAR_URL]: PNG_1X1,
    });

    await expect(target.snapshotWithRemote(remote.cache)).resolves.toMatchObject({
      icon: { data: squarePng(2).toString("base64"), mimeType: "image/png" },
    });
  });

  it("uses the GitHub avatar when the homepage has no favicon", async () => {
    const target = await project("remote:github.com/nousresearch/hermes-agent");
    await writeHomepage(target.rootPath, "https://nousresearch.com");
    const remote = remoteAnswering(target.gravityHome, {
      [FAVICON_URL]: 404,
      [AVATAR_URL]: PNG_1X1,
    });

    await expect(target.snapshotWithRemote(remote.cache)).resolves.toMatchObject({
      icon: PNG_1X1_ICON,
    });
  });

  it("uses the homepage favicon for projects not on GitHub", async () => {
    const target = await project("remote:gitlab.com/group/repo");
    await writeHomepage(target.rootPath, "nousresearch.com");
    const remote = remoteAnswering(target.gravityHome, { [FAVICON_URL]: PNG_1X1 });

    await expect(target.snapshotWithRemote(remote.cache)).resolves.toMatchObject({
      icon: PNG_1X1_ICON,
    });
    expect(remote.requests).toEqual([FAVICON_URL]);
  });

  it("prefers the repo's own icon file over anything downloaded", async () => {
    const target = await project("remote:github.com/nousresearch/hermes-agent");
    await writeHomepage(target.rootPath, "https://nousresearch.com");
    await mkdir(join(target.rootPath, "public"));
    await writeFile(join(target.rootPath, "public", "favicon.png"), PNG_1X1);
    const remote = remoteAnswering(target.gravityHome, {});

    await expect(target.snapshotWithRemote(remote.cache)).resolves.toMatchObject({
      icon: PNG_1X1_ICON,
    });
    expect(remote.requests).toEqual([]);
  });

  it("goes to the network only when a project has a homepage or GitHub remote", async () => {
    const target = await project("remote:gitlab.com/group/repo");
    const remote = remoteAnswering(target.gravityHome, {});

    await expect(target.snapshotWithRemote(remote.cache)).resolves.toEqual({
      icon: null,
      revision: "automatic:none:v1",
    });
    expect(remote.requests).toEqual([]);
  });
});
