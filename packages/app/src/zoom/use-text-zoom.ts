import { useEffect, useReducer, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-api-context";
import { stepTextZoom, type TextZoomState, type ZoomDirection } from "./text-size";

export function useTextZoom(baseFontSize: number, surface: "terminal" | "editor") {
  const toast = useToast();
  const { t } = useTranslation();
  const [state, zoom] = useReducer(
    (current: TextZoomState, direction: ZoomDirection) =>
      stepTextZoom(current, direction, baseFontSize),
    { override: null, revision: 0 },
  );
  const fontSize = state.override ?? baseFontSize;
  const notifiedRevision = useRef(0);
  useEffect(() => {
    if (state.revision === notifiedRevision.current) return;
    notifiedRevision.current = state.revision;
    const message =
      surface === "terminal"
        ? t("workspace.zoom.terminalText", { size: fontSize })
        : t("workspace.zoom.editorText", { size: fontSize });
    toast.show(message, { durationMs: 1500, testID: "text-zoom-feedback" });
  }, [state.revision, fontSize, surface, t, toast]);
  return { fontSize, zoom };
}
