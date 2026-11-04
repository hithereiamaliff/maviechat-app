/** One line of a file's changes, as the Changes view draws it. */
export interface PatchLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk' | 'note';
  text: string;
  /** The line's number in the file after the change (before it, for a removed line). */
  number: number | null;
}

/**
 * A unified diff (OpenCode sends one per changed file) as lines to draw: each hunk's heading,
 * then its added, removed and unchanged lines with their line numbers. File headers are left out.
 */
export function parsePatch(patch: string): PatchLine[] {
  const lines: PatchLine[] = [];
  let oldNumber = 0;
  let newNumber = 0;
  let inHunk = false;
  for (const raw of patch.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      oldNumber = Number(hunk[1]);
      newNumber = Number(hunk[2]);
      inHunk = true;
      lines.push({ kind: 'hunk', text: raw, number: null });
    } else if (!inHunk) {
      // `diff --git`, `index`, `---` and `+++` lines before the first hunk.
    } else if (raw.startsWith('+')) {
      lines.push({ kind: 'add', text: raw.slice(1), number: newNumber++ });
    } else if (raw.startsWith('-')) {
      lines.push({ kind: 'del', text: raw.slice(1), number: oldNumber++ });
    } else if (raw.startsWith('\\')) {
      lines.push({ kind: 'note', text: raw.slice(1).trim(), number: null });
    } else {
      lines.push({ kind: 'ctx', text: raw.startsWith(' ') ? raw.slice(1) : raw, number: newNumber });
      oldNumber++;
      newNumber++;
    }
  }
  return lines;
}

/** A changed file's path split for showing: its name, and the folder it's in (empty at the top). */
export function splitPath(file: string): { name: string; folder: string } {
  const at = file.lastIndexOf('/');
  return at < 0 ? { name: file, folder: '' } : { name: file.slice(at + 1), folder: file.slice(0, at) };
}
