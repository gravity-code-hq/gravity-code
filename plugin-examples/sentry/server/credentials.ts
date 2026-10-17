import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { SentryOrganizationSchema } from "../shared/contracts";

export const DEFAULT_SENTRY_URL = "https://sentry.io";

const StoredCredentialsSchema = z.object({
  token: z.string().min(1),
  baseUrl: z.string(),
  organizations: z.array(SentryOrganizationSchema),
  // Organization slug → region API URL, such as https://de.sentry.io. Empty on self-hosted Sentry.
  regions: z.record(z.string(), z.string()).default({}),
});

export type StoredCredentials = z.infer<typeof StoredCredentialsSchema>;

export interface SentryCredentialStore {
  read(): Promise<StoredCredentials | null>;
  write(credentials: StoredCredentials): Promise<void>;
  clear(): Promise<void>;
}

/**
 * The token is kept out of plugin settings on purpose: every client of the host
 * can read a settings document, and the token must never leave the daemon.
 */
export function defaultCredentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.GRAVITY_HOME?.trim() || path.join(homedir(), ".gravity");
  const expanded = home.startsWith("~/") ? path.join(homedir(), home.slice(2)) : home;
  return path.join(path.resolve(expanded), "plugin-data", "sentry", "credentials.json");
}

export function createCredentialStore(file: string): SentryCredentialStore {
  return {
    async read() {
      let raw: string;
      try {
        raw = await readFile(file, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
      const parsed = StoredCredentialsSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    },
    async write(credentials) {
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(credentials, null, 2), { mode: 0o600 });
      await rename(temporary, file);
    },
    async clear() {
      await rm(file, { force: true });
    },
  };
}

/** Accepts `sentry.io`, `https://sentry.example.com/`, or a URL ending in `/api/0`. */
export function normalizeSentryUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_SENTRY_URL;
  const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`"${input}" is not a valid Sentry URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("The Sentry URL must start with https://");
  }
  const pathname = url.pathname.replace(/\/+$/, "").replace(/\/api\/0$/, "");
  return `${url.origin}${pathname}`;
}
