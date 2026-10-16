/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure helpers copied from VS Code so the Search view behaves the same way:
 *
 * - `escapeRegExpCharacters`, `createRegExp`, `getNLines`: src/vs/base/common/strings.ts
 * - `splitGlobAware`: src/vs/base/common/glob.ts
 * - `anchorGlob`: src/vs/workbench/services/search/node/ripgrepSearchUtils.ts
 * - `unicodeEscapesToPCRE2`, `fixNewline`, `performBraceExpansionForRipgrep`:
 *   src/vs/workbench/services/search/node/ripgrepTextSearchEngine.ts
 * - `expandGlobalGlob`: src/vs/workbench/services/search/common/queryBuilder.ts
 *
 * Keep these verbatim apart from formatting; fixes belong upstream.
 */

export function escapeRegExpCharacters(value: string): string {
  return value.replace(/[\\{}*+?|^$.[\]()]/g, "\\$&");
}

export interface RegExpOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
  multiline?: boolean;
  global?: boolean;
  unicode?: boolean;
}

export function createRegExp(
  searchString: string,
  isRegex: boolean,
  options: RegExpOptions = {},
): RegExp {
  if (!searchString) {
    throw new Error("Cannot create regex from empty string");
  }
  if (!isRegex) {
    searchString = escapeRegExpCharacters(searchString);
  }
  if (options.wholeWord) {
    if (!/\B/.test(searchString.charAt(0))) {
      searchString = "\\b" + searchString;
    }
    if (!/\B/.test(searchString.charAt(searchString.length - 1))) {
      searchString = searchString + "\\b";
    }
  }
  let modifiers = "";
  if (options.global) {
    modifiers += "g";
  }
  if (!options.matchCase) {
    modifiers += "i";
  }
  if (options.multiline) {
    modifiers += "m";
  }
  if (options.unicode) {
    modifiers += "u";
  }

  return new RegExp(searchString, modifiers);
}

export function getNLines(str: string, n = 1): string {
  if (n === 0) {
    return "";
  }

  let idx = -1;
  do {
    idx = str.indexOf("\n", idx + 1);
    n--;
  } while (n > 0 && idx >= 0);

  if (idx === -1) {
    return str;
  }

  if (str[idx - 1] === "\r") {
    idx--;
  }

  return str.substr(0, idx);
}

export function splitGlobAware(pattern: string, splitChar: string): string[] {
  if (!pattern) {
    return [];
  }

  const segments: string[] = [];

  let inBraces = false;
  let inBrackets = false;

  let curVal = "";
  for (const char of pattern) {
    switch (char) {
      case splitChar:
        if (!inBraces && !inBrackets) {
          segments.push(curVal);
          curVal = "";

          continue;
        }
        break;
      case "{":
        inBraces = true;
        break;
      case "}":
        inBraces = false;
        break;
      case "[":
        inBrackets = true;
        break;
      case "]":
        inBrackets = false;
        break;
    }

    curVal += char;
  }

  // Tail
  if (curVal) {
    segments.push(curVal);
  }

  return segments;
}

export function anchorGlob(glob: string): string {
  return glob.startsWith("**") || glob.startsWith("/") ? glob : `/${glob}`;
}

export function expandGlobalGlob(pattern: string): string[] {
  const patterns = [`**/${pattern}/**`, `**/${pattern}`];

  return patterns.map((p) => p.replace(/\*\*\/\*\*/g, "**"));
}

export function unicodeEscapesToPCRE2(pattern: string): string {
  // Match ሴ
  const unicodePattern = /((?:[^\\]|^)(?:\\\\)*)\\u([a-z0-9]{4})/gi;

  while (pattern.match(unicodePattern)) {
    pattern = pattern.replace(unicodePattern, `$1\\x{$2}`);
  }

  // Match \u{1234}
  // \u with 5-6 characters will be left alone because \x only takes 4 characters.
  const unicodePatternWithBraces = /((?:[^\\]|^)(?:\\\\)*)\\u\{([a-z0-9]{4})\}/gi;
  while (pattern.match(unicodePatternWithBraces)) {
    pattern = pattern.replace(unicodePatternWithBraces, `$1\\x{$2}`);
  }

  return pattern;
}

