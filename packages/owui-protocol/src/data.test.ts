import { describe, expect, it } from 'vitest';
import { archiveAllChats, deleteAllChats } from './chats';
import { chatFromConversation, exportAllChats, exportArchivedChats, exportFileNameAt, IMPORT_BATCH, ImportFileError, importChats, jsonLinesToArray, readImportFile } from './data';
import { countFiles, fileContentUrl, fileSizeLabel, searchFiles } from './files';
import { OwuiClient, type FetchLike } from './http';
import { listSharedChats, unshareAllChats } from './sharing';

function recordingClient(answer: unknown, status = 200, raw = false) {
  const calls: { method: string; url: string; body: unknown; accept: string | undefined }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined, accept: (init?.headers as Record<string, string> | undefined)?.Accept });
    return new Response(raw ? String(answer) : JSON.stringify(answer), { status });
  };
  return { client: new OwuiClient({ baseUrl: 'https://x.test', token: 't', fetch }), calls };
}

describe('export', () => {
  it('turns the server’s lines into one JSON array, leaving out broken lines', () => {
    expect(jsonLinesToArray('{"id":"a"}\n\n{"id":"b"}\r\n{broken\n')).toEqual({ json: '[{"id":"a"},{"id":"b"}]', count: 2 });
    expect(jsonLinesToArray('[{"id":"a"}]')).toEqual({ json: '[{"id":"a"}]', count: 1 });
    expect(jsonLinesToArray('')).toEqual({ json: '[]', count: 0 });
  });

  it('asks for every chat as JSON lines, and archived ones as a list', async () => {
    const lines = recordingClient('{"id":"a","title":"A"}\n{"id":"b","title":"B"}\n', 200, true);
    expect(await exportAllChats(lines.client)).toEqual({ json: '[{"id":"a","title":"A"},{"id":"b","title":"B"}]', count: 2 });
    expect(lines.calls[0]).toMatchObject({ method: 'GET', url: 'https://x.test/api/v1/chats/all', accept: 'application/x-ndjson' });
    const archived = recordingClient([{ id: 'c' }]);
    expect(await exportArchivedChats(archived.client)).toEqual({ json: '[{"id":"c"}]', count: 1 });
    expect(archived.calls[0]?.url).toBe('https://x.test/api/v1/chats/all/archived');
    expect(exportFileNameAt('all', 1730000000000)).toBe('chat-export-1730000000000.json');
    expect(exportFileNameAt('archived', 5)).toBe('archived-chat-export-5.json');
  });
});

describe('import', () => {
  it('reads Open WebUI exports: records, bare chats, and one downloaded chat', () => {
    const record = { id: 'old', title: 'A', chat: { title: 'A', history: { messages: {}, currentId: null } }, meta: { tags: ['x'] }, folder_id: 'f1', pinned: true, variables: { city: 'KL' }, created_at: 10.7, updated_at: 20 };
    const bare = { title: 'Legacy', messages: [{ id: 'm', role: 'user', content: 'hi' }] };
    const plan = readImportFile(JSON.stringify([record, bare, 42, { nothing: true }]));
    expect(plan.from).toBe('open-webui');
    expect(plan.skipped).toBe(2);
    expect(plan.chats[0]).toEqual({ chat: record.chat, meta: { tags: ['x'] }, pinned: false, folder_id: 'f1', variables: { city: 'KL' }, created_at: 10, updated_at: 20 });
    expect(plan.chats[1]).toEqual({ chat: bare, meta: {}, pinned: false, folder_id: null, created_at: null, updated_at: null });
    expect(readImportFile(JSON.stringify(record)).chats).toHaveLength(1);
  });

  it('turns ChatGPT conversations into chats, one thread each', () => {
    const conversation = {
      title: 'Hello',
      create_time: 1_700_000_000,
      update_time: 1_700_000_100,
      current_node: 'a',
      mapping: {
        u: { id: 'u', parent: null, children: ['a'], message: { author: { role: 'user' }, content: { parts: ['Hi'] }, create_time: 1_700_000_010 } },
        a: { id: 'a', parent: 'u', children: [], message: { author: { role: 'assistant' }, content: { parts: ['Hello!'] }, metadata: { model_slug: 'gpt-4o' } } },
      },
    };
    const plan = readImportFile(JSON.stringify([conversation, { title: 'not one' }]));
    expect(plan).toMatchObject({ from: 'chatgpt', skipped: 1 });
    const chat = plan.chats[0];
    expect(chat).toMatchObject({ meta: {}, pinned: false, folder_id: null, created_at: 1_700_000_000, updated_at: 1_700_000_100 });
    expect(chat?.chat).toMatchObject({ title: 'Hello', models: ['gpt-4o'], timestamp: 1_700_000_000_000 });
    const history = chat?.chat.history;
    const [user, reply] = Object.values(history?.messages ?? {});
    expect(user).toMatchObject({ parentId: null, childrenIds: [reply?.id], role: 'user', content: 'Hi', timestamp: 1_700_000_010, models: ['gpt-4o'] });
    expect(reply).toMatchObject({ parentId: user?.id, childrenIds: [], role: 'assistant', content: 'Hello!', model: 'gpt-4o', done: true, timestamp: 1_700_000_000 });
    expect(history?.currentId).toBe(reply?.id);
  });

  it('names the web’s fallback model when the export names none', () => {
    const chat = chatFromConversation({ id: null, title: '', created: 5, updated: 6, model: null, messages: [{ role: 'user', text: 'x', at: null, model: null }] });
    expect(chat.chat).toMatchObject({ title: 'New Chat', models: ['gpt-3.5-turbo'] });
  });

  it('says why a file can’t be imported', () => {
    expect(() => readImportFile('not json')).toThrow(ImportFileError);
    expect(() => readImportFile('[1, 2]')).toThrow('no chats');
    expect(() => readImportFile(JSON.stringify([{ mapping: {} }]))).toThrow('None of the conversations');
  });

  it('sends the chats in batches, reporting progress', async () => {
    const { client, calls } = recordingClient([{ id: 'new', title: 'C' }]);
    const chats = Array.from({ length: IMPORT_BATCH + 3 }, (_, index) => ({ chat: { title: `C${index}` }, meta: {}, pinned: false, folder_id: null, created_at: null, updated_at: null }));
    const seen: number[] = [];
    expect(await importChats(client, chats, (done) => seen.push(done))).toHaveLength(2);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['POST https://x.test/api/v1/chats/import', 'POST https://x.test/api/v1/chats/import']);
    expect((calls[1]?.body as { chats: unknown[] }).chats).toHaveLength(3);
    expect(seen).toEqual([IMPORT_BATCH, IMPORT_BATCH + 3]);
  });
});

