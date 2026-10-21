import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { expandUserPath } from "../path-utils.js";
import { spawnProcess } from "../../utils/spawn.js";
import {
  anchorGlob,
  createRegExp,
  escapeRegExpCharacters,
  expandGlobalGlob,
  fixNewline,
  getNLines,
  performBraceExpansionForRipgrep,
  splitGlobAware,
  unicodeEscapesToPCRE2,
} from "./content-search-vscode.js";

/**
 * Workspace content search ("find in files").
 *
 * The ripgrep path is a port of VS Code's `RipgrepTextSearchEngine`
 * (src/vs/workbench/services/search/node/ripgrepTextSearchEngine.ts): the same
 * argument construction, JSON parser, byte-to-column mapping, and one-line
 * preview elision, so results match what VS Code's Search view shows for the
 * same query. Pure helpers lifted verbatim live in `content-search-vscode.ts`.
 *
 * ripgrep comes from `@vscode/ripgrep` when installed, then PATH. Without it the
 * search falls back to `git grep`, which only sees tracked and
 * untracked-but-not-ignored files inside a repository.
 */

export interface ContentSearchParams {
  root: string;
  query: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  include?: string;
  exclude?: string;
  maxResults?: number;
  /** Skip dotfiles and dot-directories. Unset searches them, as VS Code does. */
  excludeHidden?: boolean;
}

export interface ContentSearchMatch {
  line: number;
  /** 1-based character column of the match in the full line. */
  column: number;
  /** Match length in characters. */
  length: number;
  /** One-line preview of the match line, elided around the match when long. */
  text: string;
  /** Match range inside `text`, in characters. */
  textStart: number;
  textEnd: number;
}

export interface ContentSearchFile {
  /** Path relative to the search root, with forward slashes. */
  path: string;
  matches: ContentSearchMatch[];
}

export interface ContentSearchResult {
  files: ContentSearchFile[];
  totalMatches: number;
  /** VS Code's `limitHit`: the result set is a subset of all matches. */
  truncated: boolean;
}

/** VS Code `DEFAULT_MAX_SEARCH_RESULTS` and the `search.maxResults` default. */
export const CONTENT_SEARCH_DEFAULT_MAX_RESULTS = 20_000;
export const CONTENT_SEARCH_MAX_RESULTS = 20_000;
export const CONTENT_SEARCH_MAX_QUERY_LENGTH = 4_096;
const CONTENT_SEARCH_TIMEOUT_MS = 30_000;

/**
 * VS Code's default `search.exclude` followed by its default `files.exclude`,
 * both applied on top of ignore files. `--hidden` would otherwise walk `.git`,
 * whose reflogs match nearly every author or branch query.
 */
export const CONTENT_SEARCH_DEFAULT_EXCLUDES = [
  "**/node_modules",
  "**/bower_components",
  "**/*.code-search",
  "**/.git",
  "**/.svn",
  "**/.hg",
  "**/CVS",
  "**/.DS_Store",
  "**/Thumbs.db",
];

const which: {
  sync(command: string, options: { nothrow: true }): string | null;
} = createRequire(import.meta.url)("which");

export interface ContentSearchEngineOptions {
  /** Test seam: force a specific engine instead of probing for ripgrep. */
  engine?: "ripgrep" | "git";
}

export async function searchFileContents(
  params: ContentSearchParams,
  options: ContentSearchEngineOptions = {},
): Promise<ContentSearchResult> {
  const query = params.query;
  if (query.length === 0) {
    return { files: [], totalMatches: 0, truncated: false };
  }
  if (query.length > CONTENT_SEARCH_MAX_QUERY_LENGTH) {
    throw new Error("Search query is too long");
  }
  const root = await resolveSearchRoot(params.root);
  const maxResults = Math.min(
    Math.max(1, Math.floor(params.maxResults ?? CONTENT_SEARCH_DEFAULT_MAX_RESULTS)),
    CONTENT_SEARCH_MAX_RESULTS,
  );
  const engine = options.engine ?? (resolveRipgrep() ? "ripgrep" : "git");
  const normalized = { ...params, root, maxResults };
  return engine === "ripgrep" ? searchWithRipgrep(normalized) : searchWithGitGrep(normalized);
}

async function resolveSearchRoot(root: string): Promise<string> {
  const trimmed = root.trim();
  if (!trimmed) {
    throw new Error("cwd is required");
  }
  const expanded = expandUserPath(trimmed);
  const stats = await fs.stat(expanded).catch(() => null);
  if (!stats?.isDirectory()) {
    throw new Error("Search root is not a directory");
  }
  return fs.realpath(expanded);
}

