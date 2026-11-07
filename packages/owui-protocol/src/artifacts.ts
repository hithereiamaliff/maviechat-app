/*
 * Artifacts, as the web finds them in a chat: pages made from the code in the replies on the
 * shown branch. In each reply, every ```html block starts a page; ```css and ```js (or
 * ```javascript) blocks join the latest page (or start one). A reply without fenced code uses
 * inline <html>, <style> and <script> the same way. A reply that makes no page offers its SVG
 * blocks instead. Each page or SVG is one version, in the order the replies came.
 */

export interface Artifact {
  kind: 'html' | 'svg';
  /** A whole HTML document, or the SVG. */
  content: string;
  /** The code it was made from, so a code block's Preview can open the version holding it. */
  sources: string[];
}

interface Group {
  html: string;
  css: string;
  js: string;
  sources: string[];
}

/** The text's fenced code blocks: each block's first line (lowercased) and its code. */
function fencedBlocks(text: string): { lang: string; code: string }[] {
  const blocks: { lang: string; code: string }[] = [];
  for (const match of text.matchAll(/```([^\n]*)\n([\s\S]*?)```/g)) {
    blocks.push({ lang: (match[1] ?? '').trim().toLowerCase(), code: match[2] ?? '' });
  }
  return blocks;
}

/** A page from one group, with a white background as the web gives its artifacts. */
export function artifactDocument(group: { html: string; css: string; js: string }): string {
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<style>\nbody { background-color: white; }\n${group.css}\n</style>`,
    '</head>',
    '<body>',
    group.html,
    `<script>\n${group.js}\n</script>`,
    '</body>',
    '</html>',
  ].join('\n');
}

/** The artifacts in one reply's visible text (no reasoning or tool steps). */
export function messageArtifacts(text: string): Artifact[] {
  const groups: Group[] = [];
  const current = (): Group => {
    if (!groups.length) groups.push({ html: '', css: '', js: '', sources: [] });
    return groups[groups.length - 1] as Group;
  };
  const blocks = fencedBlocks(text);
  if (blocks.length) {
    for (const { lang, code } of blocks) {
      if (lang === 'html') groups.push({ html: code, css: '', js: '', sources: [code] });
      else if (lang === 'css') {
        const group = current();
        group.css += `${code}\n`;
        group.sources.push(code);
      } else if (lang === 'js' || lang === 'javascript') {
        const group = current();
        group.js += `${code}\n`;
        group.sources.push(code);
      }
    }
  } else {
    for (const match of text.matchAll(/<html>([\s\S]*?)<\/html>/gi)) groups.push({ html: match[1] ?? '', css: '', js: '', sources: [match[0]] });
    for (const match of text.matchAll(/<style>([\s\S]*?)<\/style>/gi)) {
      const group = current();
      group.css += `${match[1] ?? ''}\n`;
      group.sources.push(match[0]);
    }
    for (const match of text.matchAll(/<script>([\s\S]*?)<\/script>/gi)) {
      const group = current();
      group.js += `${match[1] ?? ''}\n`;
      group.sources.push(match[0]);
    }
  }
  const pages = groups
    .map((group) => ({ html: group.html.trim(), css: group.css.trim(), js: group.js.trim(), sources: group.sources }))
    .filter((group) => group.html || group.css || group.js);
  if (pages.length) return pages.map((group) => ({ kind: 'html', content: artifactDocument(group), sources: group.sources }));
  return blocks
    .filter((block) => block.lang === 'svg' || (block.lang === 'xml' && block.code.includes('<svg')))
    .map((block) => ({ kind: 'svg', content: block.code, sources: [block.code] }));
}

/** Every artifact on the shown branch, from its replies' visible texts in order. */
export function branchArtifacts(replyTexts: string[]): Artifact[] {
  return replyTexts.flatMap((text) => (text.trim() ? messageArtifacts(text) : []));
}

/** The version a code block's Preview opens: the first made from that code, or -1. */
export function artifactIndex(artifacts: Artifact[], code: string): number {
  const wanted = code.trim();
  if (!wanted) return -1;
  return artifacts.findIndex((artifact) => artifact.sources.some((source) => source.trim() === wanted) || artifact.content.includes(wanted));
}

/** The admin's Content Security Policy for artifacts (`ui.iframe_csp`), put first in the page's head. */
export function withCsp(html: string, csp: string | null | undefined): string {
  if (!csp) return html;
  const tag = `<meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, '&quot;')}">`;
  const head = html.indexOf('<head>');
  return head === -1 ? `${tag}${html}` : `${html.slice(0, head + 6)}${tag}${html.slice(head + 6)}`;
}
