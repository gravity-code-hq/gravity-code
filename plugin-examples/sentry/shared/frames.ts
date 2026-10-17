import type { SentryException } from "./contracts";

export type FrameRow =
  | { kind: "frame"; key: string; name: string; location: string; inApp: boolean }
  | { kind: "library"; key: string; count: number };

/**
 * Newest frame first. Unless library frames are shown, each run of them folds
 * into one row, so the app's own code stands out. A trace with no app frames
 * is shown whole.
 */
export function buildFrameRows(exception: SentryException, showLibrary: boolean): FrameRow[] {
  const fold = !showLibrary && exception.frames.some((frame) => frame.inApp);
  const rows: FrameRow[] = [];
  const occurrences = new Map<string, number>();
  // Sentry orders frames oldest first.
  for (let index = exception.frames.length - 1; index >= 0; index -= 1) {
    const frame = exception.frames[index];
    const previous = rows.at(-1);
    if (fold && !frame.inApp) {
      if (previous?.kind === "library") previous.count += 1;
      else rows.push({ kind: "library", key: `library-${rows.length}`, count: 1 });
      continue;
    }
    const name = frame.function ?? "<anonymous>";
    const file = frame.filename ?? frame.module ?? "?";
    const location = frame.lineNo !== null ? `${file}:${frame.lineNo}` : file;
    // Recursion repeats a frame verbatim; the occurrence count keeps keys unique.
    const identity = `${name}@${location}`;
    const occurrence = (occurrences.get(identity) ?? 0) + 1;
    occurrences.set(identity, occurrence);
    rows.push({
      kind: "frame",
      key: `${identity}#${occurrence}`,
      name,
      location,
      inApp: frame.inApp,
    });
  }
  return rows;
}