/**
 * VS Code resolves `@vscode/ripgrep` and rewrites the asar path so the binary
 * runs from the unpacked copy (src/vs/base/node/ripgrep.ts).
 */
function resolveBundledRipgrep(): string | null {
  try {
    const module = createRequire(import.meta.url)("@vscode/ripgrep") as { rgPath?: string };
    if (!module.rgPath) return null;
    return module.rgPath.replace(/\bnode_modules\.asar\b/, "node_modules.asar.unpacked");
  } catch {
    return null;
  }
}

let cachedRipgrep: string | null | undefined;

export function resolveRipgrep(): string | null {
  if (cachedRipgrep !== undefined) return cachedRipgrep;
  cachedRipgrep = resolveBundledRipgrep() ?? which.sync("rg", { nothrow: true });
  return cachedRipgrep;
}

interface NormalizedParams extends ContentSearchParams {
  maxResults: number;
}

// ---------------------------------------------------------------------------
// Include / exclude patterns — VS Code `QueryBuilder.parseSearchPaths`
// ---------------------------------------------------------------------------

/**
 * Comma-separated globs the way VS Code's "files to include / exclude" boxes
 * read them: `.ts` becomes `*.ts`, a bare `foo` matches at any depth as both
 * `**\/foo/**` and `**\/foo`, and `./src` is anchored to the search root.
 */
