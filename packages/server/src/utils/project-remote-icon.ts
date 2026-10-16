import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { writeFileAtomic } from "../server/atomic-file.js";
import { decodeSquareIcon, type ProjectIcon } from "./project-icon.js";

const ICON_PIXELS = 64;
// Descriptor builds wait on the first lookup, so a slow network must not stall them for long.
const FETCH_TIMEOUT_MS = 3000;
const MAX_ICON_BYTES = 32 * 1024;
const MAX_PACKAGE_JSON_BYTES = 128 * 1024;
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const MISSING_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
const UNREACHABLE_RETRY_AFTER_MS = 10 * 60 * 1000;

// A homepage on a code host is the repo page itself; its favicon is the host's logo.
const CODE_HOSTS = new Set([
  "github.com",
  "www.github.com",
  "gitlab.com",
  "www.gitlab.com",
  "bitbucket.org",
  "www.bitbucket.org",
]);

type FetchIcon = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

type FetchResult =
  | { kind: "icon"; icon: ProjectIcon; bytes: Buffer }
  | { kind: "missing" }
  | { kind: "unreachable" };

interface CacheEntry {
  icon: Promise<ProjectIcon | null>;
  expiresAt: number;
}

export function githubAvatarUrl(owner: string): string {
  return `https://github.com/${encodeURIComponent(owner.toLowerCase())}.png?size=${ICON_PIXELS}`;
}

/** Google's favicon service for the homepage's domain, or null when the homepage has no usable site. */
export function websiteFaviconUrl(homepage: string | null): string | null {
  const trimmed = homepage?.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const hostname = url.hostname.toLowerCase();
  if (!["http:", "https:"].includes(url.protocol) || !hostname || CODE_HOSTS.has(hostname)) {
    return null;
  }
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=${ICON_PIXELS}`;
}

/** The `homepage` field of the project's root package.json, if it has one. */
export async function readPackageHomepage(rootPath: string): Promise<string | null> {
  const path = join(rootPath, "package.json");
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_PACKAGE_JSON_BYTES) return null;
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || !("homepage" in parsed)) return null;
    return typeof parsed.homepage === "string" ? parsed.homepage : null;
  } catch {
    return null;
  }
}

/**
 * Icons downloaded for projects that hold no icon file: a website favicon or a GitHub avatar.
 *
 * Kept on disk so projects keep their icon offline and across restarts. A failed download serves
 * the last stored icon and waits before retrying, so descriptor builds don't hit the network.
 */
export class RemoteIconCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly gravityHome: string,
    private readonly fetchIcon: FetchIcon = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  read(url: string): Promise<ProjectIcon | null> {
    const cached = this.entries.get(url);
    if (cached && cached.expiresAt > this.now()) return cached.icon;

    // Stays current while the load is in flight so concurrent reads share it.
    const entry: CacheEntry = { icon: Promise.resolve(null), expiresAt: Infinity };
    entry.icon = this.load(url).then((result) => {
      entry.expiresAt = result.expiresAt;
      return result.icon;
    });
    this.entries.set(url, entry);
    return entry.icon;
  }

  private async load(url: string): Promise<{ icon: ProjectIcon | null; expiresAt: number }> {
    const path = this.cachePath(url);
    const stored = await readStored(path);
    if (stored && this.now() - stored.writtenAt < REFRESH_AFTER_MS) {
      return { icon: stored.icon, expiresAt: stored.writtenAt + REFRESH_AFTER_MS };
    }

    const fetched = await this.fetch(url);
    if (fetched.kind === "icon") {
      await writeFileAtomic(path, fetched.bytes).catch(() => undefined);
      return { icon: fetched.icon, expiresAt: this.now() + REFRESH_AFTER_MS };
    }
    const retryAfter =
      fetched.kind === "missing" ? MISSING_RETRY_AFTER_MS : UNREACHABLE_RETRY_AFTER_MS;
    return { icon: stored?.icon ?? null, expiresAt: this.now() + retryAfter };
  }

  private async fetch(url: string): Promise<FetchResult> {
    let response: Response;
    try {
      response = await this.fetchIcon(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch {
      return { kind: "unreachable" };
    }
    // Google answers a site without a favicon with 404 and a generic globe; don't show that.
    if (!response.ok) return { kind: response.status >= 500 ? "unreachable" : "missing" };
    try {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_ICON_BYTES) return { kind: "missing" };
      const icon = decodeSquareIcon(bytes, "application/octet-stream");
      return icon ? { kind: "icon", icon, bytes } : { kind: "missing" };
    } catch {
      return { kind: "unreachable" };
    }
  }

  private cachePath(url: string): string {
    const key = createHash("sha256").update(url).digest("hex");
    return join(this.gravityHome, "projects", "icons", "remote", `${key}.bin`);
  }
}

async function readStored(path: string): Promise<{ icon: ProjectIcon; writtenAt: number } | null> {
  try {
    const [bytes, info] = await Promise.all([readFile(path), stat(path)]);
    const icon = decodeSquareIcon(bytes, "application/octet-stream");
    return icon ? { icon, writtenAt: info.mtimeMs } : null;
  } catch {
    return null;
  }
}

const sharedCaches = new Map<string, RemoteIconCache>();

/** One cache per daemon home, so concurrent sessions share a single download per icon. */
export function sharedRemoteIconCache(gravityHome: string): RemoteIconCache {
  let cache = sharedCaches.get(gravityHome);
  if (!cache) {
    cache = new RemoteIconCache(gravityHome);
    sharedCaches.set(gravityHome, cache);
  }
  return cache;
}
