import { CODE_LEFT_PADDING } from "./hit-testing";
import { fragmentWidthForRange } from "./model";
import type { DiffDocumentModel, DiffLineRow } from "./types";

/*
 * Find-in-diff, ported from VS Code's editor find (src/vs/editor/contrib/find/browser/findModel.ts
 * and src/vs/editor/common/model/textModelSearch.ts). Matches are found once per query against
 * the parsed diff source, not the layout model, so typing never rebuilds geometry and painting a
 * visible line is one map lookup.
 */

export interface DiffSearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface DiffSearchMatch {
  fileIndex: number;
  hunkIndex: number;
  lineIndex: number;
  /** UTF-16 offsets into the line content. */
  start: number;
  end: number;
}

export interface DiffSearchResult {
  matches: DiffSearchMatch[];
  /** Indexes into `matches`, keyed by `diffSearchLineKey`. */
  matchesByLine: Map<string, number[]>;
  limitHit: boolean;
  invalid: boolean;
}

interface DiffSearchSourceFile {
  status?: "ok" | "too_large" | "binary";
  hunks: ReadonlyArray<{ lines: ReadonlyArray<{ type: string; content: string }> }>;
}

/** VS Code's MATCHES_LIMIT: past this, counting costs more than the number is worth. */
export const DIFF_SEARCH_MATCH_LIMIT = 19999;

export const EMPTY_DIFF_SEARCH_RESULT: DiffSearchResult = {
  matches: [],
  matchesByLine: new Map(),
  limitHit: false,
  invalid: false,
};

// VS Code's USUAL_WORD_SEPARATORS plus whitespace, which its classifier also treats as a boundary.
const WORD_SEPARATORS = new Set("`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/? \t");

export function diffSearchLineKey(fileIndex: number, hunkIndex: number, lineIndex: number): string {
  return `${fileIndex}:${hunkIndex}:${lineIndex}`;
}

