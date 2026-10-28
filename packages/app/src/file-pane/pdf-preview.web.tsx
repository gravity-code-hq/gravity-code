import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Scan, ZoomIn, ZoomOut } from "lucide-react-native";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  paneContentToolbarIconSize,
  ToolbarButton,
  ToolbarControls,
} from "@/components/ui/pane-content-toolbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { Theme } from "@/styles/theme";
import { openExternalUrl } from "@/utils/open-external-url";
import { FilePanelBar } from "./bar";
import type { FilePdfPreviewProps } from "./pdf-preview";
import {
  parsePdfRuntimeMessage,
  type PdfRuntimeCommand,
  type PdfViewState,
} from "./pdf-runtime/messages";

const ThemedZoomIn = withUnistyles(ZoomIn);
const ThemedZoomOut = withUnistyles(ZoomOut);
const ThemedScan = withUnistyles(Scan);
const ThemedSpinner = withUnistyles(LoadingSpinner);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

// pdf.js runs in a sandboxed, opaque-origin frame (see pdf-runtime/entry.ts): it
// parses untrusted bytes, so it gets scripts and nothing else. The ~2 MB runtime
// loads on first use instead of riding in the main bundle.
const SANDBOX = "allow-scripts";

function loadRuntimeHtml(): Promise<string> {
  return import("./pdf-runtime/html.gen").then((module) => module.pdfRuntimeHtml);
}

function PdfPane({ bytes, size }: FilePdfPreviewProps) {
  const { t } = useTranslation();
  const frame = useRef<HTMLIFrameElement>(null);
  const revision = useRef(0);
  const bridgeReady = useRef(false);
  const [html, setHtml] = useState<string | null>(null);
  const [view, setView] = useState<PdfViewState | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const value = await loadRuntimeHtml();
      if (!disposed) setHtml(value);
    })();
    return () => {
      disposed = true;
    };
  }, []);

  const send = useCallback((command: PdfRuntimeCommand) => {
    frame.current?.contentWindow?.postMessage(command, "*");
  }, []);

  const sendDocument = useCallback(() => {
    revision.current += 1;
    setFailed(false);
    send({ type: "load", revision: revision.current, data: bytes });
  }, [bytes, send]);

  // A changed file arrives as new bytes; the runtime keeps the reader's page.
  useEffect(() => {
    if (bridgeReady.current) sendDocument();
  }, [sendDocument]);

  useEffect(() => {
    function receive(event: MessageEvent<unknown>): void {
      if (event.source !== frame.current?.contentWindow) return;
      const message = parsePdfRuntimeMessage(event.data);
      if (!message) return;
      if (message.type === "bridgeReady") {
        bridgeReady.current = true;
        sendDocument();
        return;
      }
      if (message.type === "openLink") {
        void openExternalUrl(message.url);
        return;
      }
      if (message.revision !== revision.current) return;
      if (message.type === "loadError") {
        setFailed(true);
        return;
      }
      setView(message);
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [sendDocument]);

  const zoomIn = useCallback(() => send({ type: "zoom", action: "in" }), [send]);
  const zoomOut = useCallback(() => send({ type: "zoom", action: "out" }), [send]);
  const fitWidth = useCallback(() => send({ type: "zoom", action: "fit" }), [send]);
  const controls = useMemo(
    () =>
      view && !failed ? (
        <PdfControls view={view} onZoomIn={zoomIn} onZoomOut={zoomOut} onFit={fitWidth} />
      ) : null,
    [failed, fitWidth, view, zoomIn, zoomOut],
  );

  return (
    <View style={styles.container} testID="workspace-file-pane">
      <FilePanelBar size={size} trailing={controls} />
      <View style={styles.body}>
        {html ? (
          <iframe
            ref={frame}
            data-testid="pdf-file-preview"
            title={t("panels.file.editor.preview")}
            srcDoc={html}
            sandbox={SANDBOX}
            referrerPolicy="no-referrer"
            style={iframeStyle}
          />
        ) : null}
        {failed ? (
          <View style={styles.overlay}>
            <Text style={styles.message}>{t("panels.file.pdfFailed")}</Text>
          </View>
        ) : null}
        {!view && !failed ? (
          <View style={styles.overlay}>
            <ThemedSpinner size="small" uniProps={mutedColorMapping} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function PdfControls({
  view,
  onZoomIn,
  onZoomOut,
  onFit,
}: {
  view: PdfViewState;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const iconSize = paneContentToolbarIconSize(compact);
  return (
    <ToolbarControls>
      <Text style={styles.whisper}>
        {t("panels.file.pdfPage", { page: view.page, count: view.pageCount })}
      </Text>
      <ToolbarButton label={t("message.diagram.zoomOut")} compact={compact} onPress={onZoomOut}>
        <ThemedZoomOut size={iconSize} uniProps={mutedColorMapping} />
      </ToolbarButton>
      <Text style={styles.zoom}>{Math.round(view.scale * 100)}%</Text>
      <ToolbarButton label={t("message.diagram.zoomIn")} compact={compact} onPress={onZoomIn}>
        <ThemedZoomIn size={iconSize} uniProps={mutedColorMapping} />
      </ToolbarButton>
      <ToolbarButton
        label={t("panels.file.pdfFitWidth")}
        compact={compact}
        selected={view.fit}
        onPress={onFit}
      >
        <ThemedScan size={iconSize} uniProps={mutedColorMapping} />
      </ToolbarButton>
    </ToolbarControls>
  );
}

export const FilePdfPreview: ComponentType<FilePdfPreviewProps> | null = PdfPane;

const iframeStyle = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  border: "none",
  background: "transparent",
} as const;

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  body: {
    flex: 1,
    minHeight: 0,
    position: "relative",
  },
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface0,
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  whisper: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    marginRight: theme.spacing[2],
  },
  zoom: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    minWidth: 40,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
}));
