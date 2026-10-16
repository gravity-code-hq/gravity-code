import assert from "node:assert/strict";
import type { createE2ETestContext } from "./test-daemon.ts";

export async function waitForTerminalOutput(
  gravity: Awaited<ReturnType<typeof createE2ETestContext>>["gravity"],
  terminalId: string,
  text: string,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lines: string[] = [];
  while (Date.now() < deadline) {
    const result = await gravity(["terminal", "capture", terminalId, "--json"]);
    assert.equal(result.exitCode, 0, result.stderr);
    lines = JSON.parse(result.stdout).lines;
    if (lines.some((line) => line.includes(text))) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Missing terminal output: ${text}\nLast capture:\n${lines.join("\n")}`);
}