describe('bulk changes, shared chats and files', () => {
  it('archives and deletes every chat over the web’s routes', async () => {
    const { client, calls } = recordingClient(true);
    await archiveAllChats(client);
    await deleteAllChats(client);
    await unshareAllChats(client);
    expect(calls.map((call) => `${call.method} ${call.url.replace('https://x.test', '')}`)).toEqual(['POST /api/v1/chats/archive/all', 'DELETE /api/v1/chats/', 'DELETE /api/v1/chats/share/all']);
  });

  it('lists shared chats with search and order, by chat id', async () => {
    const { client, calls } = recordingClient([{ id: 'c1', chat_id: 'c1', title: 'Trip', share_id: 's1', updated_at: 9, created_at: 1 }, { title: 'no id' }]);
    expect(await listSharedChats(client, 2, ' trip ', { by: 'title', direction: 'asc' })).toEqual([{ chatId: 'c1', title: 'Trip', shareId: 's1', updated_at: 9, created_at: 1 }]);
    expect(calls[0]?.url).toBe('https://x.test/api/v1/chats/shared?page=2&query=trip&order_by=title&direction=asc');
    await listSharedChats(client);
    expect(calls[1]?.url).toBe('https://x.test/api/v1/chats/shared?page=1');
  });

  it('searches files by name (404 is none), counts them and names their sizes', async () => {
    const { client, calls } = recordingClient([{ id: 'f1', user_id: 'u', filename: 'notes.pdf', meta: { size: 2048, content_type: 'application/pdf' }, created_at: 3 }, { filename: 'no id' }]);
    expect(await searchFiles(client, ' note ', 50)).toEqual([{ id: 'f1', filename: 'notes.pdf', size: 2048, contentType: 'application/pdf', created_at: 3, userId: 'u' }]);
    expect(calls[0]?.url).toBe('https://x.test/api/v1/files/search?filename=*note*&skip=50&limit=50&content=false');
    await searchFiles(client, '');
    expect(calls[1]?.url).toContain('filename=*&');
    expect(await searchFiles(recordingClient({ detail: 'No files found matching the pattern.' }, 404).client, 'zzz')).toEqual([]);
    expect(await countFiles(recordingClient(7).client)).toBe(7);
    expect(fileContentUrl('https://x.test/', 'f/1')).toBe('https://x.test/api/v1/files/f%2F1/content');
    expect([fileSizeLabel(820), fileSizeLabel(14 * 1024), fileSizeLabel(3.2 * 1024 * 1024), fileSizeLabel(null)]).toEqual(['820 B', '14 KB', '3.2 MB', '']);
  });
});