/** Null when the query is a regex that does not compile. */
export function createDiffSearchRegExp(query: string, options: DiffSearchOptions): RegExp | null {
  const source = options.regex ? query : query.replace(/[\\{}*+?|^$.[\]()]/g, "\\$&");
  try {
    return new RegExp(source, options.caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
}

export function findDiffSearchMatches(
  files: readonly DiffSearchSourceFile[],
  query: string,
  options: DiffSearchOptions,
): DiffSearchResult {
  if (query.length === 0) return EMPTY_DIFF_SEARCH_RESULT;
  const regex = createDiffSearchRegExp(query, options);
  if (!regex) return { ...EMPTY_DIFF_SEARCH_RESULT, matchesByLine: new Map(), invalid: true };
  const found: Omit<DiffSearchResult, "invalid"> = {
    matches: [],
    matchesByLine: new Map(),
    limitHit: false,
  };
  for (const [fileIndex, file] of files.entries()) {
    if (file.status === "binary" || file.status === "too_large") continue;
    for (const [hunkIndex, hunk] of file.hunks.entries()) {
      for (const [lineIndex, line] of hunk.lines.entries()) {
        if (line.type === "header") continue;
        collectLineMatches(found, regex, options.wholeWord, line.content, {
          fileIndex,
          hunkIndex,
          lineIndex,
        });
        if (found.limitHit) return { ...found, invalid: false };
      }
    }
  }
  return { ...found, invalid: false };
}

function collectLineMatches(
  found: Omit<DiffSearchResult, "invalid">,
  regex: RegExp,
  wholeWord: boolean,
  text: string,
  line: Pick<DiffSearchMatch, "fileIndex" | "hunkIndex" | "lineIndex">,
): void {
  const indexes: number[] = [];
  for (const range of matchRanges(regex, text, wholeWord)) {
    if (found.matches.length === DIFF_SEARCH_MATCH_LIMIT) {
      found.limitHit = true;
      break;
    }
    indexes.push(found.matches.length);
    found.matches.push({ ...line, ...range });
  }
  if (indexes.length > 0) {
    found.matchesByLine.set(
      diffSearchLineKey(line.fileIndex, line.hunkIndex, line.lineIndex),
      indexes,
    );
  }
}

function* matchRanges(
  regex: RegExp,
  text: string,
  wholeWord: boolean,
): Generator<{ start: number; end: number }> {
  regex.lastIndex = 0;
  for (let match = regex.exec(text); match; match = regex.exec(text)) {
    const length = match[0].length;
    if (length === 0) {
      // An empty match does not advance lastIndex; step over one code point (Searcher.next).
      const codePoint = text.codePointAt(regex.lastIndex) ?? 0;
      regex.lastIndex += codePoint > 0xffff ? 2 : 1;
      if (regex.lastIndex > text.length) return;
      continue;
    }
    if (wholeWord && !isWholeWordMatch(text, match.index, length)) continue;
    yield { start: match.index, end: match.index + length };
  }
}

/** VS Code's isValidMatch: each edge sits at a separator, the line edge, or a separator inside. */
function isWholeWordMatch(text: string, start: number, length: number): boolean {
  const end = start + length;
  const leftIsBoundary =
    start === 0 || WORD_SEPARATORS.has(text[start - 1]!) || WORD_SEPARATORS.has(text[start]!);
  const rightIsBoundary =
    end === text.length || WORD_SEPARATORS.has(text[end]!) || WORD_SEPARATORS.has(text[end - 1]!);
  return leftIsBoundary && rightIsBoundary;
}

export interface DiffSearchMatchLocation {
  /** Document offset of the line the match starts on. */
  top: number;
  /** Code-column offset of the match; null until the row's text is measured. */
  x: number | null;
  width: number;
  /** Width of the code column the match is painted in. */
  visibleWidth: number;
}

const rowIndexes = new WeakMap<DiffDocumentModel, Map<string, number>>();

function rowIndexForMatch(model: DiffDocumentModel, match: DiffSearchMatch): number | undefined {
  let index = rowIndexes.get(model);
  if (!index) {
    index = new Map();
    for (const row of model.rows) {
      if (row.kind !== "line") continue;
      for (const cell of row.cells) {
        if (!cell || cell.type === "header") continue;
        const key = diffSearchLineKey(
          row.fileIndex,
          cell.sourceIdentity.hunkIndex,
          cell.sourceIdentity.lineIndex,
        );
        if (!index.has(key)) index.set(key, row.index);
      }
    }
    rowIndexes.set(model, index);
  }
  return index.get(diffSearchLineKey(match.fileIndex, match.hunkIndex, match.lineIndex));
}

/** Null when the match's file is collapsed (it has no rows) or no longer in the model. */
export function locateDiffSearchMatch(input: {
  model: DiffDocumentModel;
  match: DiffSearchMatch;
}): DiffSearchMatchLocation | null {
  const { model, match } = input;
  const rowIndex = rowIndexForMatch(model, match);
  const row = rowIndex === undefined ? undefined : model.rows[rowIndex];
  const file = model.files[match.fileIndex];
  if (!row || row.kind !== "line" || !file) return null;
  const cellIndex = matchCellIndex(row, match);
  const cell = row.cells[cellIndex];
  const columnWidth = model.viewportWidth / row.cells.length;
  const visibleWidth = columnWidth - file.gutterWidth - CODE_LEFT_PADDING;
  const fragment = cell?.fragments.find(
    (candidate) => candidate.start <= match.start && match.start < candidate.end,
  );
  if (!fragment) return { top: row.top, x: null, width: 0, visibleWidth };
  return {
    top: row.top + fragment.top,
    x: fragmentWidthForRange(fragment, fragment.start, match.start),
    width: fragmentWidthForRange(fragment, match.start, Math.min(match.end, fragment.end)),
    visibleWidth,
  };
}

function matchCellIndex(row: DiffLineRow, match: DiffSearchMatch): number {
  const index = row.cells.findIndex(
    (cell) =>
      cell?.sourceIdentity.hunkIndex === match.hunkIndex &&
      cell.sourceIdentity.lineIndex === match.lineIndex,
  );
  return Math.max(0, index);
}

/** The first match at or below `documentTop`, wrapping to the first match (VS Code's find-as-you-type). */
export function firstDiffSearchMatchFrom(input: {
  model: DiffDocumentModel;
  result: DiffSearchResult;
  documentTop: number;
}): number | null {
  const { model, result } = input;
  if (result.matches.length === 0) return null;
  for (const [index, match] of result.matches.entries()) {
    const file = model.files[match.fileIndex];
    if (!file) continue;
    const top = file.isCollapsed ? file.top : (locateRowTop(model, match) ?? file.top);
    if (top >= input.documentTop) return index;
  }
  return 0;
}

function locateRowTop(model: DiffDocumentModel, match: DiffSearchMatch): number | undefined {
  const rowIndex = rowIndexForMatch(model, match);
  return rowIndex === undefined ? undefined : model.rows[rowIndex]?.top;
}
