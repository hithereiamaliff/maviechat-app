/*
 * The note editor's formatting bar, on the Markdown being written: marks around the selection
 * (or around the cursor, ready to type into), and line formats on every line the selection
 * touches. Pressing one again takes it off.
 */

export type NoteFormat = 'bold' | 'italic' | 'strike' | 'code' | 'heading' | 'bullet' | 'number' | 'task' | 'quote' | 'codeBlock' | 'link';

export interface Selection {
  start: number;
  end: number;
}

export interface Edit {
  text: string;
  selection: Selection;
}

const MARKS: Partial<Record<NoteFormat, string>> = { bold: '**', italic: '_', strike: '~~', code: '`' };

/** What starts a line that's already a list item, a quote or a heading: one kind replaces another. */
const LINE_PREFIX = /^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/;
const HEADING = /^(#{1,6})\s+/;

function wrap(text: string, selection: Selection, mark: string): Edit {
  const before = text.slice(0, selection.start);
  const inside = text.slice(selection.start, selection.end);
  const after = text.slice(selection.end);
  const size = mark.length;
  if (before.endsWith(mark) && after.startsWith(mark)) {
    return { text: before.slice(0, -size) + inside + after.slice(size), selection: { start: selection.start - size, end: selection.end - size } };
  }
  if (inside.length > 2 * size && inside.startsWith(mark) && inside.endsWith(mark)) {
    const bare = inside.slice(size, -size);
    return { text: before + bare + after, selection: { start: selection.start, end: selection.start + bare.length } };
  }
  return { text: before + mark + inside + mark + after, selection: { start: selection.start + size, end: selection.end + size } };
}

/** The lines the selection touches: where they start and end in the text. */
function lineSpan(text: string, selection: Selection): { from: number; to: number } {
  const from = text.lastIndexOf('\n', selection.start - 1) + 1;
  // A selection ending just after a line break doesn't take in the next line.
  const end = selection.end > selection.start && text[selection.end - 1] === '\n' ? selection.end - 1 : selection.end;
  const next = text.indexOf('\n', end);
  return { from, to: next === -1 ? text.length : next };
}

function lineFormat(text: string, selection: Selection, has: (line: string) => boolean, apply: (bare: string, index: number) => string, remove: (line: string) => string): Edit {
  const { from, to } = lineSpan(text, selection);
  const lines = text.slice(from, to).split('\n');
  const off = lines.every((line) => !line.trim() || has(line)) && lines.some((line) => line.trim());
  let counted = 0;
  const changed = lines.map((line) => {
    if (off) return remove(line);
    if (!line.trim() && lines.length > 1) return line;
    const indent = line.match(/^\s*/)?.[0] ?? '';
    const out = indent + apply(line.slice(indent.length).replace(LINE_PREFIX, ''), counted);
    counted += 1;
    return out;
  });
  const block = changed.join('\n');
  const next = text.slice(0, from) + block + text.slice(to);
  if (lines.length === 1) {
    // One line: the cursor stays where it was in the line's text.
    const shift = block.length - (to - from);
    const keep = (at: number) => Math.max(from, at + shift);
    return { text: next, selection: { start: keep(selection.start), end: keep(selection.end) } };
  }
  return { text: next, selection: { start: from, end: from + block.length } };
}

const prefixed = (pattern: RegExp) => (line: string) => pattern.test(line.trimStart());
const stripped = (pattern: RegExp) => (line: string) => {
  const indent = line.match(/^\s*/)?.[0] ?? '';
  return indent + line.slice(indent.length).replace(pattern, '');
};

const BULLET = /^[-*+]\s+(?!\[[ xX]\]\s)/;
const NUMBER = /^\d+[.)]\s+/;
const TASK = /^[-*+]\s+\[[ xX]\]\s+/;
const QUOTE = /^>\s?/;

/** Applies a format to the text at the selection; the same press again takes it off. */
export function applyFormat(text: string, selection: Selection, format: NoteFormat): Edit {
  const at = { start: Math.min(selection.start, selection.end), end: Math.max(selection.start, selection.end) };
  const mark = MARKS[format];
  if (mark) return wrap(text, at, mark);
  switch (format) {
    case 'heading': {
      // One press a level: none, #, ##, ###, then none again.
      const { from } = lineSpan(text, at);
      const level = text.slice(from).match(HEADING)?.[1]?.length ?? 0;
      const next = level >= 3 ? 0 : level + 1;
      return lineFormat(
        text,
        at,
        () => next === 0,
        (bare) => `${'#'.repeat(next)} ${bare}`,
        stripped(HEADING),
      );
    }
    case 'bullet':
      return lineFormat(text, at, prefixed(BULLET), (bare) => `- ${bare}`, stripped(BULLET));
    case 'number':
      return lineFormat(text, at, prefixed(NUMBER), (bare, index) => `${index + 1}. ${bare}`, stripped(NUMBER));
    case 'task':
      return lineFormat(text, at, prefixed(TASK), (bare) => `- [ ] ${bare}`, stripped(TASK));
    case 'quote':
      return lineFormat(text, at, prefixed(QUOTE), (bare) => `> ${bare}`, stripped(QUOTE));
    case 'codeBlock': {
      const { from, to } = lineSpan(text, at);
      const inside = text.slice(from, to);
      const block = `\`\`\`\n${inside}\n\`\`\``;
      return { text: text.slice(0, from) + block + text.slice(to), selection: { start: from + 4, end: from + 4 + inside.length } };
    }
    case 'link': {
      const label = text.slice(at.start, at.end) || 'link';
      const address = 'https://';
      const inserted = `[${label}](${address})`;
      const start = at.start + label.length + 3;
      return { text: text.slice(0, at.start) + inserted + text.slice(at.end), selection: { start, end: start + address.length } };
    }
    default:
      return { text, selection: at };
  }
}

/** Ticks or unticks the n-th checklist box in the text (the preview's boxes, in order; none inside code blocks). */
export function toggleTask(text: string, index: number): string {
  let seen = -1;
  let fenced = false;
  return text
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (fenced) return line;
      return line.replace(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s)/, (whole, open: string, mark: string, close: string) => {
        seen += 1;
        return seen === index ? `${open}${mark === ' ' ? 'x' : ' '}${close}` : whole;
      });
    })
    .join('\n');
}

/** Words and characters in the note's text (its Markdown marks left out), as the web counts them under a note. */
export function noteCounts(md: string): { words: number; characters: number } {
  const plain = md
    .replace(/```[^\n]*\n?/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/(\*\*|__|~~|\*|_|`)/g, '');
  const words = plain.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0;
  return { words, characters: plain.replace(/\n/g, '').length };
}
