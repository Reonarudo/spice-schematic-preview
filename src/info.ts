/**
 * Where a code block sits in its note. Obsidian hands a code block processor the fence body but
 * not its info string, and runs one processor per block, so the attribute block
 * (```` ```spice {caption="..."} ````) and the list of the note's spice fences, which the toggle
 * needs to tell identical bodies apart, are recovered by scanning the note's text.
 */

export interface ScannedFence {
  /** 0-based line of the opening fence. */
  line: number;
  /** The info string after the fence characters, trimmed. */
  info: string;
  /** The lines between the fences, with container prefixes removed, joined by `\n`. */
  body: string;
}

/** A fence opener: blockquote markers, indentation, then three or more backticks or tildes. */
const OPEN = /^((?:[ \t]*>)*)([ \t]*)(`{3,}|~{3,})(.*)$/;

function markers(prefix: string): number {
  return (prefix.match(/>/g) ?? []).length;
}

/** Remove `count` blockquote markers (each with one optional following space), or `undefined` if the line has fewer. */
function stripQuotes(line: string, count: number): string | undefined {
  let rest = line;
  for (let i = 0; i < count; i++) {
    const match = /^[ \t]*>[ ]?/.exec(rest);
    if (!match) return undefined;
    rest = rest.slice(match[0].length);
  }
  return rest;
}

/**
 * Every fenced code block in `text` whose language (the first word of its info string, as
 * Obsidian reads it) is `word`. Fences of every language are tracked, so a spice fence quoted
 * inside another fence is not counted. Fences may sit in blockquotes and list items; an
 * unclosed fence runs to the end of its container.
 */
export function scanFences(text: string, word: string): ScannedFence[] {
  const lines = text.split(/\r?\n/);
  const found: ScannedFence[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = OPEN.exec(lines[i]!);
    if (!open || (open[3]!.startsWith('`') && open[4]!.includes('`'))) {
      i++;
      continue;
    }
    const quotes = markers(open[1]!);
    // Indentation counts from inside the blockquote markers, as the body lines' does.
    const opener = stripQuotes(lines[i]!, quotes)!;
    const indent = /^[ \t]*/.exec(opener)![0].replace(/\t/g, '    ').length;
    const fence = open[3]!;
    const info = open[4]!.trim();
    const closing = new RegExp(`^[ \\t]*${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`);
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const inner = stripQuotes(lines[j]!, quotes);
      if (inner === undefined) break;
      if (closing.test(inner)) {
        j++;
        break;
      }
      const lead = /^[ \t]*/.exec(inner)![0].replace(/\t/g, '    ').length;
      if (indent > 0 && inner.trim() !== '' && lead < indent) break;
      body.push(inner.slice(Math.min(indent, /^[ ]*/.exec(inner)![0].length)));
    }
    if ((info.split(/\s+/)[0] ?? '') === word) found.push({ line: i, info, body: body.join('\n') });
    i = Math.max(j, i + 1);
  }
  return found;
}

/**
 * Which of `fences` a processor call is rendering: the one in the section's line range, or, when
 * the section holds several (a list or blockquote is one section), the first whose body matches.
 */
export function locate(fences: ScannedFence[], lineStart: number, lineEnd: number, source: string): number {
  const inRange: number[] = [];
  fences.forEach((fence, index) => {
    if (fence.line >= lineStart && fence.line <= lineEnd) inRange.push(index);
  });
  if (inRange.length === 1) return inRange[0]!;
  const wanted = source.trimEnd();
  const same = inRange.find((index) => fences[index]!.body.trimEnd() === wanted);
  return same ?? inRange[0] ?? -1;
}
