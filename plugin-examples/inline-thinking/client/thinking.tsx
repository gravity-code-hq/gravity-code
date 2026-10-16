import type { PluginTimelineItemProps } from "@gravity/plugin/client";
import { useRevealedText } from "@gravity/plugin/client/react-native";
import { useMemo } from "react";
import { Text } from "react-native";
import { z } from "zod";

export const inlineThinkingSchema = z.object({
  text: z.string(),
  phase: z.enum(["streaming", "complete"]),
});

type InlineThinkingData = z.output<typeof inlineThinkingSchema>;

export function InlineThinking({ item, theme }: PluginTimelineItemProps<InlineThinkingData>) {
  const text = useRevealedText(item.data.text, item.data.phase);
  const style = useMemo(
    () => ({ color: theme.colors.foregroundMuted }),
    [theme.colors.foregroundMuted],
  );
  return <Text style={style}>{text}</Text>;
}
