import type { Token, Tokens } from 'marked';
import type { ColonFenceToken } from './extensions';
import { lexMarkdown } from './lexer';

/** A section's heading: its subject, else its kind in words ("Code Execution"), then who it's to. */
export function colonFenceLabel(token: Pick<ColonFenceToken, 'kind' | 'attributes'>): string {
  const label = token.attributes.subject || token.kind.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  return token.attributes.recipient ? `${label} · ${token.attributes.recipient}` : label;
}

export type CalloutKind = 'note' | 'tip' | 'important' | 'warning' | 'caution';

/**
 * GitHub's alerts: a quote that starts with `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or
 * `[!CAUTION]` is a callout of that kind, its text being the rest of the quote. Null for other quotes.
 */
export function calloutOf(quote: Tokens.Blockquote): { kind: CalloutKind; tokens: Token[] } | null {
  const match = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\n|$)/i.exec(quote.text);
  if (!match?.[1]) return null;
  return { kind: match[1].toLowerCase() as CalloutKind, tokens: lexMarkdown(quote.text.slice(match[0].length)) };
}

/** A table as CSV, as the web exports it: every cell quoted, the cells' text without markdown. */
export function tableCsv(table: Tokens.Table): string {
  const cell = (tokens: Token[]) => `"${inlineText(tokens).replace(/"/g, '""')}"`;
  return [table.header.map((header) => cell(header.tokens)), ...table.rows.map((row) => row.map((item) => cell(item.tokens)))]
    .map((row) => row.join(','))
    .join('\n');
}

/** What inline markdown reads as: emphasis, links and code without their marks, `<br>` as a new line, other HTML tags left out. */
export function inlineText(tokens: Token[]): string {
  return tokens
    .map((token) => {
      if ('tokens' in token && Array.isArray(token.tokens) && token.tokens.length) return inlineText(token.tokens);
      switch (token.type) {
        case 'br':
          return '\n';
        case 'html':
          return (token as Tokens.HTML).text.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '');
        case 'image':
          return (token as Tokens.Image).text;
        default:
          return 'text' in token && typeof token.text === 'string' ? token.text : token.raw;
      }
    })
    .join('');
}
