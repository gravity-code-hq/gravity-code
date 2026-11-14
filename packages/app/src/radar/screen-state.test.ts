import { describe, expect, it } from "vitest";
import type { AggregatedRadar } from "./aggregated";
import { resolveRadarScreenBodyState } from "./screen-state";

const RADAR: AggregatedRadar = {
  id: "radar-1",
  serverId: "host-a",
  channel: "alerts",
  channelId: null,
  cwd: "/repos/gravity",
  provider: "claude",
  status: "active",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  cursorTs: "0",
  nextPollAt: null,
  lastPollAt: null,
  lastPollError: null,
  tasks: [],
};

const ONLINE = {
  connectionStatus: "online",
  isSupported: true,
  loadState: { status: "loading" },
  hasLoadError: false,
} as const;

describe("resolveRadarScreenBodyState", () => {
  it("waits while the host is still connecting, whatever the feature flag says", () => {
    expect(
      resolveRadarScreenBodyState({
        ...ONLINE,
        connectionStatus: "connecting",
        isSupported: false,
      }),
    ).toEqual({ kind: "loading" });
    expect(resolveRadarScreenBodyState({ ...ONLINE, connectionStatus: "idle" })).toEqual({
      kind: "loading",
    });
  });

  it("reports an unreachable host as offline", () => {
    expect(resolveRadarScreenBodyState({ ...ONLINE, connectionStatus: "offline" })).toEqual({
      kind: "offline",
    });
    expect(resolveRadarScreenBodyState({ ...ONLINE, connectionStatus: "error" })).toEqual({
      kind: "offline",
    });
  });

  it("asks for an update when a connected host lacks the radar feature", () => {
    expect(resolveRadarScreenBodyState({ ...ONLINE, isSupported: false })).toEqual({
      kind: "unsupported",
    });
  });

  it("does not show the empty state before the list has loaded", () => {
    expect(resolveRadarScreenBodyState(ONLINE)).toEqual({ kind: "loading" });
    expect(resolveRadarScreenBodyState({ ...ONLINE, loadState: { status: "connecting" } })).toEqual(
      { kind: "loading" },
    );
  });

  it("shows the empty state only for a loaded, empty list", () => {
    expect(
      resolveRadarScreenBodyState({ ...ONLINE, loadState: { status: "loaded", data: [] } }),
    ).toEqual({ kind: "empty" });
    expect(
      resolveRadarScreenBodyState({ ...ONLINE, loadState: { status: "loaded", data: [RADAR] } }),
    ).toEqual({ kind: "content" });
  });

  it("reports a load error only when there is no list to show", () => {
    expect(resolveRadarScreenBodyState({ ...ONLINE, hasLoadError: true })).toEqual({
      kind: "load-error",
    });
    expect(
      resolveRadarScreenBodyState({
        ...ONLINE,
        hasLoadError: true,
        loadState: { status: "loaded", data: [RADAR] },
      }),
    ).toEqual({ kind: "content" });
  });
});
