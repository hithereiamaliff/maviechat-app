import { describe, expect, it } from 'vitest';
import type { Tokens } from 'marked';
import { calloutOf, colonFenceLabel, inlineText, tableCsv } from './blocks';
import type { ColonFenceToken } from './extensions';
import { lexMarkdown } from './lexer';

const fence = (source: string) => lexMarkdown(source).find((token) => token.type === 'colonFence') as ColonFenceToken | undefined;

describe(':::sections', () => {
  it('reads a section and the markdown inside it', () => {
    const token = fence('Before\n\n:::writing\n\nDear Sam,\n\n**Thanks** for coming.\n:::\n\nAfter');
    expect(token?.kind).toBe('writing');
    expect(token?.attributes).toEqual({});
    expect(token?.text).toBe('Dear Sam,\n\n**Thanks** for coming.');
    expect(token?.tokens.filter((child) => child.type !== 'space').map((child) => child.type)).toEqual(['paragraph', 'paragraph']);
    expect(lexMarkdown('Before\n\n:::writing\nx\n:::\n\nAfter').filter((t) => t.type !== 'space').map((t) => t.type)).toEqual(['paragraph', 'colonFence', 'paragraph']);
  });

  it('takes attributes only from braces right after the kind', () => {
    expect(fence(':::writing{variant="email" subject="Short question" recipient="sam@example.com"}\nHello\n:::')?.attributes).toEqual({
      variant: 'email',
      subject: 'Short question',
      recipient: 'sam@example.com',
    });
    expect(fence(':::writing{variant="document"} draft subject="junk"\nHello\n:::')?.attributes).toEqual({ variant: 'document' });
    expect(fence(':::note about recipient="x@example.com"\nHello\n:::')?.attributes).toEqual({});
    expect(fence(':::writing{subject="Short question"\nHello\n:::')?.attributes).toEqual({});
    expect(fence(':::writing{subject="use {x} here"}\nHello\n:::')?.attributes.subject).toBe('use {x} here');
  });

  it('stays plain text until it is closed', () => {
    expect(fence(':::writing\nDear Sam,\nstill writing')).toBeUndefined();
    expect(fence(':::\nnot a section\n:::')).toBeUndefined();
  });

  it('ends a paragraph where a section starts', () => {
    const types = lexMarkdown('Here it is:\n:::writing\nHello\n:::').map((token) => token.type);
    expect(types).toEqual(['paragraph', 'colonFence']);
  });

  it('labels a section by its subject, else its kind, then who it is to', () => {
    expect(colonFenceLabel({ kind: 'code_execution', attributes: {} })).toBe('Code Execution');
    expect(colonFenceLabel({ kind: 'writing', attributes: { subject: 'Short question', recipient: 'sam@example.com' } })).toBe('Short question · sam@example.com');
  });
});

describe('calloutOf', () => {
  const quote = (source: string) => lexMarkdown(source)[0] as Tokens.Blockquote;

  it('reads GitHub alerts', () => {
    const callout = calloutOf(quote('> [!WARNING]\n> Mind the **gap**.\n> Really.'));
    expect(callout?.kind).toBe('warning');
    expect(callout?.tokens.map((token) => token.type)).toEqual(['paragraph']);
    expect(calloutOf(quote('> [!tip]\n> Lower case works too'))?.kind).toBe('tip');
  });

  it('leaves other quotes alone', () => {
    expect(calloutOf(quote('> Just a quote'))).toBeNull();
    expect(calloutOf(quote('> [!NOPE]\n> unknown kind'))).toBeNull();
    expect(calloutOf(quote('> [!NOTE] and more on the same line'))).toBeNull();
  });
});

describe('tableCsv', () => {
  it('quotes every cell and drops the markdown', () => {
    const table = lexMarkdown('| Name | Note |\n|---|---:|\n| **Ann** | says "hi", `twice` |\n| [Bo](https://example.com) | a<br>b |')[0] as Tokens.Table;
    expect(tableCsv(table)).toBe('"Name","Note"\n"Ann","says ""hi"", twice"\n"Bo","a\nb"');
  });

  it('reads inline text', () => {
    const paragraph = lexMarkdown('a *b* ~~c~~ ![d](x.png) e\\*f')[0] as Tokens.Paragraph;
    expect(inlineText(paragraph.tokens)).toBe('a b c d e*f');
  });
});
