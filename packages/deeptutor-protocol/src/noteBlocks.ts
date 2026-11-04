import { Lexer, type Token } from 'marked';

/*
 * Markdown as Co-Writer blocks (BlockNote's, as DeepTutor keeps them), for accepting a Dito
 * suggestion that came as Markdown only. Only the kinds the app can turn safely: paragraphs,
 * headings, bullet, numbered and check lists (nested), quotes, code, rules, with bold, italic,
 * strikethrough, code and links. Anything else (a table, an image, HTML, maths) gives null, and
 * DeepTutor's own editor turns it.
 */

type Block = Record<string, unknown>;
type Inline = Record<string, unknown>;
type Styles = Record<string, true>;

const SAFE_LINK = /^(https?:\/\/|mailto:|\/|#)/i;

function textNode(text: string, styles: Styles): Inline {
  return { type: 'text', text, styles: { ...styles } };
}

/** Inline Markdown as BlockNote's inline content, or null when it holds something it can't. */
function inline(tokens: Token[] | undefined, styles: Styles = {}): Inline[] | null {
  const out: Inline[] = [];
  for (const token of tokens ?? []) {
    const nested = (extra: Styles) => {
      const inner = inline((token as { tokens?: Token[] }).tokens, { ...styles, ...extra });
      if (!inner) return false;
      out.push(...inner);
      return true;
    };
    switch (token.type) {
      case 'text':
        if ('tokens' in token && token.tokens?.length) {
          if (!nested({})) return null;
        } else out.push(textNode(token.text, styles));
        break;
      case 'escape':
      case 'html':
        // A literal character, or a tag written as text: kept as it reads.
        out.push(textNode(token.text, styles));
        break;
      case 'strong':
        if (!nested({ bold: true })) return null;
        break;
      case 'em':
        if (!nested({ italic: true })) return null;
        break;
      case 'del':
        if (!nested({ strike: true })) return null;
        break;
      case 'codespan':
        out.push(textNode(token.text, { ...styles, code: true }));
        break;
      case 'br':
        out.push(textNode('\n', styles));
        break;
      case 'link': {
        if (!SAFE_LINK.test(token.href)) return null;
        const content = inline(token.tokens, styles);
        if (!content) return null;
        out.push({ type: 'link', href: token.href, content });
        break;
      }
      default:
        return null;
    }
  }
  return out;
}

function blocks(tokens: Token[], id: () => string): Block[] | null {
  const out: Block[] = [];
  for (const token of tokens) {
    let block: Block | null = null;
    switch (token.type) {
      case 'space':
        continue;
      case 'heading': {
        const content = inline(token.tokens);
        if (content) block = { id: id(), type: 'heading', props: { level: Math.min(6, Math.max(1, token.depth)) }, content, children: [] };
        break;
      }
      case 'paragraph':
      case 'text': {
        const content = inline('tokens' in token && token.tokens ? token.tokens : [{ type: 'text', raw: token.text, text: token.text } as Token]);
        if (content) block = { id: id(), type: 'paragraph', props: {}, content, children: [] };
        break;
      }
      case 'blockquote': {
        // A quote is one block of text: its paragraphs joined by line breaks.
        const parts: Inline[] = [];
        for (const part of token.tokens ?? []) {
          if (part.type === 'space') continue;
          if (part.type !== 'paragraph') return null;
          const content = inline(part.tokens);
          if (!content) return null;
          if (parts.length) parts.push(textNode('\n', {}));
          parts.push(...content);
        }
        block = { id: id(), type: 'quote', props: {}, content: parts, children: [] };
        break;
      }
      case 'list': {
        for (const item of token.items) {
          const kind = item.task ? 'checkListItem' : token.ordered ? 'numberedListItem' : 'bulletListItem';
          let content: Inline[] | null = [];
          const children: Block[] = [];
          for (const part of item.tokens ?? []) {
            if (part.type === 'checkbox' || part.type === 'space') continue;
            if (part.type === 'list') {
              const nested = blocks([part], id);
              if (!nested) return null;
              children.push(...nested);
            } else if ((part.type === 'text' || part.type === 'paragraph') && content && !content.length) {
              content = inline('tokens' in part && part.tokens ? part.tokens : [{ type: 'text', raw: part.text, text: part.text } as Token]);
            } else return null;
          }
          if (!content) return null;
          out.push({ id: id(), type: kind, props: item.task ? { checked: Boolean(item.checked) } : {}, content, children });
        }
        continue;
      }
      case 'code':
        block = { id: id(), type: 'codeBlock', props: { language: token.lang ?? '' }, content: token.text ? [textNode(token.text, {})] : [], children: [] };
        break;
      case 'hr':
        block = { id: id(), type: 'divider', props: {}, children: [] };
        break;
      default:
        return null;
    }
    if (!block) return null;
    out.push(block);
  }
  return out;
}

/** Fresh block ids, unique within the page (DeepTutor accepts letters, digits, `_` and `-`). */
export function blockIds(prefix = `mc${Date.now().toString(36)}`): () => string {
  let next = 0;
  return () => `${prefix}-${(next++).toString(36)}`;
}

/** Markdown as blocks, or null when it holds something only DeepTutor's editor turns. */
export function blocksFromMarkdown(markdown: string, id: () => string = blockIds()): Block[] | null {
  if (!markdown.trim()) return null;
  const result = blocks(Lexer.lex(markdown), id);
  return result && result.length ? result : null;
}
