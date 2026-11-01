import { describe, expect, it } from 'vitest';
import { cleanSvg, visualHtml } from './visualHtml';

const visual = (renderType: string, data: string) => ({ renderType, data, title: '', description: '', code: { language: 'json', content: data } });

describe('drawing a Visualize result', () => {
  it('feeds a Chart.js config to the pinned Chart.js, safe inside its script', () => {
    const html = visualHtml(visual('chartjs', JSON.stringify({ type: 'bar', data: { labels: ['</script><b>'] } })), false)!;
    expect(html).toContain('chart.js@4.4.6');
    expect(html).toContain('\\u003c/script>\\u003cb>');
    expect(html).not.toContain('</script><b>');
    expect(visualHtml(visual('chartjs', 'not json'), false)).toBeNull();
  });

  it('draws SVG without its scripts or handlers, and Mermaid as escaped text', () => {
    expect(cleanSvg('<svg onload="x()"><script>bad()</script><rect onclick=\'y()\' width="2"/></svg>')).toBe('<svg><rect width="2"/></svg>');
    const mermaid = visualHtml(visual('mindmap', 'mindmap\n  root((A<b>))'), true)!;
    expect(mermaid).toContain('root((A&lt;b&gt;))');
    expect(mermaid).toContain("theme:\"dark\"");
  });

  it('leaves kinds it cannot draw to the web app', () => {
    expect(visualHtml(visual('geogebra', '{}'), false)).toBeNull();
    expect(visualHtml(visual('manim_video', '{}'), false)).toBeNull();
    expect(visualHtml(visual('html', '<html><body><p>Hi</p></body></html>'), false)).toContain('ReactNativeWebView');
  });
});
