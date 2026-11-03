import { describe, expect, it } from 'vitest';
import { codeView, mermaidPage, previewPage, vegaPage, withMath } from './webPages';

describe('codeView', () => {
  it('draws Mermaid and Vega blocks as diagrams', () => {
    expect(codeView('mermaid', 'graph TD; A-->B')).toBe('mermaid');
    expect(codeView('vega-lite', '{}')).toBe('vega');
    expect(codeView('vega', '{}')).toBe('vega');
    expect(codeView('json', '{"$schema": "https://vega.github.io/schema/vega-lite/v5.json"}')).toBe('vega');
    expect(codeView('json', '{"a": 1}')).toBeNull();
  });

  it('offers a preview of HTML and SVG', () => {
    expect(codeView('html', '<p>Hi</p>')).toBe('preview');
    expect(codeView('svg', '<svg></svg>')).toBe('preview');
    expect(codeView('xml', '<svg viewBox="0 0 1 1"></svg>')).toBe('preview');
    expect(codeView('xml', '<note/>')).toBeNull();
    expect(codeView('python', 'print(1)')).toBeNull();
    expect(codeView(undefined, 'plain')).toBeNull();
  });
});

describe('pages', () => {
  it("keeps Mermaid's code as text, in strict mode", () => {
    const html = mermaidPage('graph TD; A["<b>x</b>"]-->B', true);
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain("securityLevel:'strict'");
    expect(html).toContain("theme:\"dark\"");
  });

  it('draws a Vega spec, or nothing for broken JSON', () => {
    expect(vegaPage('{"mark": "bar", "data": {"values": [{"a": "</script>"}]}}', false)).toContain('\\u003c/script>');
    expect(vegaPage('{not json', false)).toBeNull();
    expect(vegaPage('42', false)).toBeNull();
  });

  it('previews SVG without scripts and HTML as written', () => {
    expect(previewPage('<svg onload="x()"><script>bad()</script></svg>', false)).not.toMatch(/onload|bad\(\)/);
    expect(previewPage('<!doctype html><html><body>Hi</body></html>', false)).toBe('<!doctype html><html><body>Hi</body></html>');
    expect(previewPage('<p>Hi</p>', false)).toContain('<div id="wrap"><p>Hi</p></div>');
  });
});

describe('withMath', () => {
  it('adds KaTeX to a generated page that lacks it', () => {
    const page = withMath('<html><head><title>x</title></head><body>$a^2$</body></html>');
    expect(page.indexOf('katex.min.js')).toBeLessThan(page.indexOf('</head>'));
    expect(page).toContain('auto-render.min.js');
    expect(page).toContain("left:'\\\\(',right:'\\\\)'");
    expect(withMath('<p>$x$</p>').startsWith('<link rel="stylesheet"')).toBe(true);
    const own = '<html><head><script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script></head></html>';
    expect(withMath(own)).toBe(own);
  });
});
