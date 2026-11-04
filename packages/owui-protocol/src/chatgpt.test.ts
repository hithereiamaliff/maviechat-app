import { describe, expect, it } from 'vitest';
import { isChatGptExport, readChatGptExport } from './chatgpt';

/** A made-up conversation in the export's shape: a hidden instruction, a branch, a tool call. */
function conversation(extra: Record<string, unknown> = {}) {
  const node = (id: string, parent: string | null, children: string[], message: Record<string, unknown> | null) => ({ id, parent, children, message });
  const said = (role: string, parts: unknown[], extra: Record<string, unknown> = {}) => ({ author: { role }, content: { content_type: 'text', parts }, create_time: 1_700_000_100, ...extra });
  return {
    title: 'Trip to Penang',
    create_time: 1_700_000_000.5,
    update_time: 1_700_000_900.25,
    conversation_id: 'conv-1',
    current_node: 'a2',
    mapping: {
      root: node('root', null, ['sys'], null),
      sys: node('sys', 'root', ['hidden'], said('system', [''])),
      hidden: node('hidden', 'sys', ['u1'], said('user', ['My custom instructions'], { metadata: { is_visually_hidden_from_conversation: true } })),
      u1: node('u1', 'hidden', ['a1', 'a1b'], said('user', ['Where should I eat?', { content_type: 'image_asset_pointer' }])),
      a1: node('a1', 'u1', [], said('assistant', ['An older answer'], { metadata: { model_slug: 'gpt-4o' } })),
      a1b: node('a1b', 'u1', ['call'], said('assistant', ['search("food")'], { recipient: 'browser' })),
      call: node('call', 'a1b', ['tool'], null),
      tool: node('tool', 'call', ['a2'], said('tool', ['results…'])),
      a2: node('a2', 'tool', [], said('assistant', ['Try ', 'Gurney Drive.'], { create_time: 1_700_000_500, metadata: { model_slug: 'gpt-4o-mini' } })),
    },
    ...extra,
  };
}

describe('ChatGPT export', () => {
  it('is told from other files by its message trees', () => {
    expect(isChatGptExport([{ mapping: {} }, {}])).toBe(true);
    expect(isChatGptExport([{ chat: { history: {} } }])).toBe(false);
  });

  it('keeps the thread you last saw, without system, hidden, tool and tool-call messages', () => {
    const { conversations, skipped } = readChatGptExport([conversation()]);
    expect(skipped).toBe(0);
    const [read] = conversations;
    expect(read).toMatchObject({ id: 'conv-1', title: 'Trip to Penang', created: 1_700_000_000.5, updated: 1_700_000_900.25, model: 'gpt-4o-mini' });
    expect(read?.messages).toEqual([
      { role: 'user', text: 'Where should I eat?', at: 1_700_000_100, model: null },
      { role: 'assistant', text: 'Try \nGurney Drive.', at: 1_700_000_500, model: 'gpt-4o-mini' },
    ]);
  });

  it('without a current node, follows the newest reply from the start', () => {
    const [read] = readChatGptExport([conversation({ current_node: undefined })]).conversations;
    expect(read?.messages.map((message) => message.text)).toEqual(['Where should I eat?', 'Try \nGurney Drive.']);
  });

  it('skips entries with nothing to keep, and reads a code reply’s text', () => {
    const empty = { title: 'Empty', mapping: { r: { id: 'r', parent: null, children: [], message: null } } };
    const code = {
      title: '',
      mapping: {
        u: { id: 'u', parent: null, children: ['a'], message: { author: { role: 'user' }, content: { parts: ['Run it'] } } },
        a: { id: 'a', parent: 'u', children: [], message: { author: { role: 'assistant' }, recipient: 'all', content: { content_type: 'code', text: 'print(1)' } } },
      },
    };
    const { conversations, skipped } = readChatGptExport([empty, 'nonsense', code], 1_800_000_000);
    expect(skipped).toBe(2);
    expect(conversations[0]).toMatchObject({ title: '', created: 1_800_000_000, model: null });
    expect(conversations[0]?.messages.map((message) => message.text)).toEqual(['Run it', 'print(1)']);
  });

  it('survives a loop in the tree', () => {
    const looped = { mapping: { a: { id: 'a', parent: 'b', children: ['b'], message: { author: { role: 'user' }, content: { parts: ['hi'] } } }, b: { id: 'b', parent: 'a', children: ['a'], message: null } }, current_node: 'a' };
    expect(readChatGptExport([looped]).conversations[0]?.messages).toHaveLength(1);
  });

  it('keeps voice transcripts, reads milliseconds, and takes the export’s own id first', () => {
    const voice = {
      id: 'conv-1',
      conversation_id: 'conv-1-old',
      create_time: 1_700_000_000_000,
      mapping: {
        a: { id: 'a', parent: null, children: ['b'], message: { author: { role: 'user' }, create_time: 1_700_000_000_500, content: { parts: [{ content_type: 'audio_transcription', text: 'Spoken question' }, { asset_pointer: 'file-1' }] } } },
        b: { id: 'b', parent: 'a', children: [], message: { author: { role: 'assistant' }, content: { parts: ['Answer'] } } },
      },
      current_node: 'b',
    };
    const [conversation] = readChatGptExport([voice]).conversations;
    expect(conversation).toMatchObject({ id: 'conv-1', created: 1_700_000_000 });
    expect(conversation?.messages.map((message) => [message.role, message.text, message.at])).toEqual([
      ['user', 'Spoken question', 1_700_000_000.5],
      ['assistant', 'Answer', null],
    ]);
  });
});
