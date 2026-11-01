import { describe, expect, it } from 'vitest';
import { exportChat, keepTail } from './export';
import type { ChatHistory } from './history';

const history: ChatHistory = {
  currentId: 'a2',
  messages: {
    u1: { id: 'u1', parentId: null, childrenIds: ['a1', 'a2'], role: 'user', content: 'Plan a day in Ipoh' },
    a1: { id: 'a1', parentId: 'u1', childrenIds: [], role: 'assistant', content: 'Old version', model: 'gpt' },
    a2: {
      id: 'a2',
      parentId: 'u1',
      childrenIds: [],
      role: 'assistant',
      content: '',
      model: 'gpt',
      output: [
        { type: 'reasoning', id: 'r', content: [{ type: 'output_text', text: 'thinking…' }] },
        { type: 'message', id: 'm', content: [{ type: 'output_text', text: 'Start with breakfast in Old Town.' }] },
      ],
    },
  },
};

describe('exportChat', () => {
  it('writes the shown branch as Markdown with model names', () => {
    const result = exportChat({ title: 'Ipoh trip', history, modelName: (id) => (id === 'gpt' ? 'GPT-4o' : 'Assistant'), source: 'chat.example.com', updatedAt: 1_761_998_400 });
    expect(result.markdown).toBe(
      '# Ipoh trip\n\nA chat from Open WebUI (chat.example.com), last updated 2025-11-01.\n\n## User\n\nPlan a day in Ipoh\n\n## GPT-4o\n\nStart with breakfast in Old Town.\n',
    );
    expect(result.markdown).not.toContain('Old version');
    expect(result.markdown).not.toContain('thinking');
    expect(result.firstQuestion).toBe('Plan a day in Ipoh');
    expect(result.summary).toBe('An Open WebUI chat with GPT-4o: 2 messages, 2025-11-01.');
    expect(result.messageCount).toBe(2);
  });

  it('copes with an untitled, empty chat', () => {
    const result = exportChat({ title: ' ', history: { currentId: null, messages: {} }, modelName: () => 'X' });
    expect(result.title).toBe('Open WebUI chat');
    expect(result.firstQuestion).toBe('Open WebUI chat');
    expect(result.summary).toBe('An Open WebUI chat: 0 messages.');
  });
});

describe('keepTail', () => {
  it('keeps short text and trims long text at a message boundary', () => {
    expect(keepTail('short', 10)).toBe('short');
    const long = `# T\n\n## User\n\n${'a'.repeat(50)}\n\n## Bot\n\nlast words`;
    const kept = keepTail(long, 30);
    expect(kept.startsWith('(Earlier messages were left out')).toBe(true);
    expect(kept.endsWith('last words')).toBe(true);
    expect(kept).toContain('\n## Bot');
  });
});
