import { describe, expect, it } from 'vitest';
import { escapeHtml, markdownToHtml } from './html';
import { speakableText, speechLanguage } from './speech';

describe('speakableText', () => {
  it('reads the words and leaves out what a voice shouldn’t say', () => {
    const reply = [
      '<details type="reasoning"><summary>Thought</summary>Private reasoning</details>',
      '# Kuala **Lumpur** 🇲🇾',
      '',
      'It is the [capital](https://example.com) of Malaysia [1]. Area: $243 km^2$.',
      '',
      '```python',
      'print("not read")',
      '```',
      '',
      '- First point',
      '- Second `code` point',
      '',
      '| City | State |',
      '| --- | --- |',
      '| Ipoh | Perak |',
      '',
      'See https://example.com/page 😀',
    ].join('\n');
    expect(speakableText(reply)).toEqual(['Kuala Lumpur', 'It is the capital of Malaysia . Area: .', 'First point', 'Second code point', 'City, State', 'Ipoh, Perak', 'See']);
  });

  it('says nothing for a reply of only code or maths', () => {
    expect(speakableText('```js\nx()\n```\n\n$$x^2$$')).toEqual([]);
  });

  it('picks a voice language by script', () => {
    expect(speechLanguage('你好，世界')).toBe('zh-CN');
    expect(speechLanguage('こんにちは')).toBe('ja-JP');
    expect(speechLanguage('안녕하세요')).toBe('ko-KR');
    expect(speechLanguage('வணக்கம்')).toBe('ta-IN');
    expect(speechLanguage('Selamat pagi')).toBeUndefined();
  });
});

describe('markdownToHtml', () => {
  it('renders Markdown and never runs raw HTML or odd links', () => {
    const html = markdownToHtml('**Bold** <script>alert(1)</script>\n\n[x](javascript:alert(1)) [y](https://a.example)');
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="https://a.example"');
    expect(escapeHtml('<a & "b">')).toBe('&lt;a &amp; &quot;b&quot;&gt;');
  });
});
