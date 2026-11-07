import { Marked, type Token } from 'marked';
import { blockMath, citation, colonFence, footnote, inlineMath, mention } from './extensions';

const markdown = new Marked({ gfm: true, breaks: true });
markdown.use({ extensions: [colonFence, blockMath, inlineMath, citation, footnote, mention] });

/** GitHub-flavoured markdown with line breaks, plus citations, math, footnote references, mentions and `:::` sections. */
export function lexMarkdown(source: string): Token[] {
  return [...markdown.lexer(source)];
}

/**
 * Lexes text that only grows (a streaming reply) without re-reading what is settled:
 * every block except the last is kept, and lexing restarts at the last block, which
 * may still be incomplete. Any other change falls back to a full lex.
 */
export class IncrementalLexer {
  private source = '';
  private tokens: Token[] = [];

  lex(source: string): Token[] {
    if (this.tokens.length < 2 || !source.startsWith(this.source)) return this.full(source);
    if (source === this.source) return this.tokens;

    const settled = this.tokens.slice(0, -1);
    const settledRaw = settled.map((token) => token.raw).join('');
    if (!source.startsWith(settledRaw)) return this.full(source);

    this.source = source;
    this.tokens = [...settled, ...lexMarkdown(source.slice(settledRaw.length))];
    return this.tokens;
  }

  private full(source: string): Token[] {
    this.source = source;
    this.tokens = lexMarkdown(source);
    return this.tokens;
  }
}
