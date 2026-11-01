import { describe, expect, it } from 'vitest';
import type { Token } from 'marked';
import { IncrementalLexer, lexMarkdown } from './lexer';

const inlineTypes = (tokens: Token[]): string[] =>
  tokens.flatMap((token) => ('tokens' in token && Array.isArray(token.tokens) ? token.tokens.map((t: Token) => t.type) : []));

describe('lexMarkdown', () => {
  it('lexes GitHub-flavoured blocks', () => {
    const tokens = lexMarkdown('# Title\n\n- [x] done\n- todo\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```\n');
    expect(tokens.filter((t) => t.type !== 'space').map((t) => t.type)).toEqual(['heading', 'list', 'table', 'code']);
  });

  it('treats single newlines as line breaks', () => {
    expect(inlineTypes(lexMarkdown('one\ntwo'))).toContain('br');
  });

  it('recognises citations but not links, footnotes or definitions', () => {
    const [paragraph] = lexMarkdown('Rain is likely [1] and cold [2, 3]. See [4](https://x.test).');
    const citations = paragraph && 'tokens' in paragraph ? (paragraph.tokens ?? []).filter((t) => t.type === 'citation') : [];
    expect(citations.map((t) => (t as unknown as { ids: number[] }).ids)).toEqual([[1], [2, 3]]);
    expect(inlineTypes(lexMarkdown('[4](https://x.test)'))).toEqual(['link']);
  });

  it('recognises math and leaves prices alone', () => {
    const tokens = lexMarkdown('Area is $\\pi r^2$ or \\(a^2\\), not $5 and $10.\n\n$$\nE = mc^2\n$$\n');
    const inline = inlineTypes(tokens).filter((type) => type === 'inlineMath');
    expect(inline).toHaveLength(2);
    expect(tokens.some((t) => t.type === 'blockMath')).toBe(true);
  });
});

describe('IncrementalLexer', () => {
  const sample = [
    '# Plan',
    '',
    'First paragraph with **bold** text and a citation [1].',
    '',
    '- one',
    '- two',
    '',
    '```python',
    'print("hi")',
    '```',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    'Last line.',
  ].join('\n');

  it('matches a full lex at every step of a growing reply', () => {
    const lexer = new IncrementalLexer();
    for (let end = 1; end <= sample.length; end += 7) {
      const prefix = sample.slice(0, end);
      const incremental = lexer.lex(prefix);
      expect(incremental.map((t) => t.raw).join('')).toBe(prefix);
      expect(incremental.map((t) => t.type)).toEqual(lexMarkdown(prefix).map((t) => t.type));
    }
  });

  it('starts over when the text is replaced rather than extended', () => {
    const lexer = new IncrementalLexer();
    lexer.lex('# One\n\nTwo');
    const tokens = lexer.lex('Different');
    expect(tokens.map((t) => t.type)).toEqual(['paragraph']);
  });
});
