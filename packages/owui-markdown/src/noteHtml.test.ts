import { describe, expect, it } from 'vitest';
import { noteHtml } from './noteHtml';

describe('a note as the web’s editor loads it', () => {
  it('keeps single line breaks and paragraphs', () => {
    expect(noteHtml('Line one\nLine two\n\nNext')).toBe('<p>Line one<br>Line two</p>\n<p>Next</p>\n');
  });

  it('makes checklists the editor’s task lists, and leaves other lists alone', () => {
    const html = noteHtml('- [x] milk\n- [ ] eggs\n\n1. one\n2. two');
    expect(html).toContain('<ul data-type="taskList"><li data-type="taskItem" data-checked="true">milk</li>\n<li data-type="taskItem" data-checked="false">eggs</li>\n</ul>');
    expect(html).toContain('<ol>\n<li>one</li>\n<li>two</li>\n</ol>');
    expect(html).not.toContain('<input');
  });

  it('shows raw HTML as text, but for underline and line breaks', () => {
    expect(noteHtml('<u>under</u> and <b>bold</b><br/>x')).toBe('<p><u>under</u> and &lt;b&gt;bold&lt;/b&gt;<br/>x</p>\n');
    expect(noteHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('keeps tables, code and web links; drops other link addresses', () => {
    expect(noteHtml('| a | b |\n|---|---|\n| 1 | 2 |')).toContain('<table>');
    expect(noteHtml('```js\nlet x = 1;\n```')).toBe('<pre><code class="language-js">let x = 1;\n</code></pre>\n');
    expect(noteHtml('[site](https://example.com) [bad](javascript:alert(1))')).toBe('<p><a href="https://example.com">site</a> <a href="">bad</a></p>\n');
  });

  it('keeps the server’s file links: a picture inline, a file on its own line as an attachment', () => {
    expect(noteHtml('![photo.jpg](/api/v1/files/ab-12/content)')).toBe('<p><img src="/api/v1/files/ab-12/content" alt="photo.jpg"></p>\n');
    expect(noteHtml('[report.pdf](/api/v1/files/f-1/content)\n[memo.m4a](/api/v1/files/f-2/content)')).toBe(
      '<div data-file-id="f-1" data-file-size="0"><a href="/api/v1/files/f-1/content">report.pdf</a></div>\n<div data-file-id="f-2" data-file-size="0"><a href="/api/v1/files/f-2/content">memo.m4a</a></div>\n',
    );
    expect(noteHtml('see [the report](/api/v1/files/f-1/content) here')).toBe('<p>see <a href="/api/v1/files/f-1/content">the report</a> here</p>\n');
    expect(noteHtml('[x](/api/v1/files/../secret)')).toBe('<p><a href="">x</a></p>\n');
  });
});
