export const MARKDOWN_COPY_TAG_ATTRIBUTE = "data-gravity-markdown-tag";
export const MARKDOWN_COPY_IGNORE_ATTRIBUTE = "data-gravity-markdown-ignore";
export const MARKDOWN_COPY_LIST_MARKER_ATTRIBUTE = "data-gravity-markdown-list-marker";
export const MARKDOWN_COPY_UNWRAP_ATTRIBUTE = "data-gravity-markdown-unwrap";
export const MARKDOWN_COPY_LIST_START_ATTRIBUTE = "data-gravity-markdown-list-start";
export const MARKDOWN_COPY_LANGUAGE_ATTRIBUTE = "data-gravity-markdown-language";
export const MARKDOWN_COPY_ALIGN_ATTRIBUTE = "data-gravity-markdown-align";

/**
 * Trailing line breaks, with any indentation that followed the last one.
 *
 * Both ways of copying code strip these, for the same reason: pasting a trailing
 * newline into a terminal runs the last line. A fence body always ends in one, and
 * ends in several when the author left blank lines before the closing fence; a
 * selection picks one up whenever it overshoots the end of a rendered line.
 */
export const TRAILING_CODE_LINE_BREAKS = /(\r?\n[ \t]*)+$/;

export const markdownCopyDataSet = {
  blockquote: { gravityMarkdownTag: "blockquote" },
  br: { gravityMarkdownTag: "br" },
  code: { gravityMarkdownTag: "code" },
  h1: { gravityMarkdownTag: "h1" },
  h2: { gravityMarkdownTag: "h2" },
  h3: { gravityMarkdownTag: "h3" },
  h4: { gravityMarkdownTag: "h4" },
  h5: { gravityMarkdownTag: "h5" },
  h6: { gravityMarkdownTag: "h6" },
  hr: { gravityMarkdownTag: "hr" },
  ignore: { gravityMarkdownIgnore: "true" },
  li: { gravityMarkdownTag: "li" },
  listMarker: { gravityMarkdownIgnore: "true", gravityMarkdownListMarker: "true" },
  ol: { gravityMarkdownTag: "ol" },
  p: { gravityMarkdownTag: "p" },
  pre: { gravityMarkdownTag: "pre" },
  s: { gravityMarkdownTag: "s" },
  strong: { gravityMarkdownTag: "strong" },
  em: { gravityMarkdownTag: "em" },
  table: { gravityMarkdownTag: "table" },
  tbody: { gravityMarkdownTag: "tbody" },
  td: { gravityMarkdownTag: "td" },
  th: { gravityMarkdownTag: "th" },
  thead: { gravityMarkdownTag: "thead" },
  tr: { gravityMarkdownTag: "tr" },
  ul: { gravityMarkdownTag: "ul" },
  unwrap: { gravityMarkdownUnwrap: "true" },
} as const;

export type MarkdownCopyInlineTag = "br" | "code" | "em" | "s" | "strong";

export function markdownCopyOrderedListDataSet(start: unknown) {
  return {
    ...markdownCopyDataSet.ol,
    gravityMarkdownListStart: String(start ?? 1),
  } as const;
}

export function markdownCopyCodeBlockDataSet(language: string | null | undefined) {
  const fenceLanguage = language?.trim().split(/\s+/)[0];
  return {
    ...markdownCopyDataSet.pre,
    ...(fenceLanguage ? { gravityMarkdownLanguage: fenceLanguage } : {}),
  } as const;
}

export function markdownCopyTableCellDataSet(tag: "td" | "th", style: unknown) {
  const alignment =
    typeof style === "string"
      ? style.match(/(?:^|;)\s*text-align\s*:\s*(left|right|center)/i)?.[1]
      : null;
  return {
    ...markdownCopyDataSet[tag],
    ...(alignment ? { gravityMarkdownAlign: alignment.toLowerCase() } : {}),
  } as const;
}
