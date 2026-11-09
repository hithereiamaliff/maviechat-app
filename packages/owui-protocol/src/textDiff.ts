/*
 * Line-by-line differences between two texts, as a reader wants them: what was taken out and
 * what was put in, with a few unchanged lines around each change, as `diff -u` shows them (and
 * as Open WebUI 0.12's server works out a prompt's versions). Lines are read as Python reads
 * them, so a last line break doesn't count as a line, and texts that differ only in their line
 * breaks say so.
 */

export interface DiffLine {
  kind: 'same' | 'removed' | 'added';
  text: string;
  /** Its line in the first text (from 1), for unchanged and removed lines. */
  before: number | null;
  /** Its line in the second text (from 1), for unchanged and added lines. */
  after: number | null;
}

/** One stretch of changes with the unchanged lines around it. */
export interface DiffHunk {
  /** Its first line in each text (from 1), and how many lines of each text it covers. */
  beforeStart: number;
  beforeCount: number;
  afterStart: number;
  afterCount: number;
  lines: DiffLine[];
}

export interface TextDiff {
  hunks: DiffHunk[];
  /** Lines taken out, and put in. */
  removed: number;
  added: number;
  /** The texts differ, but only in their line breaks. */
  lineEndingsOnly: boolean;
}

type Step = DiffLine['kind'];

/** Beyond this many changed lines, a diff shows everything as taken out and put back. */
const MOST_CHANGES = 1000;

/** A text's lines, broken where Python's splitlines breaks them; a last line break adds no line. */
export function textLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split(/\r\n|[\n\v\f\r\x1c-\x1e\x85\u2028\u2029]/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * The fewest steps from one list of lines to the other (Myers' method): each line kept, taken
 * out or put in. Null when more than `limit` lines change.
 */
function fewestSteps(a: readonly string[], b: readonly string[], limit: number): Step[] | null {
  const n = a.length;
  const m = b.length;
  const most = Math.min(n + m, limit);
  const mid = most + 1;
  // The furthest point reached on each diagonal (x − y), and a copy of the part each round used.
  const furthest = new Int32Array(2 * most + 3);
  const rounds: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= most && found < 0; d += 1) {
    rounds.push(furthest.slice(mid - d - 1, mid + d + 2));
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (furthest[mid + k - 1] ?? 0) < (furthest[mid + k + 1] ?? 0));
      let x = down ? (furthest[mid + k + 1] ?? 0) : (furthest[mid + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      furthest[mid + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return null;

  // Back from the end: each round's step, after the lines kept along the way.
  const steps: Step[] = [];
  let x = n;
  let y = m;
  for (let d = found; d >= 0; d -= 1) {
    const round = rounds[d] ?? new Int32Array(0);
    const at = (k: number) => round[k + d + 1] ?? 0;
    const k = x - y;
    const fromK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const fromX = at(fromK);
    const fromY = fromX - fromK;
    while (x > fromX && y > fromY) {
      steps.push('same');
      x -= 1;
      y -= 1;
    }
    if (d > 0) steps.push(x === fromX ? 'added' : 'removed');
    x = fromX;
    y = fromY;
  }
  return steps.reverse();
}

/** Each run of changes as its taken-out lines, then its put-in ones (as `diff -u` prints them). */
function tidy(steps: Step[]): Step[] {
  const out: Step[] = [];
  let removed = 0;
  let added = 0;
  const flush = () => {
    for (; removed > 0; removed -= 1) out.push('removed');
    for (; added > 0; added -= 1) out.push('added');
  };
  for (const step of steps) {
    if (step === 'removed') removed += 1;
    else if (step === 'added') added += 1;
    else {
      flush();
      out.push(step);
    }
  }
  flush();
  return out;
}

/** What changed from `before` to `after`, line by line, with `context` unchanged lines around each change. */
export function diffText(before: string, after: string, context = 3): TextDiff {
  const a = textLines(before);
  const b = textLines(after);
  // What both begin and end with is kept; the steps are worked out for what's between.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const between = fewestSteps(a.slice(start, endA), b.slice(start, endB), MOST_CHANGES) ?? [...Array<Step>(endA - start).fill('removed'), ...Array<Step>(endB - start).fill('added')];
  const steps = [...Array<Step>(start).fill('same'), ...tidy(between), ...Array<Step>(a.length - endA).fill('same')];

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  for (const step of steps) {
    if (step === 'same') lines.push({ kind: 'same', text: a[i] ?? '', before: ++i, after: ++j });
    else if (step === 'removed') lines.push({ kind: 'removed', text: a[i] ?? '', before: ++i, after: null });
    else lines.push({ kind: 'added', text: b[j] ?? '', before: null, after: ++j });
  }

  // Changes closer than twice the context share a hunk.
  const changed = lines.flatMap((line, index) => (line.kind === 'same' ? [] : [index]));
  const hunks: DiffHunk[] = [];
  for (let first = 0; first < changed.length; ) {
    let last = first;
    while (last + 1 < changed.length && (changed[last + 1] ?? 0) - (changed[last] ?? 0) - 1 <= 2 * context) last += 1;
    const from = Math.max(0, (changed[first] ?? 0) - context);
    const to = Math.min(lines.length, (changed[last] ?? 0) + context + 1);
    const part = lines.slice(from, to);
    // Lines of each text before the hunk: what its start counts from when a side has none.
    const beforeAt = lines.slice(0, from).filter((line) => line.before !== null).length;
    const afterAt = lines.slice(0, from).filter((line) => line.after !== null).length;
    hunks.push({
      beforeStart: beforeAt + 1,
      beforeCount: part.filter((line) => line.before !== null).length,
      afterStart: afterAt + 1,
      afterCount: part.filter((line) => line.after !== null).length,
      lines: part,
    });
    first = last + 1;
  }
  const removed = lines.filter((line) => line.kind === 'removed').length;
  const added = lines.filter((line) => line.kind === 'added').length;
  return { hunks, removed, added, lineEndingsOnly: !hunks.length && before !== after };
}

/** A hunk's heading as `diff -u` (and Python's difflib) writes it, such as `@@ -2,7 +2,8 @@`. */
export function unifiedHeader(hunk: DiffHunk): string {
  const range = (start: number, count: number) => (count === 1 ? `${start}` : `${count === 0 ? start - 1 : start},${count}`);
  return `@@ -${range(hunk.beforeStart, hunk.beforeCount)} +${range(hunk.afterStart, hunk.afterCount)} @@`;
}

/** The diff as `diff -u` lines (without the two file lines): what the server's diff of two versions holds. */
export function unifiedLines(diff: TextDiff): string[] {
  return diff.hunks.flatMap((hunk) => [unifiedHeader(hunk), ...hunk.lines.map((line) => `${line.kind === 'same' ? ' ' : line.kind === 'removed' ? '-' : '+'}${line.text}`)]);
}
