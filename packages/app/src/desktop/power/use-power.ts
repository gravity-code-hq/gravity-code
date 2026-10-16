import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import { z } from "zod";
import { getIsElectronMac } from "@/constants/platform";
import { getDesktopHost } from "@/desktop/host";

const POWER_KEY = ["desktop-power"] as const;
const PowerSnapshotSchema = z.object({
  global: z.boolean(),
  active: z.boolean(),
  busy: z.boolean(),
  agentIds: z.array(z.string()),
  draftIds: z.array(z.string()),
  error: z.string().nullable(),
});

type PowerCommand =
  | { action: "get" }
  | { action: "global"; enabled: boolean }
  | { action: "agent"; enabled: boolean; agentId: string; serverId: string }
  | { action: "draft"; enabled: boolean; draftId: string; serverId: string }
  | { action: "transfer"; draftId: string; agentId: string; serverId: string };

export async function sendPowerCommand(command: PowerCommand) {
  const bridge = getDesktopHost()?.power;
  if (!bridge) throw new Error("Desktop power control is unavailable.");
  return PowerSnapshotSchema.parse(await bridge.invoke(command));
}

export function usePower() {
  const available = getIsElectronMac() && Boolean(getDesktopHost()?.power);
  const queryClient = useQueryClient();
  const query = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 1_000,
    queryKey: POWER_KEY,
    queryFn: () => sendPowerCommand({ action: "get" }),
    enabled: available,
    refetchInterval: 1_000,
    retry: false,
  });
  const mutation = useMutation({
    mutationKey: POWER_KEY,
    mutationFn: sendPowerCommand,
    onSuccess: (snapshot) => queryClient.setQueryData(POWER_KEY, snapshot),
    onSettled: () => queryClient.invalidateQueries({ queryKey: POWER_KEY }),
  });
  const pending = useIsMutating({ mutationKey: POWER_KEY }) > 0;
  return {
    available,
    snapshot: query.data,
    busy: pending || query.data?.busy === true,
    loading: query.isPending,
    error: mutation.error ?? query.error ?? query.data?.error,
    change: mutation.mutate,
  };
}
