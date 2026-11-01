import type { TokenizerExtension, Tokens } from 'marked';

/** `[1]` or `[1, 3]`: a reference to the response's sources (not a link, footnote or link definition). */
export interface CitationToken extends Tokens.Generic {
  type: 'citation';
  ids: number[];
}

/** `[^1]` or `[^note]`: a footnote reference. Like the web, it is shown raised; definitions stay plain text. */
export interface FootnoteToken extends Tokens.Generic {
  type: 'footnote';
  id: string;
}

/**
 * `<@U:id|Name>`, `<@M:model>`, `<#C:id|name>` or `<$skill|Name>`: a mention of a user,
 * model, channel or skill. `label` falls back to the id.
 */
export interface MentionToken extends Tokens.Generic {
  type: 'mention';
  trigger: '@' | '#' | '$';
  id: string;
  label: string;
}

/** `$…$`, `\(…\)` (inline) or `$$…$$` written inside a sentence (display). */
export interface InlineMathToken extends Tokens.Generic {
  type: 'inlineMath';
  text: string;
  display: boolean;
}

/** A `$$…$$` or `\[…\]` block on its own lines. */
export interface BlockMathToken extends Tokens.Generic {
  type: 'blockMath';
  text: string;
}

export const citation: TokenizerExtension = {
  name: 'citation',
  level: 'inline',
  start: (src) => src.match(/\[\d/)?.index,
  tokenizer(src) {
    const match = /^\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\](?![(:[])/.exec(src);
    if (!match) return undefined;
    const token: CitationToken = {
      type: 'citation',
      raw: match[0],
      ids: (match[1] ?? '').split(',').map((part) => Number(part.trim())),
    };
    return token;
  },
};

export const footnote: TokenizerExtension = {
  name: 'footnote',
  level: 'inline',
  start: (src) => src.match(/\[\^\s*[\w-]+\s*\]/)?.index,
  tokenizer(src) {
    const match = /^\[\^\s*([\w-]+)\s*\]/.exec(src);
    if (!match) return undefined;
    const token: FootnoteToken = { type: 'footnote', raw: match[0], id: match[1] ?? '' };
    return token;
  },
};

export const mention: TokenizerExtension = {
  name: 'mention',
  level: 'inline',
  start: (src) => src.match(/<[@#$]/)?.index,
  tokenizer(src) {
    const match = /^<([@#$])([\w.:/-]+)(?:\|([^>]*))?>/.exec(src);
    if (!match) return undefined;
    const id = match[2] ?? '';
    const token: MentionToken = {
      type: 'mention',
      raw: match[0],
      trigger: match[1] as MentionToken['trigger'],
      id,
      label: match[3] || id,
    };
    return token;
  },
};

export const blockMath: TokenizerExtension = {
  name: 'blockMath',
  level: 'block',
  start: (src) => src.match(/\$\$|\\\[/)?.index,
  tokenizer(src) {
    const match = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/.exec(src) ?? /^\\\[([\s\S]+?)\\\][ \t]*(?:\n|$)/.exec(src);
    if (!match) return undefined;
    const token: BlockMathToken = { type: 'blockMath', raw: match[0], text: (match[1] ?? '').trim() };
    return token;
  },
};

export const inlineMath: TokenizerExtension = {
  name: 'inlineMath',
  level: 'inline',
  start: (src) => src.match(/\$|\\\(/)?.index,
  tokenizer(src) {
    const display = /^\$\$([^$]+?)\$\$/.exec(src);
    if (display) return mathToken(display[0], display[1] ?? '', true);

    const paren = /^\\\(([\s\S]+?)\\\)/.exec(src);
    if (paren) return mathToken(paren[0], paren[1] ?? '', false);

    // `$x$`, but not prices: no space just inside the dollars, and no digit right after the closing one.
    const dollar = /^\$([^$\n]+?)\$(?!\d)/.exec(src);
    const body = dollar?.[1];
    if (dollar && body && !/^\s|\s$/.test(body)) return mathToken(dollar[0], body, false);
    return undefined;
  },
};

function mathToken(raw: string, text: string, display: boolean): InlineMathToken {
  return { type: 'inlineMath', raw, text: text.trim(), display };
}
