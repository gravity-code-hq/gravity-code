import { describe, expect, it } from "vitest";

import {
  getGravityToolLeafName,
  isGravityToolName,
} from "@gravity/protocol/tool-name-normalization";

describe("isGravityToolName", () => {
  it("detects Claude Code format", () => {
    expect(isGravityToolName("mcp__gravity__create_agent")).toBe(true);
    expect(isGravityToolName("mcp__gravity__list_agents")).toBe(true);
  });

  it("detects gravity_voice variant", () => {
    expect(isGravityToolName("mcp__gravity_voice__create_agent")).toBe(true);
    expect(isGravityToolName("gravity_voice.create_agent")).toBe(true);
  });

  it("excludes speak tools", () => {
    expect(isGravityToolName("mcp__gravity_voice__speak")).toBe(false);
    expect(isGravityToolName("mcp__gravity__speak")).toBe(false);
    expect(isGravityToolName("gravity.speak")).toBe(false);
  });

  it("detects Codex dot format", () => {
    expect(isGravityToolName("gravity.create_agent")).toBe(true);
  });

  it("rejects non-gravity tools", () => {
    expect(isGravityToolName("Bash")).toBe(false);
    expect(isGravityToolName("Read")).toBe(false);
    expect(isGravityToolName("mcp__other_server__some_tool")).toBe(false);
  });
});

describe("getGravityToolLeafName", () => {
  it("extracts leaf from Claude Code format", () => {
    expect(getGravityToolLeafName("mcp__gravity__create_agent")).toBe("create_agent");
  });

  it("extracts leaf from Codex format", () => {
    expect(getGravityToolLeafName("gravity.create_agent")).toBe("create_agent");
    expect(getGravityToolLeafName("gravity.list_agents")).toBe("list_agents");
  });

  it("returns null for non-gravity tools", () => {
    expect(getGravityToolLeafName("Bash")).toBeNull();
  });
});