export function parseSearchGlobs(value: string | undefined): string[] {
  if (!value) return [];
  const segments = splitGlobAware(value, ",")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const globs: string[] = [];
  for (const rawSegment of segments) {
    let segment = rawSegment.replace(/\\/g, "/").replace(/\/+$/g, "");
    if (/^\.\.?(\/|$)/.test(segment) || path.isAbsolute(segment)) {
      // A search path: anchor it to the root instead of matching at any depth.
      segment = segment.replace(/^\.\//, "").replace(/^\//, "");
      if (segment.length === 0 || segment === "." || segment.startsWith("..")) continue;
      globs.push(`/${segment}`, `/${segment}/**`);
      continue;
    }
    if (segment[0] === ".") {
      segment = `*${segment}`;
    }
    globs.push(...expandGlobalGlob(segment));
  }
  // VS Code folds the list into an expression object, which drops duplicates.
  return [...new Set(globs)];
}

// ---------------------------------------------------------------------------
// ripgrep — VS Code `getRgArgs`
// ---------------------------------------------------------------------------

/**
 * `"foo/*bar/something"` -> `["foo", "foo/*bar", "foo/*bar/something", "foo/*bar/something/**"]`
 */
function spreadGlobComponents(globComponent: string): string[] {
  const globComponentWithBraceExpansion = performBraceExpansionForRipgrep(globComponent);
  return globComponentWithBraceExpansion.flatMap((globArg) => {
    const components = splitGlobAware(globArg, "/");
    return components.map((_, i) => components.slice(0, i + 1).join("/"));
  });
}

export function buildRipgrepArgs(params: NormalizedParams): string[] {
  const args = params.excludeHidden ? [] : ["--hidden"];
  args.push("--no-require-git");
  args.push(params.caseSensitive ? "--case-sensitive" : "--ignore-case");
  if (process.platform !== "linux") {
    args.push("--glob-case-insensitive");
    args.push("--ignore-file-case-insensitive");
  }

  const includes = parseSearchGlobs(params.include);
  const doubleStarIncludes = includes.filter((include) => include.startsWith("**"));
  const otherIncludes = includes.filter((include) => !include.startsWith("**"));

  if (otherIncludes.length) {
    args.push("-g", "!*");
    for (const otherInclude of new Set(otherIncludes)) {
      for (const globArg of spreadGlobComponents(otherInclude).map(anchorGlob)) {
        args.push("-g", globArg);
      }
    }
  }
  for (const globArg of doubleStarIncludes) {
    args.push("-g", globArg);
  }

  for (const exclude of [...CONTENT_SEARCH_DEFAULT_EXCLUDES, ...parseSearchGlobs(params.exclude)]) {
    args.push("-g", `!${anchorGlob(exclude)}`);
  }

  let pattern = params.query;
  let isRegExp = Boolean(params.regex);

  // Ripgrep handles -- as a -- arg separator. Only --.
  // - is ok, --- is ok, --some-flag is also ok. Need to special case.
  if (pattern === "--") {
    isRegExp = true;
    pattern = "\\-\\-";
  }

  // Allow $ to match /r/n
  args.push("--crlf");

  if (isRegExp) {
    pattern = unicodeEscapesToPCRE2(pattern);
    args.push("--engine", "auto");
  }

  let searchPatternAfterDoubleDashes: string | undefined;
  if (params.wholeWord) {
    const regexp = createRegExp(pattern, isRegExp, { wholeWord: true });
    // RegExp.source arbitrarily returns escaped slashes. Search and destroy.
    const regexpStr = regexp.source.replace(/\\\//g, "/");
    args.push("--regexp", regexpStr);
  } else if (isRegExp) {
    args.push("--regexp", fixNewline(pattern));
  } else {
    searchPatternAfterDoubleDashes = pattern;
    args.push("--fixed-strings");
  }

  args.push("--no-config");
  args.push("--json");

  // Folder to search
  args.push("--");
  if (searchPatternAfterDoubleDashes) {
    // Put the query after --, in case the query starts with a dash
    args.push(searchPatternAfterDoubleDashes);
  }
  args.push(".");
  return args;
}

/**
 * Read the first line of stderr and return an error for display or undefined,
 * based on a list of allowed properties. Ripgrep produces stderr output which is
 * not from a fatal error, and we only want the search to be "failed" when a
 * fatal error was produced. (VS Code `rgErrorMsgForDisplay`.)
 */
export function rgErrorMsgForDisplay(msg: string): string | undefined {
  const lines = msg.split("\n");
  const firstLine = (lines[0] ?? "").trim();

  if (lines.some((l) => l.startsWith("regex parse error"))) {
    const errorMessage: string[] = ["Regex parse error"];
    const pcre2ErrorLine = lines.filter((l) => l.startsWith("PCRE2:"));
    if (pcre2ErrorLine.length >= 1) {
      const pcre2ErrorMessage = (pcre2ErrorLine[0] ?? "").replace("PCRE2:", "");
      if (pcre2ErrorMessage.indexOf(":") !== -1 && pcre2ErrorMessage.split(":").length >= 2) {
        errorMessage.push(`:${pcre2ErrorMessage.split(":")[1]}`);
      }
    }
    return errorMessage.join("");
  }

  const match = firstLine.match(/grep config error: unknown encoding: (.*)/);
  if (match) {
    return `Unknown encoding: ${match[1]}`;
  }

  if (firstLine.startsWith("error parsing glob") || firstLine.startsWith("the literal")) {
    return firstLine.charAt(0).toUpperCase() + firstLine.substr(1);
  }

  if (firstLine.startsWith("PCRE2: error compiling pattern")) {
    return firstLine;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// ripgrep JSON parsing — VS Code `RipgrepParser`
// ---------------------------------------------------------------------------

type RgBytesOrText = { bytes: string } | { text: string };

interface RgSubmatch {
  match: RgBytesOrText;
  start: number;
  end: number;
}

interface RgMatch {
  path: RgBytesOrText;
  lines: RgBytesOrText;
  line_number: number;
  absolute_offset: number;
  submatches: RgSubmatch[];
}

interface RgMessage {
  type: "match" | "context" | string;
  data: RgMatch;
}

function bytesOrTextToString(obj: RgBytesOrText): string {
  return "bytes" in obj ? Buffer.from(obj.bytes, "base64").toString() : obj.text;
}

function getNumLinesAndLastNewlineLength(text: string): {
  numLines: number;
  lastLineLength: number;
} {
  const re = /\n/g;
  let numLines = 0;
  let lastNewlineIdx = -1;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    numLines++;
    lastNewlineIdx = match.index;
  }
  const lastLineLength = lastNewlineIdx >= 0 ? text.length - lastNewlineIdx - 1 : text.length;
  return { numLines, lastLineLength };
}

interface SourceRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/**
 * Preview geometry from VS Code's search view: a one-line preview that keeps
 * a fifth of `charsPerLine` before the match and elides long gaps between
 * matches on the same line. Regex queries carry more context because replace
 * group references need it (VS Code issue #58374).
 */
const SEARCH_ELIDED_PREFIX = "⟪ ";
const SEARCH_ELIDED_SUFFIX = " characters skipped ⟫";
const SEARCH_ELIDED_MIN_LEN = (SEARCH_ELIDED_PREFIX.length + SEARCH_ELIDED_SUFFIX.length + 5) * 2;

function charsPerLineFor(params: NormalizedParams): number {
  return params.regex ? 10_000 : 1_000;
}

/**
 * VS Code `TextSearchMatch` with `matchLines: 1`: builds the preview text and
 * maps every single-line range into it. Multi-line matches keep the full text.
 */
export function buildMatchPreviews(
  text: string,
  ranges: readonly SourceRange[],
  charsPerLine: number,
): Array<{ source: SourceRange; previewText: string; previewStart: number; previewEnd: number }> {
  const singleLine =
    ranges.length > 0 &&
    ranges.every(
      (r) =>
        r.startLineNumber === ranges[0]!.startLineNumber &&
        r.endLineNumber === ranges[0]!.startLineNumber,
    );
  if (!singleLine) {
    const fullText = text.replace(/\r?\n$/, "");
    return ranges.map((source) => ({
      source,
      previewText: fullText,
      previewStart: source.startColumn,
      previewEnd:
        source.endLineNumber === source.startLineNumber ? source.endColumn : fullText.length,
    }));
  }

  const oneLine = getNLines(text, 1);
  let result = "";
  let shift = 0;
  let lastEnd = 0;
  const leadingChars = Math.floor(charsPerLine / 5);
  const previews: Array<{
    source: SourceRange;
    previewText: string;
    previewStart: number;
    previewEnd: number;
  }> = [];
  for (const range of ranges) {
    const previewStart = Math.max(range.startColumn - leadingChars, 0);
    const previewEnd = range.startColumn + charsPerLine;
    if (previewStart > lastEnd + leadingChars + SEARCH_ELIDED_MIN_LEN) {
      const elision = SEARCH_ELIDED_PREFIX + (previewStart - lastEnd) + SEARCH_ELIDED_SUFFIX;
      result += elision + oneLine.slice(previewStart, previewEnd);
      shift += previewStart - (lastEnd + elision.length);
    } else {
      result += oneLine.slice(lastEnd, previewEnd);
    }
    lastEnd = previewEnd;
    previews.push({
      source: range,
      previewText: "",
      previewStart: range.startColumn - shift,
      previewEnd: range.endColumn - shift,
    });
  }
  for (const preview of previews) {
    preview.previewText = result;
  }
  return previews;
}

/**
 * VS Code `RipgrepParser.createTextSearchMatch`: converts ripgrep's byte
 * submatch offsets into character columns, tracking line breaks inside
 * multi-line matches.
 */
export function rangesFromRipgrepMatch(data: RgMatch): { fullText: string; ranges: SourceRange[] } {
  const lineNumber = data.line_number - 1;
  const fullText = bytesOrTextToString(data.lines);
  const fullTextBytes = Buffer.from(fullText);

  let prevMatchEnd = 0;
  let prevMatchEndCol = 0;
  let prevMatchEndLine = lineNumber;

  // it looks like certain regexes can match a line, but cause rg to not
  // emit any specific submatches for that line.
  // https://github.com/microsoft/vscode/issues/100569#issuecomment-738496991
  const submatches =
    data.submatches.length === 0
      ? [
          fullText.length
            ? { start: 0, end: 1, match: { text: fullText[0] ?? "" } }
            : { start: 0, end: 0, match: { text: "" } },
        ]
      : data.submatches;

  const ranges = submatches.map((match) => {
    const matchText = bytesOrTextToString(match.match);
    const inBetweenText = fullTextBytes.subarray(prevMatchEnd, match.start).toString();
    const inBetweenStats = getNumLinesAndLastNewlineLength(inBetweenText);
    const startCol =
      inBetweenStats.numLines > 0
        ? inBetweenStats.lastLineLength
        : inBetweenStats.lastLineLength + prevMatchEndCol;

    const stats = getNumLinesAndLastNewlineLength(matchText);
    const startLineNumber = inBetweenStats.numLines + prevMatchEndLine;
    const endLineNumber = stats.numLines + startLineNumber;
    const endCol = stats.numLines > 0 ? stats.lastLineLength : stats.lastLineLength + startCol;

    prevMatchEnd = match.end;
    prevMatchEndCol = endCol;
    prevMatchEndLine = endLineNumber;

    return { startLineNumber, startColumn: startCol, endLineNumber, endColumn: endCol };
  });
  return { fullText, ranges };
}

class ResultAccumulator {
  private readonly byPath = new Map<string, ContentSearchFile>();
  private total = 0;
  truncated = false;

  constructor(private readonly maxResults: number) {}

  get totalMatches(): number {
    return this.total;
  }

  get limitHit(): boolean {
    return this.total >= this.maxResults;
  }

  add(relativePath: string, match: ContentSearchMatch): void {
    let file = this.byPath.get(relativePath);
    if (!file) {
      file = { path: relativePath, matches: [] };
      this.byPath.set(relativePath, file);
    }
    file.matches.push(match);
    this.total += 1;
  }

  finalize(): ContentSearchResult {
    return {
      files: [...this.byPath.values()],
      totalMatches: this.total,
      truncated: this.truncated,
    };
  }
}

function toRelativePath(root: string, filePath: string): string {
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  return path.relative(root, absolute).split(path.sep).join("/");
}

/**
 * Run a line-oriented process to completion, handing each stdout line to
 * `onLine`. Returning false from `onLine` stops the process early.
 */
async function runLineProcess(
  child: ChildProcess,
  onLine: (line: string) => boolean,
): Promise<{ exitCode: number | null; killed: boolean; stderr: string; gotData: boolean }> {
  return new Promise((resolve, reject) => {
    let remainder = "";
    let stderr = "";
    let killed = false;
    let stopped = false;
    let gotData = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      killed = true;
      child.kill();
    };
    const timer = setTimeout(stop, CONTENT_SEARCH_TIMEOUT_MS);
    const consume = (chunk: string) => {
      if (stopped) return;
      gotData = true;
      const combined = remainder + chunk;
      const lines = combined.split("\n");
      remainder = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        if (!onLine(trimmed)) {
          stop();
          return;
        }
      }
    };
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => consume(chunk));
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length + chunk.length < 1e6) stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (!stopped && remainder.trim().length > 0) {
        onLine(remainder.trim());
      }
      resolve({ exitCode, killed, stderr, gotData });
    });
  });
}

