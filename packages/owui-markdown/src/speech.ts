import type { Token } from 'marked';
import { lexMarkdown } from './lexer';

/*
 * A reply as it should sound read aloud: its words only, paragraph by paragraph. Reasoning and
 * tool details (`<details>` blocks), code, maths, images' addresses, citations and footnote marks
 * are left out; links read as their text; emoji are dropped (voices spell out their names).
 */

type Inline = Token & { tokens?: Token[]; text?: string; items?: Token[]; label?: string };

// Emoji by code point (pictographs, symbols, dingbats, flags, keycaps, joiners), as Hermes's
// regular expressions don't all know Unicode's emoji properties.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu;
/** Something worth saying: a letter or a digit in any script. */
const SAYABLE = /[0-9A-Za-z\u00AA-\u02AF\u0370-\u1FFF\u2C00-\uD7FF\uF900-\uFFDC]/;

function words(tokens: Token[] | undefined): string {
  if (!tokens) return '';
  return tokens
    .map((raw) => {
      const token = raw as Inline;
      switch (token.type) {
        case 'codespan':
          return token.text ?? '';
        case 'br':
          return ' ';
        case 'image':
          return token.text ?? '';
        case 'html':
        case 'inlineMath':
        case 'citation':
        case 'footnote':
          return '';
        case 'mention':
          return token.label ?? '';
        case 'escape':
          return token.text ?? '';
        default:
          return token.tokens ? words(token.tokens) : (token.text ?? '');
      }
    })
    .join('');
}

function blocks(tokens: Token[], out: string[]): void {
  for (const raw of tokens) {
    const token = raw as Inline & { header?: { tokens: Token[] }[]; rows?: { tokens: Token[] }[][] };
    switch (token.type) {
      case 'paragraph':
      case 'heading':
      case 'text':
        out.push(words(token.tokens) || (token.text ?? ''));
        break;
      case 'blockquote':
        blocks(token.tokens ?? [], out);
        break;
      case 'list':
        for (const item of (token.items ?? []) as Inline[]) blocks(item.tokens ?? [], out);
        break;
      case 'table':
        out.push((token.header ?? []).map((cell) => words(cell.tokens)).join(', '));
        for (const row of token.rows ?? []) out.push(row.map((cell) => words(cell.tokens)).join(', '));
        break;
      default:
        // Code, maths, raw HTML, rules and spaces aren't read.
        break;
    }
  }
}

/** The paragraphs to read aloud from a reply's Markdown (empty when there's nothing to say). */
export function speakableText(markdown: string): string[] {
  const visible = markdown.replace(/<details[^>]*>[\s\S]*?<\/details>/gi, '');
  const out: string[] = [];
  blocks(lexMarkdown(visible), out);
  return out
    .map((paragraph) =>
      paragraph
        .replace(EMOJI, '')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/[*_~`#>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((paragraph) => SAYABLE.test(paragraph));
}

/**
 * The voice language for a passage by its script, for the ones a device's default voice can't
 * read (Chinese, Japanese, Korean, Arabic, Cyrillic, Thai, Tamil, Devanagari); undefined keeps the
 * phone's own language.
 */
export function speechLanguage(text: string): string | undefined {
  if (/[぀-ヿ]/.test(text)) return 'ja-JP';
  if (/[가-힯]/.test(text)) return 'ko-KR';
  if (/[一-鿿]/.test(text)) return 'zh-CN';
  if (/[؀-ۿ]/.test(text)) return 'ar-SA';
  if (/[Ѐ-ӿ]/.test(text)) return 'ru-RU';
  if (/[฀-๿]/.test(text)) return 'th-TH';
  if (/[஀-௿]/.test(text)) return 'ta-IN';
  if (/[ऀ-ॿ]/.test(text)) return 'hi-IN';
  return undefined;
}

/** The languages `speechLanguage` tells by their script. */
const SCRIPT_LANGUAGES = new Set(['ja', 'ko', 'zh', 'ar', 'ru', 'th', 'ta', 'hi']);
const primary = (tag: string) => tag.split(/[-_]/)[0]?.toLowerCase() ?? '';

/**
 * Whether a voice you chose (by its language tag) suits a passage: one in a script-told language
 * needs a voice in that language; any other (Latin-script) text suits a voice that isn't one of those.
 */
export function voiceFits(voiceLanguage: string, text: string): boolean {
  const passage = speechLanguage(text);
  return passage ? primary(passage) === primary(voiceLanguage) : !SCRIPT_LANGUAGES.has(primary(voiceLanguage));
}
