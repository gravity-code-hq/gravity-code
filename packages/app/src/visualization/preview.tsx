import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useFetchQuery } from "@/data/query";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { DaemonClient } from "@gravity/client/internal/daemon-client";
import { FileHtmlPreview } from "@/file-pane/html-preview";
import { resolveFilePreviewReadTarget } from "@/file-explorer/preview-target";
import { Button } from "@/components/ui/button";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { parseVisualizationReference } from "./reference";
import { createVisualizationDocument } from "./document";
import { z } from "zod";

interface VisualizationPreviewProps {
  content: string;
  occurrenceKey: string;
  serverId?: string;
  workspaceRoot?: string;
  client?: DaemonClient | null;
}

const MAX_BYTES = 1_000_000;
const heightMessage = z.object({
  type: z.literal("visualization-height"),
  height: z.number().finite().positive(),
});

export function VisualizationPreview({
  content,
  occurrenceKey,
  serverId,
  workspaceRoot,
  client,
}: VisualizationPreviewProps) {
  const { t } = useTranslation();
  const [height, setHeight] = useState(320);
  const receive = useCallback((value: unknown) => {
    const message = heightMessage.safeParse(value);
    if (message.success) setHeight(Math.min(900, Math.max(120, message.data.height)));
  }, []);
  const previewStyle = useMemo(() => ({ height }), [height]);
  const active = useRetainedPanelActive();
  const reference = useMemo(() => parseVisualizationReference(content), [content]);
  const target = reference && resolveFilePreviewReadTarget({ path: reference.path, workspaceRoot });
  const query = useFetchQuery({
    queryKey: ["visualization", serverId, occurrenceKey, target?.cwd, target?.path],
    enabled: active && Boolean(client && serverId && target),
    dataShape: "value",
    staleTimeMs: 60_000,
    retry: false,
    queryFn: async () => {
      if (!client || !target) throw new Error(t("panels.file.failedToLoad"));
      const file = await client.readFile(target.cwd, target.path, undefined, MAX_BYTES);
      if (file.size > MAX_BYTES) throw new Error(t("panels.file.tooLargeToDisplay"));
      if (file.kind !== "text") throw new Error(t("panels.file.binaryPreviewUnavailable"));
      return new TextDecoder().decode(file.bytes);
    },
  });
  const document = useMemo(
    () =>
      query.data === undefined
        ? null
        : createVisualizationDocument(query.data, {
            previous: t("visualization.previous"),
            next: t("visualization.next"),
            controls: t("visualization.controls"),
          }),
    [query.data, t],
  );
  const unavailable = !client || !serverId || !target;
  const { refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  if (unavailable || query.isError) {
    return (
      <View style={styles.failure} testID="visualization-error">
        <Text style={styles.label}>
          {query.error?.message ?? t("panels.file.failedToLoadPreview")}
        </Text>
        <Button
          variant="ghost"
          size="sm"
          disabled={unavailable || query.isFetching}
          onPress={retry}
        >
          {t("common.actions.retry")}
        </Button>
      </View>
    );
  }
  return (
    <View
      style={[styles.preview, previewStyle]}
      testID="visualization-preview"
      accessibilityLabel={reference?.title}
    >
      {document === null ? (
        <Text style={styles.label}>{t("panels.file.loading")}</Text>
      ) : (
        <FileHtmlPreview html={document} testID="visualization-frame" onMessage={receive} />
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  preview: { width: "100%", overflow: "hidden", borderRadius: theme.borderRadius.md },
  failure: { gap: theme.spacing[2], alignItems: "flex-start", paddingVertical: theme.spacing[3] },
  label: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
}));
