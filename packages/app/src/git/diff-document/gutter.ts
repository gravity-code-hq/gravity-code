import { lineNumberGutterWidth } from "@/components/code-insets";
import type { DiffCell, DiffDocumentModel } from "./types";

const MARKER_WIDTH = 20;

export function diffGutterWidth(
  maximumLineNumber: number,
  fontSize: number,
  layout: DiffDocumentModel["layout"],
): number {
  return (
    lineNumberGutterWidth(maximumLineNumber, fontSize) * (layout === "unified" ? 2 : 1) +
    MARKER_WIDTH
  );
}

/** Right-aligned labels share geometry across the canvas and Skia painters. */
export function diffGutterLabels(
  cell: DiffCell,
  width: number,
  layout: DiffDocumentModel["layout"],
): Array<{ text: string; right: number }> {
  "worklet";
  if (cell.type === "header" || cell.type === "empty") return [];
  const numbersWidth = width - MARKER_WIDTH;
  const labels: Array<{ text: string; right: number }> = [];
  if (layout === "unified") {
    const oldNumber =
      cell.reviewTarget?.oldLineNumber ?? (cell.type === "remove" ? cell.lineNumber : null);
    const newNumber =
      cell.reviewTarget?.newLineNumber ?? (cell.type === "add" ? cell.lineNumber : null);
    if (oldNumber !== null) labels.push({ text: String(oldNumber), right: numbersWidth / 2 - 7 });
    if (newNumber !== null) labels.push({ text: String(newNumber), right: numbersWidth - 7 });
  } else if (cell.lineNumber !== null) {
    labels.push({ text: String(cell.lineNumber), right: numbersWidth - 7 });
  }
  if (cell.type === "add" || cell.type === "remove") {
    labels.push({ text: cell.type === "add" ? "+" : "−", right: width - 4 });
  }
  return labels;
}
