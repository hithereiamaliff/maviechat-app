import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { SVG } from 'mathjax-full/js/output/svg.js';

/**
 * TeX → SVG with MathJax (Apache-2.0), for the app to draw natively. Sizes are in `ex` (half the
 * font size), so the drawing scales with the text around it.
 */
export interface MathSvg {
  /** The `<svg>`; its paint is `currentColor`, so the app sets the colour. */
  svg: string;
  width: number;
  height: number;
  /** How far the drawing sits below the text baseline (negative ex), for inline maths. */
  verticalAlign: number;
}

// "noerrors" would draw broken TeX as if it were fine; without it a mistake shows as an error, and the app falls back to the TeX itself.
const PACKAGES = AllPackages.filter((name) => name !== 'noerrors');
const CACHE_LIMIT = 500;

let convert: ((tex: string, display: boolean) => string) | null = null;
const cache = new Map<string, MathSvg | null>();

function converter(): (tex: string, display: boolean) => string {
  if (convert) return convert;
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const document = mathjax.document('', {
    InputJax: new TeX({ packages: PACKAGES }),
    // Each glyph inline (no shared <defs>/<use>), which native SVG renderers draw most reliably.
    OutputJax: new SVG({ fontCache: 'none' }),
  });
  convert = (tex, display) => adaptor.innerHTML(document.convert(tex, { display, em: 16, ex: 8, containerWidth: 80 * 16 }));
  return convert;
}

const exValue = (tag: string, name: string): number | null => {
  const match = new RegExp(`${name}="(-?[\\d.]+)ex"`).exec(tag);
  return match ? Number(match[1]) : null;
};

/** The TeX as SVG, or null when it doesn't parse (the app then shows the TeX as written). Results are cached. */
export function texToSvg(tex: string, display: boolean): MathSvg | null {
  const key = `${display ? 'D' : 'I'}${tex}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  let result: MathSvg | null = null;
  try {
    const svg = converter()(tex, display);
    const root = /<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
    const width = exValue(root, 'width');
    const height = exValue(root, 'height');
    const align = /vertical-align:\s*(-?[\d.]+)ex/.exec(root);
    if (svg.startsWith('<svg') && width !== null && height !== null && !/data-mjx-error|data-mml-node="merror"/.test(svg)) {
      result = { svg, width, height, verticalAlign: align ? Number(align[1]) : 0 };
    }
  } catch {
    result = null;
  }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, result);
  return result;
}
