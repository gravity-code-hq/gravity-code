import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { resolveGravityHome } from "./gravity-home.js";
describe("resolveGravityHome", () => {
  test("resolves GRAVITY_HOME without creating it", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "gravity-home-parent-"));
    const gravityHome = path.join(parent, "home");
    try {
      expect(resolveGravityHome({ GRAVITY_HOME: gravityHome })).toBe(gravityHome);
      expect(existsSync(gravityHome)).toBe(false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
