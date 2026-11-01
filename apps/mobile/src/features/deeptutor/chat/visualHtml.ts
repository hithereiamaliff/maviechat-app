import type { DtVisual } from '@maviechat/deeptutor-protocol';

// Pinned, MIT-licensed renderers, loaded inside the visual's own sandboxed web view.
const CHART_JS = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js';
const MERMAID = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js';

/** Tells the app the drawing's height, so the web view fits it without scrolling. */
const SIZE_SCRIPT = `<script>(function(){function post(){var h=Math.ceil(document.documentElement.scrollHeight);if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify({height:h}));}window.addEventListener('load',function(){post();setTimeout(post,400);setTimeout(post,1500);});if(window.ResizeObserver)new ResizeObserver(post).observe(document.body);})();</script>`;

function page(body: string, dark: boolean, scripts = ''): string {
  const background = dark ? '#171717' : '#ffffff';
  const text = dark ? '#e5e5e5' : '#171717';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><style>html,body{margin:0;padding:0;background:${background};color:${text};font-family:-apple-system,system-ui,sans-serif}#wrap{padding:8px}svg{max-width:100%;height:auto}</style></head><body><div id="wrap">${body}</div>${scripts}${SIZE_SCRIPT}</body></html>`;
}

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** JSON placed inside a <script> can't close it early. */
const inScript = (json: string) => json.replace(/</g, '\\u003c');

/** An SVG without scripts or event handlers. */
export function cleanSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script[^>]*\/>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

/**
 * A page that draws a Visualize result, or null for kinds the app doesn't draw (GeoGebra,
 * animations), which open in DeepTutor's web app instead.
 */
export function visualHtml(visual: DtVisual, dark: boolean): string | null {
  switch (visual.renderType) {
    case 'chartjs': {
      let config: unknown;
      try {
        config = JSON.parse(visual.data);
      } catch {
        return null;
      }
      const setup = `Chart.defaults.color=${JSON.stringify(dark ? '#d4d4d4' : '#404040')};Chart.defaults.borderColor=${JSON.stringify(dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)')};var config=${inScript(JSON.stringify(config))};config.options=Object.assign({},config.options,{responsive:true,maintainAspectRatio:false,animation:false});new Chart(document.getElementById('chart'),config);`;
      return page('<div style="position:relative;height:300px"><canvas id="chart"></canvas></div>', dark, `<script src="${CHART_JS}"></script><script>${setup}</script>`);
    }
    case 'svg':
      return page(cleanSvg(visual.data), dark);
    case 'mermaid':
    case 'mindmap':
      return page(
        `<pre class="mermaid">${escapeHtml(visual.data)}</pre>`,
        dark,
        `<script src="${MERMAID}"></script><script>mermaid.initialize({startOnLoad:true,securityLevel:'strict',theme:${JSON.stringify(dark ? 'dark' : 'default')}});</script>`,
      );
    case 'html':
      return /<html[\s>]/i.test(visual.data)
        ? visual.data.replace(/<\/body\s*>/i, `${SIZE_SCRIPT}</body>`)
        : page(visual.data, dark);
    default:
      return null;
  }
}
