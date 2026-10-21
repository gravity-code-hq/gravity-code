import { cursorCharcoalDiffColors, type Theme } from "@/styles/theme";
import { hexColorWithAlpha } from "@/utils/color";
import type { DiffCell, DiffPalette } from "./types";

export function createDiffPalette(theme: Theme): DiffPalette {
  return {
    surface: theme.colors.surface0,
    headerSurface: theme.colors.surface1,
    hunkBackground: hexColorWithAlpha(theme.colors.terminal.blue, 0.1),
    additionGutterBackground: theme.colors.diffAdditionBackground,
    deletionGutterBackground: theme.colors.diffDeletionBackground,
    border: theme.colors.border,
    foreground: theme.colors.foreground,
    foregroundMuted: theme.colors.foregroundMuted,
    addition: theme.colors.diffAddition,
    deletion: theme.colors.diffDeletion,
    additionBackground: theme.colors.diffAdditionBackground,
    deletionBackground: theme.colors.diffDeletionBackground,
    emptyBackground: theme.colors.surface0,
    selection: theme.colors.terminal.blue,
    headerActiveSurface: theme.colors.surface2,
    headerBorder: theme.colors.borderAccent,
    statusSuccess: theme.colors.statusSuccess,
    statusDanger: theme.colors.statusDanger,
    statusWarning: theme.colors.statusWarning,
    // The file editor's find colors (file-pane/editor/search.web.ts), so both finds read alike.
    searchMatch: theme.colors.interactionHighlight,
    searchMatchActive: theme.colors.terminal.selectionBackground,
    searchMatchActiveBorder: theme.colors.accent,
    syntax: theme.colors.syntax,
    ...(theme.colorScheme === "dark" ? cursorCharcoalDiffColors : {}),
  };
}

export function retainDiffPalette(previous: DiffPalette, next: DiffPalette): DiffPalette {
  const { syntax: previousSyntax, ...previousColors } = previous;
  const { syntax: nextSyntax, ...nextColors } = next;
  return sameColorMap(previousColors, nextColors) && sameColorMap(previousSyntax, nextSyntax)
    ? previous
    : next;
}

function sameColorMap(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key]);
}

export function codeTextColor(cell: DiffCell, palette: DiffPalette): string {
  return cell.type === "header" ? palette.foregroundMuted : palette.foreground;
}

export function codeLineNumberTone(cell: DiffCell): "addition" | "deletion" | "foregroundMuted" {
  "worklet";
  if (cell.type === "add") return "addition";
  if (cell.type === "remove") return "deletion";
  return "foregroundMuted";
}
