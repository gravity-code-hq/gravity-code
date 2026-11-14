import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import type { AggregateLoadState } from "@/schedules/aggregated-schedules";
import type { AggregatedRadar } from "./aggregated";

export type RadarScreenBodyState =
  | { kind: "loading" }
  | { kind: "offline" }
  | { kind: "unsupported" }
  | { kind: "load-error" }
  | { kind: "empty" }
  | { kind: "content" };

/**
 * Order matters. A host's features are unknown until it connects, so the
 * connection is settled before the feature gate is read, and the gate is read
 * before the list: an unsupported host is never asked for radars.
 */
export function resolveRadarScreenBodyState(input: {
  connectionStatus: HostRuntimeConnectionStatus;
  isSupported: boolean;
  loadState: AggregateLoadState<AggregatedRadar>;
  hasLoadError: boolean;
}): RadarScreenBodyState {
  if (input.connectionStatus === "connecting" || input.connectionStatus === "idle") {
    return { kind: "loading" };
  }
  if (input.connectionStatus !== "online") {
    return { kind: "offline" };
  }
  if (!input.isSupported) {
    return { kind: "unsupported" };
  }
  if (input.loadState.status === "loaded") {
    return { kind: input.loadState.data.length === 0 ? "empty" : "content" };
  }
  if (input.hasLoadError) {
    return { kind: "load-error" };
  }
  return { kind: "loading" };
}
