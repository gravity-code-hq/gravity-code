import type { FileContentSearchMatch } from "@gravity/protocol/messages";

/*
 * Preview rules ported from VS Code's Search view:
 * - `lcut` from src/vs/base/common/strings.ts
 * - `MatchImpl.preview()` from src/vs/workbench/contrib/search/browser/searchTreeModel/match.ts
 * See LICENSES/MIT-vscode.txt.
 */

/** VS Code `MatchImpl.MAX_PREVIEW_CHARS`. */
const MAX_PREVIEW_CHARS = 250;
/** VS Code keeps this many leading characters before the match. */
const PREVIEW_BEFORE_CHARS = 26;

export function lcut(text: string, n: number, prefix = ""): string {
  const trimmed = text.trimStart();

  if (trimmed.length < n) {
    return trimmed;
  }

  const re = /\b/g;
  let i = 0;
  while (re.test(trimmed)) {
    if (trimmed.length - re.lastIndex < n) {
      break;
    }

    i = re.lastIndex;
    re.lastIndex += 1;
  }

  if (i === 0) {
    return trimmed;
  }

  return prefix + trimmed.substring(i).trimStart();
}

export interface MatchPreview {
  before: string;
  fullBefore: string;
  inside: string;
  after: string;
}

export function previewMatch(match: FileContentSearchMatch): MatchPreview {
  const start = Math.max(0, Math.min(match.textStart, match.text.length));
  const end = Math.max(start, Math.min(match.textEnd, match.text.length));
  const fullBefore = match.text.substring(0, start);
  const before = lcut(fullBefore, PREVIEW_BEFORE_CHARS, "…");

  let inside = match.text.substring(start, end);
  let after = match.text.substring(end);

  let charsRemaining = MAX_PREVIEW_CHARS - before.length;
  inside = inside.substr(0, charsRemaining);
  charsRemaining -= inside.length;
  after = after.substr(0, charsRemaining);

  return { before, fullBefore, inside, after };
}

/** VS Code `SearchView.buildResultCountMessage` picks one of four plural forms. */
export type ResultCountForm = "fileResult" | "filesResult" | "fileResults" | "filesResults";

export function resultCountForm(resultCount: number, fileCount: number): ResultCountForm {
  if (resultCount === 1 && fileCount === 1) return "fileResult";
  if (resultCount === 1) return "filesResult";
  if (fileCount === 1) return "fileResults";
  return "filesResults";
}
