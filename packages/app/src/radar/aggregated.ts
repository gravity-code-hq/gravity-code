import type { DaemonClient } from "@gravity/client/internal/daemon-client";
import type { StoredRadar } from "@gravity/protocol/radar/types";
import { toErrorMessage } from "@/utils/error-messages";

/** Root of everything cached for this host set: the radar list and each radar's check history. */
export function radarsQueryKey(serverIds: readonly string[]) {
  return ["radars", [...serverIds].sort().join("|")] as const;
}

/** Prefix of every cached list for this host set; the hook appends the connection statuses. */
export function radarListQueryKey(serverIds: readonly string[]) {
  return [...radarsQueryKey(serverIds), "list"] as const;
}

export function radarChecksQueryKey(serverId: string, radarId: string) {
  return [...radarsQueryKey([serverId]), "checks", radarId] as const;
}

export interface RadarHostInput {
  serverId: string;
  serverName: string;
}

export interface RadarRuntimeSnapshot {
  connectionStatus: string;
}

export interface RadarRuntime {
  getClient(serverId: string): Pick<DaemonClient, "radarList"> | null;
  getSnapshot(serverId: string): RadarRuntimeSnapshot | null | undefined;
}

/** A radar tagged with the host that owns it, so rows can scope mutations and navigation. */
export interface AggregatedRadar extends StoredRadar {
  serverId: string;
}

export interface RadarHostError {
  serverId: string;
  serverName: string;
  message: string;
}

export interface FetchAggregatedRadarsLoaded {
  status: "loaded";
  data: AggregatedRadar[];
  hostErrors: RadarHostError[];
}

export type FetchAggregatedRadarsState = { status: "connecting" } | FetchAggregatedRadarsLoaded;

export interface FetchAggregatedRadarsInput {
  hosts: readonly RadarHostInput[];
  runtime: RadarRuntime;
}

export class AllRadarHostsFailedError extends Error {
  constructor(readonly hostErrors: readonly RadarHostError[]) {
    super(hostErrors.map((hostError) => hostError.message).join("\n"));
    this.name = "AllRadarHostsFailedError";
  }
}

/**
 * Same contract as `fetchAggregatedSchedules`: "connecting" only while no host
 * can be asked yet, so a host that never comes online cannot hold the screen on
 * a spinner, and an empty list is only reported once a reachable host answered.
 * A failing host lands in `hostErrors` while the rest render; when every asked
 * host fails the fetch throws.
 */
export async function fetchAggregatedRadars(
  input: FetchAggregatedRadarsInput,
): Promise<FetchAggregatedRadarsState> {
  const hasSettlingHost = input.hosts.some((host) =>
    isSettling(input.runtime.getSnapshot(host.serverId)),
  );
  const radars: AggregatedRadar[] = [];
  const hostErrors: RadarHostError[] = [];
  let askedHosts = 0;

  await Promise.all(
    input.hosts.map(async (host) => {
      const isOnline = input.runtime.getSnapshot(host.serverId)?.connectionStatus === "online";
      const client = input.runtime.getClient(host.serverId);
      if (!client || !isOnline) {
        return;
      }
      askedHosts += 1;
      try {
        const payload = await client.radarList();
        for (const radar of payload.radars) {
          radars.push({ ...radar, serverId: host.serverId });
        }
      } catch (error) {
        hostErrors.push({
          serverId: host.serverId,
          serverName: host.serverName,
          message: toErrorMessage(error),
        });
      }
    }),
  );

  if (askedHosts > 0 && hostErrors.length === askedHosts) {
    throw new AllRadarHostsFailedError(hostErrors);
  }
  if (askedHosts === 0 && hasSettlingHost) {
    return { status: "connecting" };
  }
  return { status: "loaded", data: radars, hostErrors };
}

function isSettling(snapshot: RadarRuntimeSnapshot | null | undefined): boolean {
  if (!snapshot) {
    return true;
  }
  return snapshot.connectionStatus === "connecting" || snapshot.connectionStatus === "idle";
}

/** Write a radar the daemon just returned into a cached list, replacing its previous copy. */
export function upsertAggregatedRadar(
  current: FetchAggregatedRadarsState | undefined,
  radar: AggregatedRadar,
): FetchAggregatedRadarsState | undefined {
  if (!current || current.status !== "loaded") {
    return current;
  }
  const isSame = (entry: AggregatedRadar) =>
    entry.serverId === radar.serverId && entry.id === radar.id;
  const data = current.data.some(isSame)
    ? current.data.map((entry) => (isSame(entry) ? radar : entry))
    : [...current.data, radar];
  return { ...current, data };
}

export function removeAggregatedRadar(
  current: FetchAggregatedRadarsState | undefined,
  target: Pick<AggregatedRadar, "serverId" | "id">,
): FetchAggregatedRadarsState | undefined {
  if (!current || current.status !== "loaded") {
    return current;
  }
  const data = current.data.filter(
    (entry) => !(entry.serverId === target.serverId && entry.id === target.id),
  );
  return { ...current, data };
}