export function fixNewline(pattern: string): string {
  return pattern.replace(/\n/g, "\\r?\\n");
}

// brace expansion for ripgrep

/**
 * Split string given first opportunity for brace expansion in the string.
 * - If the brace is prepended by a \ character, then it is escaped.
 * - Does not process escapes that are within the sub-glob.
 * - If two unescaped `{` occur before `}`, then ripgrep will return an error for brace nesting, so don't split on those.
 */
function getEscapeAwareSplitStringForRipgrep(pattern: string): {
  fixedStart?: string;
  strInBraces: string;
  fixedEnd?: string;
} {
  let inBraces = false;
  let escaped = false;
  let fixedStart = "";
  let strInBraces = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    switch (char) {
      case "\\":
        if (escaped) {
          // If we're already escaped, then just leave the escaped slash and the preceeding slash that escapes it.
          // The two escaped slashes will result in a single slash and whatever processes the glob later will properly process the escape
          if (inBraces) {
            strInBraces += "\\" + char;
          } else {
            fixedStart += "\\" + char;
          }
          escaped = false;
        } else {
          escaped = true;
        }
        break;
      case "{":
        if (escaped) {
          // if we escaped this opening bracket, then it is to be taken literally. Remove the `\` because we've acknowleged it and add the `{` to the appropriate string
          if (inBraces) {
            strInBraces += char;
          } else {
            fixedStart += char;
          }
          escaped = false;
        } else {
          if (inBraces) {
            // ripgrep treats this as attempting to do a nested alternate group, which is invalid. Return with pattern including changes from escaped braces.
            return { strInBraces: fixedStart + "{" + strInBraces + "{" + pattern.substring(i + 1) };
          } else {
            inBraces = true;
          }
        }
        break;
      case "}":
        if (escaped) {
          // same as `}`, but for closing bracket
          if (inBraces) {
            strInBraces += char;
          } else {
            fixedStart += char;
          }
          escaped = false;
        } else if (inBraces) {
          // we found an end bracket to a valid opening bracket. Return the appropriate strings.
          return { fixedStart, strInBraces, fixedEnd: pattern.substring(i + 1) };
        } else {
          // if we're not in braces and not escaped, then this is a literal `}` character and we're still adding to fixedStart.
          fixedStart += char;
        }
        break;
      default:
        // similar to the `\\` case, we didn't do anything with the escape, so we should re-insert it into the appropriate string
        // to be consumed later when individual parts of the glob are processed
        if (inBraces) {
          strInBraces += (escaped ? "\\" : "") + char;
        } else {
          fixedStart += (escaped ? "\\" : "") + char;
        }
        escaped = false;
        break;
    }
  }

  // we are haven't hit the last brace, so no splitting should occur. Return with pattern including changes from escaped braces.
  return { strInBraces: fixedStart + (inBraces ? "{" + strInBraces : "") };
}

/**
 * Parses out curly braces and returns equivalent globs. Only supports one level of nesting.
 */
export function performBraceExpansionForRipgrep(pattern: string): string[] {
  const { fixedStart, strInBraces, fixedEnd } = getEscapeAwareSplitStringForRipgrep(pattern);
  if (fixedStart === undefined || fixedEnd === undefined) {
    return [strInBraces];
  }

  let arr = splitGlobAware(strInBraces, ",");

  if (!arr.length) {
    // occurs if the braces are empty.
    arr = [""];
  }

  const ends = performBraceExpansionForRipgrep(fixedEnd);

  return arr.flatMap((elem) => {
    const start = fixedStart + elem;
    return ends.map((end) => {
      return start + end;
    });
  });
}