/** Append one ripgrep match message to the accumulator; false once the limit is hit. */
function ingestRipgrepMatch(
  params: NormalizedParams,
  accumulator: ResultAccumulator,
  data: RgMatch,
): boolean {
  const relativePath = toRelativePath(params.root, bytesOrTextToString(data.path));
  const { fullText, ranges } = rangesFromRipgrepMatch(data);
  const previews = buildMatchPreviews(fullText, ranges, charsPerLineFor(params));
  for (const preview of previews) {
    if (accumulator.limitHit) {
      accumulator.truncated = true;
      return false;
    }
    const { source } = preview;
    const singleLine = source.startLineNumber === source.endLineNumber;
    accumulator.add(relativePath, {
      line: source.startLineNumber + 1,
      column: source.startColumn + 1,
      length: singleLine
        ? source.endColumn - source.startColumn
        : preview.previewText.length - source.startColumn,
      text: preview.previewText,
      textStart: preview.previewStart,
      textEnd: preview.previewEnd,
    });
  }
  if (accumulator.limitHit) {
    // Finish the line, then report the limit (VS Code `hitLimit`).
    accumulator.truncated = true;
    return false;
  }
  return true;
}

async function searchWithRipgrep(params: NormalizedParams): Promise<ContentSearchResult> {
  const binary = resolveRipgrep() ?? "rg";
  const accumulator = new ResultAccumulator(params.maxResults);
  const child = spawnProcess(binary, buildRipgrepArgs(params), {
    cwd: params.root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const outcome = await runLineProcess(child, (line) => {
    let parsed: RgMessage;
    try {
      parsed = JSON.parse(line) as RgMessage;
    } catch {
      return true;
    }
    if (parsed.type !== "match") return true;
    return ingestRipgrepMatch(params, accumulator, parsed.data);
  });
  if (outcome.killed) {
    accumulator.truncated = true;
    return accumulator.finalize();
  }
  if (outcome.stderr && !outcome.gotData) {
    const message = rgErrorMsgForDisplay(outcome.stderr);
    if (message) throw new Error(message);
  }
  if (outcome.exitCode !== 0 && outcome.exitCode !== 1 && accumulator.totalMatches === 0) {
    throw new Error(outcome.stderr.trim() || `ripgrep exited with code ${outcome.exitCode}`);
  }
  return accumulator.finalize();
}

// ---------------------------------------------------------------------------
// git grep fallback
// ---------------------------------------------------------------------------

function toGitPathspec(pattern: string, exclude: boolean): string {
  const magic = exclude ? "exclude,glob" : "glob";
  const anchored = pattern.startsWith("/") ? pattern.slice(1) : pattern;
  return `:(${magic})${anchored}`;
}

export function buildGitGrepArgs(params: NormalizedParams): string[] {
  const args = [
    "grep",
    "-n",
    "--column",
    "-I",
    "--null",
    "--no-color",
    "--untracked",
    "--no-recurse-submodules",
  ];
  if (!params.caseSensitive) args.push("-i");
  if (params.wholeWord) args.push("-w");
  args.push(params.regex ? "-E" : "-F");
  args.push("-e", params.query, "--");
  for (const pattern of parseSearchGlobs(params.include)) {
    args.push(toGitPathspec(pattern, false));
  }
  const excludes = [...CONTENT_SEARCH_DEFAULT_EXCLUDES, ...parseSearchGlobs(params.exclude)];
  if (params.excludeHidden) excludes.push("**/.*", "**/.*/**");
  for (const pattern of excludes) {
    args.push(toGitPathspec(pattern, true));
  }
  return args;
}

function buildLineMatcher(params: NormalizedParams): RegExp | null {
  try {
    return createRegExp(params.query, Boolean(params.regex), {
      wholeWord: Boolean(params.wholeWord),
      matchCase: Boolean(params.caseSensitive),
      global: true,
    });
  } catch {
    return null;
  }
}

function* matchRangesInLine(
  text: string,
  matcher: RegExp | null,
  fallbackColumn: number,
  fallbackLength: number,
): Generator<[number, number]> {
  if (!matcher) {
    yield [fallbackColumn - 1, fallbackColumn - 1 + fallbackLength];
    return;
  }
  matcher.lastIndex = 0;
  let found = false;
  for (const match of text.matchAll(matcher)) {
    if (match.index === undefined || match[0].length === 0) continue;
    found = true;
    yield [match.index, match.index + match[0].length];
  }
  if (!found) {
    yield [fallbackColumn - 1, fallbackColumn - 1 + fallbackLength];
  }
}

async function searchWithGitGrep(params: NormalizedParams): Promise<ContentSearchResult> {
  const accumulator = new ResultAccumulator(params.maxResults);
  const matcher = buildLineMatcher(params);
  const charsPerLine = charsPerLineFor(params);
  const child = spawnProcess("git", buildGitGrepArgs(params), {
    cwd: params.root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const outcome = await runLineProcess(child, (line) => {
    // With --null every field separator is NUL: path, line, column, text.
    const [filePath, lineField, columnField, ...textParts] = line.split("\0");
    if (!filePath || lineField === undefined || columnField === undefined) return true;
    const lineNumber = Number.parseInt(lineField, 10);
    const column = Number.parseInt(columnField, 10);
    const text = textParts.join("\0").replace(/\r$/, "");
    if (!Number.isFinite(lineNumber) || !Number.isFinite(column)) return true;
    const relativePath = toRelativePath(params.root, filePath);
    const ranges: SourceRange[] = [];
    for (const [start, end] of matchRangesInLine(text, matcher, column, params.query.length)) {
      ranges.push({
        startLineNumber: lineNumber - 1,
        startColumn: start,
        endLineNumber: lineNumber - 1,
        endColumn: end,
      });
    }
    for (const preview of buildMatchPreviews(text, ranges, charsPerLine)) {
      if (accumulator.limitHit) {
        accumulator.truncated = true;
        return false;
      }
      accumulator.add(relativePath, {
        line: lineNumber,
        column: preview.source.startColumn + 1,
        length: preview.source.endColumn - preview.source.startColumn,
        text: preview.previewText,
        textStart: preview.previewStart,
        textEnd: preview.previewEnd,
      });
    }
    if (accumulator.limitHit) {
      accumulator.truncated = true;
      return false;
    }
    return true;
  });
  if (outcome.killed) {
    accumulator.truncated = true;
  } else if (outcome.exitCode !== 0 && outcome.exitCode !== 1 && accumulator.totalMatches === 0) {
    const stderr = outcome.stderr.trim();
    if (/not a git repository/i.test(stderr)) {
      throw new Error("Install ripgrep to search outside a git repository");
    }
    throw new Error(stderr || `git grep exited with code ${outcome.exitCode}`);
  }
  return accumulator.finalize();
}

export { escapeRegExpCharacters };
