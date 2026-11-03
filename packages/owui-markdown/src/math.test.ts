import { describe, expect, it } from 'vitest';
import { texToSvg } from './math';

describe('texToSvg', () => {
  it('draws inline maths with its size and baseline', () => {
    const math = texToSvg('x^2 + \\frac{1}{2}', false);
    expect(math).not.toBeNull();
    expect(math!.svg.startsWith('<svg')).toBe(true);
    expect(math!.width).toBeGreaterThan(3);
    expect(math!.height).toBeGreaterThan(1);
    expect(math!.verticalAlign).toBeLessThan(0);
    // Painted in currentColor, so the app picks the colour; glyphs inline, no <use>.
    expect(math!.svg).toContain('currentColor');
    expect(math!.svg).not.toContain('<use');
  });

  it('draws display maths, matrices, chemistry and text', () => {
    for (const tex of ['\\int_0^1 x\\,dx = \\tfrac12', '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', '\\ce{2H2 + O2 -> 2H2O}', '\\text{area} = \\pi r^2', '\\mathbb{R}^n', '\\cancel{x}']) {
      expect(texToSvg(tex, true), tex).not.toBeNull();
    }
  });

  it('gives up on broken TeX, so the app can show it as written', () => {
    expect(texToSvg('\\frac{1}{', true)).toBeNull();
  });

  it('draws an unknown command in red within the rest, as MathJax does', () => {
    expect(texToSvg('\\notamacro{x}', false)?.svg).toContain('fill="red"');
  });

  it('answers the same TeX from its cache', () => {
    expect(texToSvg('a+b', false)).toBe(texToSvg('a+b', false));
  });
});
