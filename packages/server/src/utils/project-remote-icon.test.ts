import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  githubAvatarUrl,
  readPackageHomepage,
  RemoteIconCache,
  websiteFaviconUrl,
} from "./project-remote-icon.js";

const PNG_1X1 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00,
]);
const PNG_1X1_ICON = { data: PNG_1X1.toString("base64"), mimeType: "image/png" };
const AVATAR_URL = "https://github.com/openclaw.png?size=64";
const DAY_MS = 24 * 60 * 60 * 1000;

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn()));
});

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "gravity-remote-icon-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

type Answer = Buffer | "offline" | 404 | 503;

/** Stands in for the icon host: answers each request with the next queued answer. */
function iconServer(...answers: Answer[]) {
  const requests: string[] = [];
  async function fetchIcon(url: string): Promise<Response> {
    requests.push(url);
    const next = answers.shift();
    if (next === undefined) throw new Error(`Unexpected icon request: ${url}`);
    if (next === "offline") throw new TypeError("fetch failed");
    if (typeof next === "number") return new Response(new Uint8Array(PNG_1X1), { status: next });
    return new Response(new Uint8Array(next), { status: 200 });
  }
  return { fetchIcon, requests };
}

describe("websiteFaviconUrl", () => {
  it.each([
    ["https://openclaw.ai", "openclaw.ai"],
    ["https://docs.openclaw.ai/getting-started#install", "docs.openclaw.ai"],
    ["openclaw.ai", "openclaw.ai"],
  ])("asks Google for the favicon of %s", (homepage, domain) => {
    expect(websiteFaviconUrl(homepage)).toBe(
      `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
    );
  });

  it.each([
    null,
    "",
    "https://github.com/openclaw/openclaw#readme",
    "https://gitlab.com/group/repo",
    "ftp://openclaw.ai",
    "not a url",
  ])("has no favicon for %s", (homepage) => {
    expect(websiteFaviconUrl(homepage)).toBeNull();
  });
});

describe("readPackageHomepage", () => {
  it("reads the homepage from the root package.json", async () => {
    const root = await tempDir();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ homepage: "https://openclaw.ai" }),
    );

    await expect(readPackageHomepage(root)).resolves.toBe("https://openclaw.ai");
  });

  it.each([
    ["no package.json", null],
    ["no homepage field", JSON.stringify({ name: "repo" })],
    ["a non-string homepage", JSON.stringify({ homepage: 42 })],
    ["invalid JSON", "{"],
  ])("resolves null with %s", async (_name, contents) => {
    const root = await tempDir();
    if (contents !== null) await writeFile(join(root, "package.json"), contents);

    await expect(readPackageHomepage(root)).resolves.toBeNull();
  });
});

describe("RemoteIconCache", () => {
  it("downloads an icon once and shares it across concurrent reads", async () => {
    const server = iconServer(PNG_1X1);
    const cache = new RemoteIconCache(await tempDir(), server.fetchIcon);

    const [first, second] = await Promise.all([
      cache.read(githubAvatarUrl("OpenClaw")),
      cache.read(githubAvatarUrl("openclaw")),
    ]);

    expect(first).toEqual(PNG_1X1_ICON);
    expect(second).toEqual(PNG_1X1_ICON);
    expect(server.requests).toEqual([AVATAR_URL]);
  });

  it("serves a stored icon after a restart without going to the network", async () => {
    const home = await tempDir();
    await new RemoteIconCache(home, iconServer(PNG_1X1).fetchIcon).read(AVATAR_URL);

    const offline = iconServer();
    const restarted = new RemoteIconCache(home, offline.fetchIcon);

    await expect(restarted.read(AVATAR_URL)).resolves.toEqual(PNG_1X1_ICON);
    expect(offline.requests).toEqual([]);
  });

  it("does not show Google's placeholder for a site without a favicon", async () => {
    const cache = new RemoteIconCache(await tempDir(), iconServer(404).fetchIcon);

    await expect(cache.read(websiteFaviconUrl("https://openclaw.ai") ?? "")).resolves.toBeNull();
  });

  it.each([
    ["the host is unreachable", "offline" as const, 10 * 60 * 1000],
    ["the host errors", 503 as const, 10 * 60 * 1000],
    ["the icon does not exist", 404 as const, DAY_MS],
  ])("waits before retrying when %s", async (_name, failure, retryAfterMs) => {
    let now = Date.now();
    const server = iconServer(failure, PNG_1X1);
    const cache = new RemoteIconCache(await tempDir(), server.fetchIcon, () => now);

    await expect(cache.read(AVATAR_URL)).resolves.toBeNull();
    now += retryAfterMs - 1;
    await expect(cache.read(AVATAR_URL)).resolves.toBeNull();
    expect(server.requests).toHaveLength(1);

    now += 1;
    await expect(cache.read(AVATAR_URL)).resolves.toEqual(PNG_1X1_ICON);
    expect(server.requests).toHaveLength(2);
  });

  it("keeps a stale icon when the refresh fails", async () => {
    const home = await tempDir();
    await new RemoteIconCache(home, iconServer(PNG_1X1).fetchIcon).read(AVATAR_URL);

    const offline = iconServer("offline");
    const weekLater = new RemoteIconCache(home, offline.fetchIcon, () => Date.now() + 8 * DAY_MS);

    await expect(weekLater.read(AVATAR_URL)).resolves.toEqual(PNG_1X1_ICON);
    expect(offline.requests).toHaveLength(1);
  });

  it("rejects a response that is not an image", async () => {
    const cache = new RemoteIconCache(await tempDir(), iconServer(Buffer.from("<html>")).fetchIcon);

    await expect(cache.read(AVATAR_URL)).resolves.toBeNull();
  });
});
