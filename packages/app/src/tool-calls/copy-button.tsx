import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { ToolCallDetail } from "@gravity/protocol/agent-types";
import { Button } from "@/components/ui/button";
import { isWeb } from "@/constants/platform";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { useToast } from "@/contexts/toast-context";

interface ToolCallCopyButtonProps {
  detail: ToolCallDetail | undefined;
  errorText: string | undefined;
}

function contentText(detail: ToolCallDetail | undefined): string {
  if (!detail) return "";
  switch (detail.type) {
    case "shell":
      return `$ ${detail.command}${detail.output ? `\n\n${detail.output}` : ""}`;
    case "read":
    case "write":
      return detail.content ?? "";
    case "plain_text":
      return detail.text ?? "";
    case "plan":
      return detail.text;
    case "worktree_setup":
    case "sub_agent":
      return detail.log;
    default:
      return JSON.stringify(detail, null, 2);
  }
}

export function ToolCallCopyButton({ detail, errorText }: ToolCallCopyButtonProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [status, setStatus] = useState<"idle" | "copying" | "copied">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const copy = useCallback(async () => {
    if (timer.current !== null) clearTimeout(timer.current);
    setStatus("copying");
    const parts = [contentText(detail), errorText].filter(Boolean);
    const content = parts.join("\n\n");
    try {
      if (isWeb) {
        await navigator.clipboard.writeText(content);
      } else {
        await copyToClipboard(content);
      }
      setStatus("copied");
      timer.current = setTimeout(() => setStatus("idle"), 1_500);
    } catch {
      setStatus("idle");
      toast.error(t("common.errors.unableToCopy"));
    }
  }, [detail, errorText, t, toast]);
  const copied = status === "copied";
  return (
    <Button
      testID="tool-call-copy"
      variant="ghost"
      size="xs"
      leftIcon={copied ? Check : Copy}
      accessibilityLabel={t(copied ? "common.states.copied" : "common.actions.copy")}
      loading={status === "copying"}
      disabled={status === "copying"}
      onPress={copy}
    />
  );
}
