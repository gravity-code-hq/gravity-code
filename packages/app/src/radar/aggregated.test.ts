import type { StoredRadar } from "@gravity/protocol/radar/types";
import { describe, expect, it } from "vitest";
import {
  AllRadarHostsFailedError,
  fetchAggregatedRadars,
  removeAggregatedRadar,
  upsertAggregatedRadar,
  type AggregatedRadar,
  type FetchAggregatedRadarsState,
  type RadarRuntime,
  type RadarRuntimeSnapshot,
} from "./aggregated";

function makeRadar(overrides: Partial<StoredRadar> = {}): StoredRadar {
  return {
    id: "radar-1",
    channel: "alerts",
    channelId: null,
    cwd: "/tmp/project",
    provider: "claude",
    status: "active",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    cursorTs: "0",
    nextPollAt: "2026-11-01T00:05:00.000Z",
    lastPollAt: null,
    lastPollError: null,
    tasks: [],
    ...overrides,
  };
}

function makeRuntime(input: {
  snapshots: Record<string, RadarRuntimeSnapshot | null>;
  radars?: Record<string, StoredRadar[]>;
  failures?: Record<string, string>;
}): RadarRuntime {
  return {
    getSnapshot: (serverId) => input.snapshots[serverId] ?? null,
    getClient: (serverId) => {
      const failure = input.failures?.[serverId];
      const radars = input.radars?.[serverId];
      if (!failure && !radars) {
        return null;
      }
      return {
        radarList: async () => {
          if (failure) {
            throw new Error(failure);
          }
          return { requestId: "test-request", radars: radars ?? [] };
        },
      };
    },
  };
}

const HOST_A = { serverId: "host-a", serverName: "Host A" };
const HOST_B = { serverId: "host-b", serverName: "Host B" };

describe("fetchAggregatedRadars", () => {
  it("reports connecting, not an empty list, while no host can be asked yet", async () => {
    const result = await fetchAggregatedRadars({
      hosts: [HOST_A, HOST_B],
      runtime: makeRuntime({
        snapshots: {
          "host-a": { connectionStatus: "connecting" },
          "host-b": null,
        },
      }),
    });

    expect(result).toEqual({ status: "connecting" });
  });

  it("loads an empty list once a reachable host answers, even if another never connects", async () => {
    const result = await fetchAggregatedRadars({
      hosts: [HOST_A, HOST_B],
      runtime: makeRuntime({
        snapshots: {
          "host-a": { connectionStatus: "online" },
          "host-b": { connectionStatus: "connecting" },
        },
        radars: { "host-a": [] },
      }),
    });

    expect(result).toEqual({ status: "loaded", data: [], hostErrors: [] });
  });

  it("reports an empty loaded list when every host is offline", async () => {
    const result = await fetchAggregatedRadars({
      hosts: [HOST_A],
      runtime: makeRuntime({ snapshots: { "host-a": { connectionStatus: "offline" } } }),
    });

    expect(result).toEqual({ status: "loaded", data: [], hostErrors: [] });
  });

  it("tags every radar with the host that owns it", async () => {
    const result = await fetchAggregatedRadars({
      hosts: [HOST_A, HOST_B],
      runtime: makeRuntime({
        snapshots: {
          "host-a": { connectionStatus: "online" },
          "host-b": { connectionStatus: "online" },
        },
        radars: {
          "host-a": [makeRadar({ id: "a-1" })],
          "host-b": [makeRadar({ id: "b-1", channel: "tickets" })],
        },
      }),
    });

    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(result.data.map((radar) => `${radar.serverId}:${radar.id}`).sort()).toEqual([
      "host-a:a-1",
      "host-b:b-1",
    ]);
  });

  it("keeps the hosts that answered and lists the one that failed", async () => {
    const result = await fetchAggregatedRadars({
      hosts: [HOST_A, HOST_B],
      runtime: makeRuntime({
        snapshots: {
          "host-a": { connectionStatus: "online" },
          "host-b": { connectionStatus: "online" },
        },
        radars: { "host-a": [makeRadar({ id: "a-1" })] },
        failures: { "host-b": "Unknown request" },
      }),
    });

    expect(result).toMatchObject({
      status: "loaded",
      data: [{ id: "a-1", serverId: "host-a" }],
      hostErrors: [{ serverId: "host-b", serverName: "Host B", message: "Unknown request" }],
    });
  });

  it("throws the daemon's message when every asked host fails", async () => {
    const fetch = fetchAggregatedRadars({
      hosts: [HOST_A],
      runtime: makeRuntime({
        snapshots: { "host-a": { connectionStatus: "online" } },
        failures: { "host-a": "Radar store unreadable" },
      }),
    });

    await expect(fetch).rejects.toBeInstanceOf(AllRadarHostsFailedError);
    await expect(fetch).rejects.toThrow("Radar store unreadable");
  });
});

describe("cached radar list writes", () => {
  const first: AggregatedRadar = { ...makeRadar({ id: "radar-1" }), serverId: "host-a" };
  const second: AggregatedRadar = { ...makeRadar({ id: "radar-2" }), serverId: "host-a" };
  const loaded: FetchAggregatedRadarsState = {
    status: "loaded",
    data: [first, second],
    hostErrors: [],
  };

  it("replaces the radar the daemon returned and leaves the rest in place", () => {
    const paused: AggregatedRadar = { ...first, status: "paused" };

    expect(upsertAggregatedRadar(loaded, paused)).toEqual({
      status: "loaded",
      data: [paused, second],
      hostErrors: [],
    });
  });

  it("appends a radar that was just created", () => {
    const created: AggregatedRadar = { ...makeRadar({ id: "radar-3" }), serverId: "host-a" };

    expect(upsertAggregatedRadar(loaded, created)).toMatchObject({
      data: [first, second, created],
    });
  });

  it("does not confuse the same radar id on two hosts", () => {
    const otherHost: AggregatedRadar = { ...first, serverId: "host-b", status: "paused" };

    expect(upsertAggregatedRadar(loaded, otherHost)).toMatchObject({
      data: [first, second, otherHost],
    });
    expect(removeAggregatedRadar(loaded, { serverId: "host-b", id: "radar-1" })).toEqual(loaded);
  });

  it("removes a deleted radar", () => {
    expect(removeAggregatedRadar(loaded, { serverId: "host-a", id: "radar-1" })).toMatchObject({
      data: [second],
    });
  });

  it("leaves a list that has not loaded untouched", () => {
    expect(upsertAggregatedRadar({ status: "connecting" }, first)).toEqual({
      status: "connecting",
    });
    expect(removeAggregatedRadar(undefined, first)).toBeUndefined();
  });
});
