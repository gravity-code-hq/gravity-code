import { describe, expect, it } from "vitest";
import { createGravityRepoStarService, type GravityRepoStarRunner } from "./gravity-repo-star.js";

function commandError(stderr: string): Error & { stderr: string } {
  return Object.assign(new Error(`Command failed: gh\n${stderr}`), { stderr });
}

describe("createGravityRepoStarService", () => {
  it("reports starred when GitHub answers 204", async () => {
    const calls: string[][] = [];
    const runner: GravityRepoStarRunner = async (args) => {
      calls.push(args);
      return { stdout: "HTTP/2.0 204 No Content\nServer: GitHub.com\n", stderr: "" };
    };
    const service = createGravityRepoStarService({ runner, repo: "acme/app" });

    await expect(service.getStarred()).resolves.toBe(true);
    expect(calls).toEqual([["api", "--include", "user/starred/acme/app"]]);
  });

  it("reports not starred when GitHub answers 404", async () => {
    const service = createGravityRepoStarService({
      runner: async () => {
        throw commandError("gh: Not Found (HTTP 404)");
      },
    });

    await expect(service.getStarred()).resolves.toBe(false);
  });

  it("reports unknown when gh fails for any other reason", async () => {
    const service = createGravityRepoStarService({
      runner: async () => {
        throw commandError("To get started with GitHub CLI, please run:  gh auth login");
      },
    });

    await expect(service.getStarred()).resolves.toBeNull();
  });

  it("shares one gh invocation between concurrent checks", async () => {
    let calls = 0;
    let resolveRun: (value: { stdout: string; stderr: string }) => void = () => {};
    const service = createGravityRepoStarService({
      runner: () => {
        calls += 1;
        return new Promise((resolve) => {
          resolveRun = resolve;
        });
      },
    });

    const first = service.getStarred();
    const second = service.getStarred();
    resolveRun({ stdout: "HTTP/2.0 204 No Content\n", stderr: "" });

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(calls).toBe(1);

    const third = service.getStarred();
    resolveRun({ stdout: "HTTP/2.0 204 No Content\n", stderr: "" });
    await expect(third).resolves.toBe(true);
    expect(calls).toBe(2);
  });

  it("stars with PUT and reports failure without throwing", async () => {
    const calls: string[][] = [];
    const ok = createGravityRepoStarService({
      repo: "acme/app",
      runner: async (args) => {
        calls.push(args);
        return { stdout: "", stderr: "" };
      },
    });
    const failing = createGravityRepoStarService({
      runner: async () => {
        throw commandError("gh: Requires authentication (HTTP 401)");
      },
    });

    await expect(ok.star()).resolves.toBe(true);
    expect(calls).toEqual([["api", "-X", "PUT", "user/starred/acme/app"]]);
    await expect(failing.star()).resolves.toBe(false);
  });
});
