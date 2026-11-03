import type { DtVisual } from '@maviechat/deeptutor-protocol';
import { CHART_JS, cleanSvg, inScript, mermaidPage, page, SIZE_SCRIPT } from '@/markdown/webPages';

export { cleanSvg };

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
      return mermaidPage(visual.data, dark);
    case 'html':
      return /<html[\s>]/i.test(visual.data)
        ? visual.data.replace(/<\/body\s*>/i, `${SIZE_SCRIPT}</body>`)
        : page(visual.data, dark);
    default:
      return null;
  }
}
