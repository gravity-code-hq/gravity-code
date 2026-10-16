import { useCallback, useRef } from "react";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { isWeb } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { ConversationExportError, fetchConversationExport } from "./export";
import { saveConversation } from "./save";

export function useConversationExport(
  serverId: string,
  destination: "download" | "clipboard",
): (agentId: string) => Promise<void> {
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const pending = useRef(new Set<string>());
  const toast = useToast();
  const { t } = useTranslation();

  return useCallback(
    async (agentId: string) => {
      if (pending.current.has(agentId)) return;
      pending.current.add(agentId);
      const copying = destination === "clipboard";
      const pendingMessage = copying
        ? t("workspace.tabs.toasts.copyingConversation")
        : t("workspace.tabs.toasts.downloadingConversation");
      toast.show(pendingMessage, { durationMs: null });
      try {
        if (!client || !connected) throw new Error(t("workspace.terminal.hostDisconnected"));
        const content = await fetchConversationExport({ agentId, client });
        if (copying) {
          if (isWeb) {
            await navigator.clipboard.writeText(content);
          } else {
            const copied = await Clipboard.setStringAsync(content);
            if (!copied) throw new Error(t("workspace.tabs.toasts.copyFailed"));
          }
          toast.show(t("workspace.tabs.toasts.conversationCopied"), { variant: "success" });
        } else {
          const safeId = agentId.replace(/[^a-zA-Z0-9_-]/g, "_");
          await saveConversation(`conversation-${safeId}.json`, content);
          toast.show(t("common.states.downloadComplete"), { variant: "success" });
        }
      } catch (error) {
        const fallbackReason = copying
          ? t("workspace.tabs.toasts.copyFailed")
          : t("downloads.failed");
        let reason = error instanceof Error ? error.message : fallbackReason;
        if (error instanceof ConversationExportError)
          reason = t("workspace.tabs.toasts.conversationChanged");
        const failureMessage = copying
          ? t("workspace.tabs.toasts.conversationCopyFailed", { reason })
          : t("workspace.tabs.toasts.conversationDownloadFailed", { reason });
        toast.show(failureMessage, {
          variant: "error",
          durationMs: null,
        });
      } finally {
        pending.current.delete(agentId);
      }
    },
    [client, connected, destination, t, toast],
  );
}
