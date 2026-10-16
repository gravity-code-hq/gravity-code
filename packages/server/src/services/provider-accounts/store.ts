import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ensurePrivateDirectory, writePrivateFileAtomicSync } from "../../server/private-files.js";
import { ProviderAccountIdentitySchema } from "./adapter.js";

export const StoredProviderAccountSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  providerId: z.string(),
  identity: ProviderAccountIdentitySchema,
  /** The provider's credential as captured; opaque here, parsed by the adapter. */
  login: z.unknown(),
  addedAt: z.string(),
  updatedAt: z.string(),
  /** Set once a refresh reports the refresh token is dead; cleared by re-adding the login. */
  reloginRequired: z.boolean(),
});

export type StoredProviderAccount = z.infer<typeof StoredProviderAccountSchema>;

const ACCOUNT_FILE_PATTERN = /^acc_[0-9a-f]{16}\.json$/;

export function createProviderAccountId(): string {
  return `acc_${randomBytes(8).toString("hex")}`;
}

/**
 * Saved logins, one private JSON file per account under
 * `$GRAVITY_HOME/provider-accounts/<providerId>/`. Files hold refresh tokens, so they
 * are written with the same mode as the daemon keypair.
 */
export class ProviderAccountStore {
  constructor(private readonly rootDir: string) {}

  async list(providerId: string): Promise<StoredProviderAccount[]> {
    const dir = this.providerDir(providerId);
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch (error) {
      if ((error as { code?: unknown }).code === "ENOENT") return [];
      throw error;
    }
    const records: StoredProviderAccount[] = [];
    for (const name of names) {
      if (!ACCOUNT_FILE_PATTERN.test(name)) continue;
      const raw = await fs.readFile(join(dir, name), "utf8");
      records.push(StoredProviderAccountSchema.parse(JSON.parse(raw)));
    }
    return records.sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id));
  }

  async get(providerId: string, accountId: string): Promise<StoredProviderAccount | null> {
    const records = await this.list(providerId);
    return records.find((record) => record.id === accountId) ?? null;
  }

  async save(record: StoredProviderAccount): Promise<void> {
    ensurePrivateDirectory(this.providerDir(record.providerId));
    writePrivateFileAtomicSync(
      this.accountPath(record.providerId, record.id),
      JSON.stringify(record, null, 2),
    );
  }

  async remove(providerId: string, accountId: string): Promise<void> {
    await fs.rm(this.accountPath(providerId, accountId), { force: true });
  }

  private providerDir(providerId: string): string {
    return join(this.rootDir, providerId);
  }

  private accountPath(providerId: string, accountId: string): string {
    return join(this.providerDir(providerId), `${accountId}.json`);
  }
}
