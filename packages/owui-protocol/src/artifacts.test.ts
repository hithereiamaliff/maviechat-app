import { describe, expect, it } from 'vitest';
import { artifactIndex, branchArtifacts, messageArtifacts, withCsp } from './artifacts';

const fence = (lang: string, code: string) => `\`\`\`${lang}\n${code}\n\`\`\``;

describe('artifacts', () => {
  it('makes a page of an HTML block with the CSS and JS after it', () => {
    const text = ['Here it is:', fence('html', '<h1>Hi</h1>'), fence('css', 'h1 { color: red; }'), fence('javascript', 'console.log(1);')].join('\n\n');
    const [page, ...rest] = messageArtifacts(text);
    expect(rest).toEqual([]);
    expect(page?.kind).toBe('html');
    expect(page?.content).toContain('<h1>Hi</h1>');
    expect(page?.content).toContain('h1 { color: red; }');
    expect(page?.content).toContain('console.log(1);');
    expect(page?.content.indexOf('<h1>Hi</h1>')).toBeLessThan(page?.content.indexOf('console.log(1);') ?? 0);
  });

  it('starts a page at every HTML block, and gives CSS or JS without one a page of their own', () => {
    expect(messageArtifacts([fence('html', '<p>a</p>'), fence('js', 'a()'), fence('html', '<p>b</p>')].join('\n')).map((page) => page.sources)).toEqual([
      ['<p>a</p>\n', 'a()\n'],
      ['<p>b</p>\n'],
    ]);
    expect(messageArtifacts(fence('js', 'alert(1)'))).toHaveLength(1);
    expect(messageArtifacts(fence('python', 'print(1)'))).toEqual([]);
  });

  it('offers SVG blocks when a reply makes no page, and reads inline HTML when it has no blocks', () => {
    const svg = '<svg viewBox="0 0 1 1"></svg>';
    expect(messageArtifacts(fence('svg', svg)).map((item) => item.kind)).toEqual(['svg']);
    expect(messageArtifacts(fence('xml', svg))[0]?.content.trim()).toBe(svg);
    expect(messageArtifacts([fence('html', '<p>x</p>'), fence('svg', svg)].join('\n')).map((item) => item.kind)).toEqual(['html']);
    const inline = messageArtifacts('Try <html><b>bold</b></html> with <style>b { color: blue; }</style>');
    expect(inline).toHaveLength(1);
    expect(inline[0]?.content).toContain('<b>bold</b>');
    expect(inline[0]?.content).toContain('color: blue');
  });

  it('numbers versions across the branch, and finds the one a code block made', () => {
    const versions = branchArtifacts([fence('html', '<p>one</p>'), '', 'no code', fence('html', '<p>two</p>')]);
    expect(versions).toHaveLength(2);
    expect(artifactIndex(versions, '<p>two</p>\n')).toBe(1);
    expect(artifactIndex(versions, '<p>three</p>')).toBe(-1);
    expect(artifactIndex(versions, '  ')).toBe(-1);
  });

  it('puts the admin’s Content Security Policy first in the head', () => {
    expect(withCsp('<html><head><title>t</title></head></html>', "default-src 'self'")).toBe(
      '<html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'"><title>t</title></head></html>',
    );
    expect(withCsp('<p>x</p>', 'a "b"')).toBe('<meta http-equiv="Content-Security-Policy" content="a &quot;b&quot;"><p>x</p>');
    expect(withCsp('<p>x</p>', '')).toBe('<p>x</p>');
  });
});
