import { scorePathMatch } from "@gravity/protocol/search/text-match";

export interface FileMentionRange {
  start: number;
  end: number;
  query: string;
}

interface FindActiveFileMentionInput {
  text: string;
  cursorIndex: number;
}

interface ApplyFileMentionReplacementInput {
  text: string;
  mention: FileMentionRange;
  relativePath: string;
}

const INVALID_MENTION_QUERY_CHARS = /[\s\n\r\t"']/;

export function findActiveFileMention(input: FindActiveFileMentionInput): FileMentionRange | null {
  const clampedCursor = Math.max(0, Math.min(input.cursorIndex, input.text.length));
  const beforeCursor = input.text.slice(0, clampedCursor);

  for (
    let atIndex = beforeCursor.lastIndexOf("@");
    atIndex >= 0;
    atIndex = atIndex === 0 ? -1 : beforeCursor.lastIndexOf("@", atIndex - 1)
  ) {
    const query = beforeCursor.slice(atIndex + 1);
    if (INVALID_MENTION_QUERY_CHARS.test(query)) {
      continue;
    }
    return {
      start: atIndex,
      end: clampedCursor,
      query,
    };
  }

  return null;
}

export function formatQuotedFileMentionPath(relativePath: string): string {
  const safePath = relativePath.replace(/"/g, '\\"');
  return `"${safePath}"`;
}

export function applyFileMentionReplacement(input: ApplyFileMentionReplacementInput): string {
  const before = input.text.slice(0, input.mention.start);
  const after = input.text.slice(input.mention.end);
  return `${before}${formatQuotedFileMentionPath(input.relativePath)}${after}`;
}
interface FileMentionSuggestion {
  path: string;
  kind: "file" | "directory";
}

export function rankFileMentionSuggestions<T extends FileMentionSuggestion>(
  entries: readonly T[],
  query: string,
): T[] {
  if (!query || query.includes("/")) return [...entries];
  const ranked = entries.map((entry) => {
    const fileName = entry.path.split("/").at(-1) ?? entry.path;
    const score = entry.kind === "file" ? scorePathMatch(query, fileName) : null;
    return { entry, score, fileName };
  });
  ranked.sort((left, right) => {
    const leftTier = left.score?.tier ?? Number.MAX_SAFE_INTEGER;
    const rightTier = right.score?.tier ?? Number.MAX_SAFE_INTEGER;
    if (leftTier !== rightTier) return leftTier - rightTier;
    if (!left.score || !right.score) return 0;
    return left.fileName.length - right.fileName.length;
  });
  return ranked.map(({ entry }) => entry);
}
