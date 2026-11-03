/*
 * Small web pages for what native views can't draw (charts, diagrams, HTML previews), shown in a
 * sandboxed web view. Renderers are pinned and loaded from jsDelivr inside that web view.
 */

// MIT (Chart.js, Mermaid) and BSD-3-Clause (Vega) renderers, at fixed versions.
export const CHART_JS = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js';
export const MERMAID = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js';
const VEGA = 'https://cdn.jsdelivr.net/npm/vega@5.33.1/build/vega.min.js';
const VEGA_LITE = 'https://cdn.jsdelivr.net/npm/vega-lite@5.23.0/build/vega-lite.min.js';
const VEGA_EMBED = 'https://cdn.jsdelivr.net/npm/vega-embed@6.29.0/build/vega-embed.min.js';

// KaTeX (MIT) for maths in generated pages, at a fixed version.
const KATEX = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist';

/** Tells the app the content's height, so the web view fits it without scrolling. */
export const SIZE_SCRIPT = `<script>(function(){function post(){var h=Math.ceil(document.documentElement.scrollHeight);if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify({height:h}));}window.addEventListener('load',function(){post();setTimeout(post,400);setTimeout(post,1500);});if(window.ResizeObserver)new ResizeObserver(post).observe(document.body);})();</script>`;

/** A page in the app's colours with `body` inside, then `scripts`. */
export function page(body: string, dark: boolean, scripts = ''): string {
  const background = dark ? '#171717' : '#ffffff';
  const text = dark ? '#e5e5e5' : '#171717';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><style>html,body{margin:0;padding:0;background:${background};color:${text};font-family:-apple-system,system-ui,sans-serif}#wrap{padding:8px}svg{max-width:100%;height:auto}</style></head><body><div id="wrap">${body}</div>${scripts}${SIZE_SCRIPT}</body></html>`;
}

export const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** JSON placed inside a <script> can't close it early. */
export const inScript = (json: string) => json.replace(/</g, '\\u003c');

/** An SVG without scripts or event handlers. */
export function cleanSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script[^>]*\/>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

/** A Mermaid diagram, drawn with strict security (no scripts or clicks from the diagram). */
export function mermaidPage(code: string, dark: boolean): string {
  return page(
    `<pre class="mermaid">${escapeHtml(code)}</pre>`,
    dark,
    `<script src="${MERMAID}"></script><script>mermaid.initialize({startOnLoad:true,securityLevel:'strict',theme:${JSON.stringify(dark ? 'dark' : 'default')}});</script>`,
  );
}

/** A Vega or Vega-Lite chart from its JSON spec, or null when the JSON doesn't parse. */
export function vegaPage(spec: string, dark: boolean): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(spec);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const options = { actions: false, renderer: 'svg', theme: dark ? 'dark' : undefined };
  return page(
    '<div id="chart" style="width:100%"></div>',
    dark,
    `<script src="${VEGA}"></script><script src="${VEGA_LITE}"></script><script src="${VEGA_EMBED}"></script><script>vegaEmbed('#chart',${inScript(JSON.stringify(parsed))},${JSON.stringify(options)}).catch(function(e){document.getElementById('chart').textContent='This chart could not be drawn: '+e.message;});</script>`,
  );
}

/** What a code block can be drawn as: a diagram in place of its code, or a page to preview. */
export function codeView(lang: string | undefined, code: string): 'mermaid' | 'vega' | 'preview' | null {
  const name = (lang ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (name === 'mermaid' || name === 'mmd') return 'mermaid';
  if (name === 'vega' || name === 'vega-lite' || name === 'vegalite') return 'vega';
  if (name === 'json' && /"\$schema"\s*:\s*"https:\/\/vega\.github\.io\/schema\/vega(-lite)?\//.test(code)) return 'vega';
  if (name === 'html' || name === 'htm' || name === 'svg' || ((name === 'xml' || name === '') && /^\s*<svg[\s>]/i.test(code))) return 'preview';
  return null;
}

/**
 * An HTML or SVG code block as a page. HTML runs as written (scripts included, as the web's
 * artifacts do) inside the sandboxed web view; SVG is shown without scripts.
 */
export function previewPage(code: string, dark: boolean): string {
  if (/^\s*<svg[\s>]/i.test(code)) return page(cleanSvg(code), dark);
  if (/<html[\s>]/i.test(code)) return code;
  return page(code, dark);
}

/**
 * A generated HTML page with KaTeX added, so `$…$`, `$$…$$`, `\(…\)` and `\[…\]` show as maths,
 * unless the page brings KaTeX itself.
 */
export function withMath(html: string): string {
  if (/katex/i.test(html)) return html;
  const render = `renderMathInElement(document.body,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false},{left:'\\\\(',right:'\\\\)',display:false},{left:'\\\\[',right:'\\\\]',display:true}],throwOnError:false})`;
  const head = `<link rel="stylesheet" href="${KATEX}/katex.min.css"><script defer src="${KATEX}/katex.min.js"></script><script defer src="${KATEX}/contrib/auto-render.min.js" onload="${render}"></script>`;
  return /<\/head\s*>/i.test(html) ? html.replace(/<\/head\s*>/i, `${head}</head>`) : `${head}${html}`;
}
