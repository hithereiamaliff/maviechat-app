import { describe, expect, it } from 'vitest';
import { diffText, textLines, unifiedLines } from './textDiff';

const lines = (count: number, name: (i: number) => string) => Array.from({ length: count }, (_, index) => name(index + 1)).join('\n');
const ten = lines(10, (i) => `line ${i}`);
const twenty = lines(20, (i) => `l${i}`);

// What Python's difflib.unified_diff gives for each pair (the 0.12 server's own diff), without its two file lines.
const DIFFLIB: Record<string, [string, string, string[]]> = {
  'a line changed in the middle': [ten, ten.replace('line 5', 'line five'), ['@@ -2,7 +2,7 @@', ' line 2', ' line 3', ' line 4', '-line 5', '+line five', ' line 6', ' line 7', ' line 8']],
  'changes far apart': [twenty, twenty.replace('l2\n', 'L2\n').replace('l18', 'L18'), ['@@ -1,5 +1,5 @@', ' l1', '-l2', '+L2', ' l3', ' l4', ' l5', '@@ -15,6 +15,6 @@', ' l15', ' l16', ' l17', '-l18', '+L18', ' l19', ' l20']],
  'changes close together': [twenty, twenty.replace('l5', 'L5').replace('l10', 'L10'), ['@@ -2,12 +2,12 @@', ' l2', ' l3', ' l4', '-l5', '+L5', ' l6', ' l7', ' l8', ' l9', '-l10', '+L10', ' l11', ' l12', ' l13']],
  'from nothing': ['', 'a\nb', ['@@ -0,0 +1,2 @@', '+a', '+b']],
  'to nothing': ['a\nb\nc', '', ['@@ -1,3 +0,0 @@', '-a', '-b', '-c']],
  'a line put in at the top': ['b\nc\nd\ne', 'a\nb\nc\nd\ne', ['@@ -1,3 +1,4 @@', '+a', ' b', ' c', ' d']],
  'a line put in at the end': ['a\nb', 'a\nb\nc', ['@@ -1,2 +1,3 @@', ' a', ' b', '+c']],
  'a line taken out': ['a\nb\nc\nd\ne\nf\ng', 'a\nb\nc\ne\nf\ng', ['@@ -1,7 +1,6 @@', ' a', ' b', ' c', '-d', ' e', ' f', ' g']],
  'a prompt rewritten': [
    'You are a helpful assistant.\nAnswer briefly.\nUse British spelling.\n\nSign off with a smile.',
    'You are a helpful assistant.\nAnswer in detail, with examples.\nUse British spelling.\nCite sources.\n\nSign off with a smile.',
    ['@@ -1,5 +1,6 @@', ' You are a helpful assistant.', '-Answer briefly.', '+Answer in detail, with examples.', ' Use British spelling.', '+Cite sources.', ' ', ' Sign off with a smile.'],
  ],
};

/** A repeatable stream of numbers (so the shuffled texts below are the same each run). */
function numbers(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

describe('text diff', () => {
  it('reads lines as Python does: any line break, and a last one adds no line', () => {
    expect(textLines('')).toEqual([]);
    expect(textLines('a\r\nb\rc\nd\n')).toEqual(['a', 'b', 'c', 'd']);
    expect(textLines('a\n\n')).toEqual(['a', '']);
    expect(textLines('\n')).toEqual(['']);
  });

  for (const [name, [before, after, expected]] of Object.entries(DIFFLIB)) {
    it(`matches difflib: ${name}`, () => {
      expect(unifiedLines(diffText(before, after))).toEqual(expected);
    });
  }

  it('counts what was taken out and put in, and numbers each line on its side', () => {
    const diff = diffText('a\nb\nc', 'a\nB\nc\nd');
    expect(diff).toMatchObject({ removed: 1, added: 2, lineEndingsOnly: false });
    expect(diff.hunks[0]?.lines).toEqual([
      { kind: 'same', text: 'a', before: 1, after: 1 },
      { kind: 'removed', text: 'b', before: 2, after: null },
      { kind: 'added', text: 'B', before: null, after: 2 },
      { kind: 'same', text: 'c', before: 3, after: 3 },
      { kind: 'added', text: 'd', before: null, after: 4 },
    ]);
  });

  it('says when only the line breaks differ, and nothing when the texts are the same', () => {
    expect(diffText('a\r\nb', 'a\nb')).toEqual({ hunks: [], removed: 0, added: 0, lineEndingsOnly: true });
    expect(diffText('a\nb', 'a\nb\n')).toMatchObject({ hunks: [], lineEndingsOnly: true });
    expect(diffText('same', 'same')).toEqual({ hunks: [], removed: 0, added: 0, lineEndingsOnly: false });
  });

  it('takes a context of any size', () => {
    expect(unifiedLines(diffText(ten, ten.replace('line 5', 'line five'), 1))).toEqual(['@@ -4,3 +4,3 @@', ' line 4', '-line 5', '+line five', ' line 6']);
  });

  it('always rebuilds both texts, and never changes more than it must', () => {
    const next = numbers(7);
    for (let round = 0; round < 200; round += 1) {
      const words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', ''];
      const pick = () => words[Math.floor(next() * words.length)] ?? '';
      const before = Array.from({ length: Math.floor(next() * 30) }, pick);
      const after = before.flatMap((line) => (next() < 0.15 ? [] : next() < 0.15 ? [pick(), line] : next() < 0.1 ? [pick()] : [line]));
      const diff = diffText(before.join('\n'), after.join('\n'), 1_000_000);
      if (!diff.hunks.length) {
        // Nothing changed: no hunks at all.
        expect(textLines(after.join('\n'))).toEqual(textLines(before.join('\n')));
        continue;
      }
      const all = diff.hunks.flatMap((hunk) => hunk.lines);
      expect(all.filter((line) => line.kind !== 'added').map((line) => line.text)).toEqual(textLines(before.join('\n')));
      expect(all.filter((line) => line.kind !== 'removed').map((line) => line.text)).toEqual(textLines(after.join('\n')));
      // The fewest changes: what's kept is as long as the longest run both share, in order.
      const a = textLines(before.join('\n'));
      const b = textLines(after.join('\n'));
      const longest = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
      for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) longest[i]![j] = a[i] === b[j] ? longest[i + 1]![j + 1]! + 1 : Math.max(longest[i + 1]![j]!, longest[i]![j + 1]!);
      expect(a.length - diff.removed).toBe(longest[0]![0]);
    }
  });

  it('shows a huge rewrite as everything taken out and put back', () => {
    const diff = diffText(lines(1200, (i) => `old ${i}`), lines(1200, (i) => `new ${i}`));
    expect(diff).toMatchObject({ removed: 1200, added: 1200 });
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0]?.lines[0]).toEqual({ kind: 'removed', text: 'old 1', before: 1, after: null });
  });
});
