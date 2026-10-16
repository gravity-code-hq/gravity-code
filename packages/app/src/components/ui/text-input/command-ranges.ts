export interface InputCommand {
  name: string;
  kind?: string;
}

export interface CommandTextRange {
  start: number;
  end: number;
}

export function getCommandTextRanges(
  text: string,
  commands: readonly InputCommand[],
): CommandTextRange[] {
  const byName = new Map(commands.map((command) => [command.name, command]));
  const ranges: CommandTextRange[] = [];
  for (const match of text.matchAll(/(^|\s)\/([^\s/"']+)(?=\s|$)/gu)) {
    const command = byName.get(match[2]);
    if (!command) continue;
    const start = match.index + match[1].length;
    if (start !== 0 && command.kind !== "skill") continue;
    ranges.push({ start, end: start + command.name.length + 1 });
  }
  return ranges;
}
