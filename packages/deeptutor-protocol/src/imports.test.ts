import { describe, expect, it } from 'vitest';
import { DtClient, type FetchLike } from './http';
import { chatGptImportSessions, groupImportedChats, importBatches, importedChatId, listImportedChats } from './imports';

function recordingClient(...answers: unknown[]) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(answers.shift() ?? {}), { status: 200 });
  };
  return { client: new DtClient({ baseUrl: 'https://learn.test', token: 't', fetch }), calls };
}

describe('imported conversations', () => {
  it('lists them with where each came from', async () => {
    const { client, calls } = recordingClient({
      sessions: [
        { id: 'imported_chatgpt_abc', title: 'Trip', updated_at: 1_730_000_000, preferences: { import: { source: 'chatgpt', external_id: 'abc' } } },
        { id: 'imported_claude_code_x1', title: 'Fix', created_at: 1_730_000_100, preferences: {} },
        { title: 'no id' },
      ],
    });
    const chats = await listImportedChats(client);
    expect(calls[0]?.url).toBe('https://learn.test/api/imports/chat-history?limit=200&offset=0');
    expect(chats.map((chat) => [chat.id, chat.imported.source])).toEqual([
      ['imported_chatgpt_abc', 'chatgpt'],
      ['imported_claude_code_x1', 'claude_code'],
    ]);
  });

  it('groups them as the web page does, with ChatGPT’s too, newest first', () => {
    const chat = (id: string, source: string, extra: Partial<{ folder: string; agentId: string; agentName: string }>, at: number) => ({ id, title: id, created_at: at, updated_at: at, imported: { source, folder: '', agentId: '', agentName: '', ...extra } });
    const groups = groupImportedChats([
      chat('a', 'chatgpt', {}, 100),
      chat('b', 'claude_code', { folder: '/home/me/app' }, 300),
      chat('c', 'claude_code', { agentId: 'cc-1', agentName: 'Work laptop' }, 200),
      chat('d', 'codex', {}, 1_730_000_000),
      chat('e', 'chatgpt', {}, 400),
    ]);
    expect(groups.map((group) => [group.label, group.chats.map((item) => item.id)])).toEqual([
      ['Codex · 2024-10-27', ['d']],
      ['ChatGPT', ['e', 'a']],
      ['Claude Code · app', ['b']],
      ['Work laptop', ['c']],
    ]);
  });

  it('turns ChatGPT conversations into DeepTutor’s import, once each, titled', () => {
    const sessions = chatGptImportSessions([
      { id: 'c1', title: '', created: 10, updated: 5, messages: [{ role: 'user', text: 'How   do tides\\nwork?', at: 10 }, { role: 'assistant', text: 'The moon.', at: null }] },
      { id: 'c1', title: 'Again', created: 1, updated: 1, messages: [] },
      { id: null, title: 'No id', created: 1, updated: 1, messages: [] },
    ]);
    expect(sessions).toEqual([
      {
        external_id: 'c1',
        title: 'How do tides\\nwork?',
        source_cwd: '',
        created_at: 10,
        updated_at: 10,
        messages: [
          { role: 'user', content: 'How   do tides\\nwork?', created_at: 10 },
          { role: 'assistant', content: 'The moon.' },
        ],
      },
    ]);
    expect(importedChatId('chatgpt', 'a/b c')).toBe('imported_chatgpt_a-b-c');
  });

  it('sends at most 100 conversations, and about 4 MB, at a time', () => {
    const one = (index: number, size = 10) => ({ external_id: String(index), title: '', source_cwd: '', created_at: 1, updated_at: 1, messages: [{ role: 'user' as const, content: 'x'.repeat(size) }] });
    expect(importBatches(Array.from({ length: 250 }, (_, index) => one(index))).map((batch) => batch.length)).toEqual([100, 100, 50]);
    expect(importBatches([one(1, 3_000_000), one(2, 3_000_000), one(3)]).map((batch) => batch.length)).toEqual([1, 2]);
  });
});
