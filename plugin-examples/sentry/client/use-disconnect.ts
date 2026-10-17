import { useRpc } from "@gravity/plugin/client";
import { useToast } from "@gravity/plugin/client/react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { disconnectRpc } from "../shared/contracts";
import { describeError } from "./format";
import { sentryKeys } from "./queries";

/** Forgets the saved token. The screens fall back to the connect guide, or to SENTRY_AUTH_TOKEN. */
export function useDisconnect() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const disconnect = useRpc(disconnectRpc);
  return useMutation({
    mutationFn: () => disconnect({}),
    onSuccess: (next) => {
      queryClient.removeQueries({ queryKey: sentryKeys.all });
      queryClient.setQueryData(sentryKeys.status(), next);
      toast.show("Sentry disconnected");
    },
    onError: (error) => toast.error(describeError(error)),
  });
}
