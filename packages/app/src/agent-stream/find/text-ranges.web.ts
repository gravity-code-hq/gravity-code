import { matchRanges } from "@/git/diff-document/search";

// Only message text, so a timestamp or a copy button in the same row never matches.
const SEARCHABLE_TEXT_SELECTOR =
  '[data-testid="assistant-message"], [data-testid="user-message-text"]';

export function findHistoryRow(scroll: HTMLElement, itemId: string): HTMLElement | null {
  return scroll.querySelector<HTMLElement>(`[data-history-row-id="${CSS.escape(itemId)}"]`);
}

/**
 * DOM ranges for every match of `regex` in a row's message text, in reading order. A match may
 * span several text nodes (inline code, bold), so offsets are taken over the joined text, with a
 * newline wherever the text moves to another block, as it does in the Markdown source.
 */
export function findRowTextRanges(row: Element, regex: RegExp, wholeWord: boolean): Range[] {
  const ranges: Range[] = [];
  for (const region of row.querySelectorAll(SEARCHABLE_TEXT_SELECTOR)) {
    const nodes: Text[] = [];
    const starts: number[] = [];
    let text = "";
    let block: Element | null = null;
    const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const textNode = node as Text;
      if (textNode.data.length === 0) continue;
      // List bullets are drawn, not part of the message source the matches were counted from.
      if (textNode.parentElement?.closest("[data-gravity-markdown-ignore]")) continue;
      // react-native-web renders a block of text as a div and inline runs inside it as spans.
      const nodeBlock = textNode.parentElement?.closest("div") ?? null;
      if (nodes.length > 0 && nodeBlock !== block) text += "\n";
      block = nodeBlock;
      nodes.push(textNode);
      starts.push(text.length);
      text += textNode.data;
    }
    if (nodes.length === 0) continue;
    for (const { start, end } of matchRanges(regex, text, wholeWord)) {
      const startIndex = lastIndexAtOrBefore(starts, start);
      const endIndex = lastIndexAtOrBefore(starts, end - 1);
      const startNode = nodes[startIndex]!;
      const endNode = nodes[endIndex]!;
      const range = document.createRange();
      // A regex can start or end on a block separator, which belongs to no node.
      range.setStart(startNode, Math.min(start - starts[startIndex]!, startNode.length));
      range.setEnd(endNode, Math.min(end - starts[endIndex]!, endNode.length));
      ranges.push(range);
    }
  }
  return ranges;
}

function lastIndexAtOrBefore(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle]! <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}
