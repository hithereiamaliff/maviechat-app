/** A code block to show as a diff: labelled `diff` or `patch`, or unlabelled text that reads like `git diff`. */
export function isDiffBlock(lang: string | undefined, code: string): boolean {
  const name = (lang ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (name === 'diff' || name === 'patch' || name === 'udiff') return true;
  if (name) return false;
  return /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(code) && /^(?:diff --git |--- \S)/m.test(code);
}

export type DiffLineKind = 'added' | 'removed' | 'hunk' | 'file' | null;

/** What a line of a unified diff is: added (+), removed (-), a hunk header (@@), a file header, or context. */
export function diffLineKind(line: string): DiffLineKind {
  if (line.startsWith('+++ ') || line.startsWith('--- ') || line.startsWith('diff --git ') || line.startsWith('index ')) return 'file';
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'added';
  if (line.startsWith('-')) return 'removed';
  return null;
}
