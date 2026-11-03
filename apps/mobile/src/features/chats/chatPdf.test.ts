import type { ChatRecord } from '@maviechat/owui-protocol';
import { describe, expect, it } from 'vitest';
import { chatPdfHtml } from './chatPdf';

describe('chatPdfHtml', () => {
  it('prints the shown branch under who wrote it, without reasoning, never running HTML', () => {
    const chat = {
      title: 'Taxes <2026>',
      updated_at: 1793750400,
      chat: {
        history: {
          currentId: 'a2',
          messages: {
            u1: { id: 'u1', parentId: null, childrenIds: ['a1', 'a2'], role: 'user', content: 'How **much**?' },
            a1: { id: 'a1', parentId: 'u1', childrenIds: [], role: 'assistant', model: 'm1', content: 'Older' },
            a2: { id: 'a2', parentId: 'u1', childrenIds: [], role: 'assistant', model: 'm1', content: '<details type="reasoning">secret</details>About 10%. <script>x()</script>' },
          },
        },
      },
    } as unknown as ChatRecord;
    const html = chatPdfHtml(chat, (id) => (id === 'm1' ? 'Model One' : 'Assistant'));
    expect(html).toContain('<h1>Taxes &lt;2026&gt;</h1>');
    expect(html).toContain('<h2>You</h2><p>How <strong>much</strong>?</p>');
    expect(html).toContain('<h2>Model One</h2>');
    expect(html).toContain('About 10%.');
    expect(html).not.toContain('Older');
    expect(html).not.toContain('secret');
    expect(html).not.toContain('<script>');
  });
});
