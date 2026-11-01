import { describe, expect, it } from 'vitest';
import { highlightCode, isKnownLanguage } from './highlight';

describe('highlightCode', () => {
  it('splits highlighted code into lines of scoped spans', () => {
    const lines = highlightCode('const x = 1;\nreturn "a";', 'javascript');
    expect(lines).toHaveLength(2);
    expect(lines[0]?.find((span) => span.text === 'const')?.scope).toBe('keyword');
    expect(lines[1]?.find((span) => span.text === '"a"')?.scope).toBe('string');
    expect(lines.map((line) => line.map((span) => span.text).join(''))).toEqual(['const x = 1;', 'return "a";']);
  });

  it('accepts aliases and info strings', () => {
    expect(isKnownLanguage('py')).toBe(true);
    expect(highlightCode('print(1)', 'py title="x.py"')[0]?.some((span) => span.scope)).toBe(true);
  });

  it('keeps unknown languages plain, including blank lines', () => {
    expect(highlightCode('a\n\nb', 'not-a-language')).toEqual([[{ text: 'a' }], [], [{ text: 'b' }]]);
  });
});
