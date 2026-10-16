import { useMemo, type ReactNode } from "react";
import { Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { getCommandTextRanges, type InputCommand } from "@/components/ui/text-input/command-ranges";

// Mirrors the composer's command highlight so a sent or queued command reads the same as a
// typed one. Returns children for a parent <Text>, which keeps its own layout and truncation.
export function renderCommandHighlights(
  text: string,
  commands: readonly InputCommand[],
): ReactNode {
  const ranges = getCommandTextRanges(text, commands);
  if (ranges.length === 0) return text;
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const range of ranges) {
    if (range.start > offset) parts.push(text.slice(offset, range.start));
    parts.push(<CommandToken key={range.start}>{text.slice(range.start, range.end)}</CommandToken>);
    offset = range.end;
  }
  if (offset < text.length) parts.push(text.slice(offset));
  return parts;
}

interface CommandTokenProps {
  color?: string;
  backgroundColor?: string;
  children: string;
}

function CommandTokenText({ color, backgroundColor, children }: CommandTokenProps) {
  const style = useMemo(
    () => [styles.command, inlineUnistylesStyle({ color, backgroundColor })],
    [color, backgroundColor],
  );
  return <Text style={style}>{children}</Text>;
}

// The colors are resolved here instead of in the stylesheet: on web a stylesheet sees theme
// colors as CSS variables, so branching on colorScheme or appending an alpha suffix there
// silently picks the light color and drops the background.
const CommandToken = withUnistyles(CommandTokenText, (theme) => {
  const color = theme.colors.palette.amber[theme.colorScheme === "dark" ? 500 : 700];
  return { color, backgroundColor: `${color}33` };
});

const styles = StyleSheet.create((theme) => ({
  command: {
    fontWeight: theme.fontWeight.bold,
    borderRadius: theme.borderRadius.sm,
  },
}));
