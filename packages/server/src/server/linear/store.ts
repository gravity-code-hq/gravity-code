import { promises as fs } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { LinearOrganizationSchema, LinearViewerSchema } from "@gravity/protocol/linear/types";
import { writePrivateFileAtomicSync } from "../private-files.js";

export const StoredLinearConnectionSchema = z.object({
  version: z.literal(1),
  apiKey: z.string(),
  viewer: LinearViewerSchema,
  organization: LinearOrganizationSchema,
  connectedAt: z.string(),
});

export type StoredLinearConnection = z.infer<typeof StoredLinearConnectionSchema>;

export const LINEAR_CONNECTION_FILENAME = "linear.json";

/**
 * The Linear API key and the identity it resolved to, in one private file under
 * `$GRAVITY_HOME`. The key never leaves the daemon: status responses carry only
 * the viewer and organization.
 */
export class LinearConnectionStore {
  private readonly filePath: string;

  constructor(gravityHome: string) {
    this.filePath = join(gravityHome, LINEAR_CONNECTION_FILENAME);
  }

  async read(): Promise<StoredLinearConnection | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as { code?: unknown }).code === "ENOENT") return null;
      throw error;
    }
    return StoredLinearConnectionSchema.parse(JSON.parse(raw));
  }

  async write(connection: StoredLinearConnection): Promise<void> {
    writePrivateFileAtomicSync(this.filePath, JSON.stringify(connection, null, 2));
  }

  async clear(): Promise<void> {
    await fs.rm(this.filePath, { force: true });
  }
}
