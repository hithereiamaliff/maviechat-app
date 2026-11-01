import type { ElementContent, Root, RootContent } from 'hast';
import { common, createLowlight } from 'lowlight';

const lowlight = createLowlight(common);

/** A run of code text; `scope` is the highlight.js class without its `hljs-` prefix (keyword, string, …). */
export interface CodeSpan {
  text: string;
  scope?: string;
}

export type CodeLine = CodeSpan[];

/** Guessing the language of long snippets is slow; they stay plain. */
const MAX_AUTODETECT_LENGTH = 4000;

/** Splits code into lines of styled spans. Unknown languages and failures fall back to plain lines. */
export function highlightCode(code: string, lang?: string | null): CodeLine[] {
  const language = (lang ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  let tree: Root | null = null;
  try {
    if (language && lowlight.registered(language)) tree = lowlight.highlight(language, code);
    else if (!language && code.length <= MAX_AUTODETECT_LENGTH) tree = lowlight.highlightAuto(code);
  } catch {
    tree = null;
  }
  return tree ? flatten(tree) : code.split('\n').map((line) => (line ? [{ text: line }] : []));
}

export function isKnownLanguage(lang: string): boolean {
  return lowlight.registered(lang.toLowerCase());
}

function flatten(tree: Root): CodeLine[] {
  const lines: CodeLine[] = [[]];
  const visit = (nodes: (RootContent | ElementContent)[], scope: string | undefined) => {
    for (const node of nodes) {
      if (node.type === 'text') {
        node.value.split('\n').forEach((part, index) => {
          if (index > 0) lines.push([]);
          if (part) lines[lines.length - 1]?.push(scope ? { text: part, scope } : { text: part });
        });
      } else if (node.type === 'element') {
        const className = node.properties?.className;
        const hljs = Array.isArray(className) ? className.map(String).find((name) => name.startsWith('hljs-')) : undefined;
        visit(node.children, hljs ? hljs.slice('hljs-'.length) : scope);
      }
    }
  };
  visit(tree.children, undefined);
  return lines;
}
