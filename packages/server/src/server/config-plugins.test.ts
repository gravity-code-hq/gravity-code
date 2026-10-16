import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadConfig } from "./config.js";

const roots: string[] = [];

async function createGravityHome(config: unknown): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "gravity-config-plugins-"));
  roots.push(root);
  const gravityHome = path.join(root, ".gravity");
  await mkdir(gravityHome, { recursive: true });
  await writeFile(path.join(gravityHome, "config.json"), JSON.stringify(config, null, 2));
  return gravityHome;
}

describe("daemon plugin config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("defaults plugins off when config is absent", async () => {
    const home = await createGravityHome({ version: 1 });

    expect(loadConfig(home, { env: {} }).pluginsEnabled).toBe(false);
  });

  test("loads the explicit plugin opt-in", async () => {
    const home = await createGravityHome({ version: 1, pluginsEnabled: true });

    expect(loadConfig(home, { env: {} }).pluginsEnabled).toBe(true);
  });
});
