import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  RADAR_CHECK_HISTORY_LIMIT,
  RadarCheckSchema,
  StoredRadarSchema,
  type RadarCheck,
  type StoredRadar,
} from "@gravity/protocol/radar/types";
import { writeJsonFileAtomic } from "../atomic-file.js";

type RadarUpdater = (radar: StoredRadar) => StoredRadar | Promise<StoredRadar>;

function generateRadarId(): string {
  return randomBytes(4).toString("hex");
}

/** One JSON file per radar under `$GRAVITY_HOME/radar`, mutations serialized per id. */
export class RadarStore {
  private readonly mutations = new Map<string, Promise<unknown>>();

  constructor(private readonly dir: string) {}

  private filePath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  async list(): Promise<StoredRadar[]> {
    await mkdir(this.dir, { recursive: true });
    const entries = await readdir(this.dir, { withFileTypes: true });
    const radars = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const content = await readFile(join(this.dir, entry.name), "utf-8");
          return StoredRadarSchema.parse(JSON.parse(content));
        }),
    );
    return radars.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async get(id: string): Promise<StoredRadar | null> {
    try {
      const content = await readFile(this.filePath(id), "utf-8");
      return StoredRadarSchema.parse(JSON.parse(content));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async create(radar: Omit<StoredRadar, "id">): Promise<StoredRadar> {
    const created = StoredRadarSchema.parse({ ...radar, id: generateRadarId() });
    await this.write(created);
    return created;
  }

  /** Returns null when the radar was deleted; callers mid-run treat that as "stop". */
  async update(id: string, updater: RadarUpdater): Promise<StoredRadar | null> {
    return this.serialize(id, async () => {
      const current = await this.get(id);
      if (!current) {
        return null;
      }
      const next = await updater(current);
      if (next === current) {
        return current;
      }
      if (next.id !== id) {
        throw new Error(`Radar update cannot change id: ${id}`);
      }
      const updated = StoredRadarSchema.parse(next);
      await this.write(updated);
      return updated;
    });
  }

  async delete(id: string): Promise<void> {
    await this.serialize(id, async () => {
      await rm(this.filePath(id), { force: true });
    });
  }

  private async write(radar: StoredRadar): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeJsonFileAtomic(this.filePath(radar.id), radar);
  }

  private async serialize<T>(id: string, mutation: () => Promise<T>): Promise<T> {
    const previous = this.mutations.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(mutation);
    this.mutations.set(id, next);
    try {
      return await next;
    } finally {
      if (this.mutations.get(id) === next) {
        this.mutations.delete(id);
      }
    }
  }
}

const RadarCheckListSchema = z.array(RadarCheckSchema);

/**
 * Check history, one JSON array per radar under `$GRAVITY_HOME/radar/checks`,
 * oldest first, capped at `RADAR_CHECK_HISTORY_LIMIT`. It lives apart from the
 * radar file because it is rewritten on every check and the app only reads it
 * when the user opens the history.
 */
export class RadarCheckStore {
  private readonly appends = new Map<string, Promise<unknown>>();

  constructor(private readonly dir: string) {}

  private filePath(radarId: string): string {
    return join(this.dir, `${radarId}.json`);
  }

  async list(radarId: string): Promise<RadarCheck[]> {
    try {
      const content = await readFile(this.filePath(radarId), "utf-8");
      // A file written under a larger limit shrinks on its next append; until
      // then (a paused radar never appends) the read applies the cap.
      return RadarCheckListSchema.parse(JSON.parse(content)).slice(-RADAR_CHECK_HISTORY_LIMIT);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async append(radarId: string, check: RadarCheck): Promise<void> {
    const previous = this.appends.get(radarId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.write(radarId, check));
    this.appends.set(radarId, next);
    try {
      await next;
    } finally {
      if (this.appends.get(radarId) === next) {
        this.appends.delete(radarId);
      }
    }
  }

  private async write(radarId: string, check: RadarCheck): Promise<void> {
    const checks = [...(await this.list(radarId)), RadarCheckSchema.parse(check)];
    await mkdir(this.dir, { recursive: true });
    await writeJsonFileAtomic(this.filePath(radarId), checks.slice(-RADAR_CHECK_HISTORY_LIMIT));
  }

  async delete(radarId: string): Promise<void> {
    await rm(this.filePath(radarId), { force: true });
  }
}
