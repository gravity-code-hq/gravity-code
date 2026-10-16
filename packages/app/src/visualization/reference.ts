import type MarkdownIt from "markdown-it";
import { z } from "zod";

const START = "\uE200visualize\uE202";
const END = "\uE201";
const referenceSchema = z.object({
  path: z
    .string()
    .min(1)
    .refine(
      (path) =>
        /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(path) &&
        /\.html?$/i.test(path) &&
        !Array.from(path).some((character) => character.charCodeAt(0) < 32),
    ),
  title: z.string().optional(),
  mode: z.enum(["wide"]).optional(),
});

export type VisualizationReference = z.infer<typeof referenceSchema>;

export function parseVisualizationReference(json: string): VisualizationReference | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  const result = referenceSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function enableVisualizations(parser: MarkdownIt, streaming: boolean): void {
  parser.block.ruler.before(
    "paragraph",
    "visualization",
    (state, startLine, _endLine, silent) => {
      if (state.sCount[startLine]! - state.blkIndent >= 4) return false;
      const start = state.bMarks[startLine]! + state.tShift[startLine]!;
      const end = state.eMarks[startLine]!;
      const line = state.src.slice(start, end).trimEnd();
      const isLastLine = end === state.src.length;
      const incomplete =
        streaming &&
        isLastLine &&
        line.length > 0 &&
        (START.startsWith(line) || (line.startsWith(START) && !line.includes(END)));
      let content = "";
      if (!incomplete) {
        if (!line.startsWith(START) || !line.endsWith(END)) return false;
        content = line.slice(START.length, -END.length);
        if (!parseVisualizationReference(content)) return false;
      }
      if (silent) return true;
      const token = state.push(incomplete ? "visualization_pending" : "visualization", "", 0);
      token.block = true;
      token.content = content;
      token.map = [startLine, startLine + 1];
      state.line = startLine + 1;
      return true;
    },
    { alt: ["paragraph"] },
  );
}
