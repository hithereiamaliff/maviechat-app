import { describe, expect, it } from 'vitest';
import {
  deleteChat,
  getChat,
  listChats,
  listFolderChats,
  listPinnedChats,
  moveChatToFolder,
  renameChat,
  searchChats,
  selectBranch,
  toggleArchived,
  togglePinned,
} from './chats';
import { listFolders, setFolderExpanded } from './folders';
import { OwuiClient, type FetchLike } from './http';

function recordingClient() {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response('[]', { status: 200 });
  };
  return { client: new OwuiClient({ baseUrl: 'https://x.test', token: 't', fetch }), calls };
}

describe('chat and folder endpoints (0.11.3)', () => {
  it('lists and searches like the web sidebar', async () => {
    const { client, calls } = recordingClient();
    await listChats(client, 2);
    await listPinnedChats(client);
    await searchChats(client, 'tax return', 1);
    await listFolderChats(client, 'f/1', 3);
    await listFolders(client);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET https://x.test/api/v1/chats/?page=2',
      'GET https://x.test/api/v1/chats/pinned',
      'GET https://x.test/api/v1/chats/search?text=tax+return&page=1',
      'GET https://x.test/api/v1/chats/folder/f%2F1/list?page=3',
      'GET https://x.test/api/v1/folders/',
    ]);
  });

  it('sends only the title when renaming, and no messages when switching branches', async () => {
    const { client, calls } = recordingClient();
    await renameChat(client, 'c1', 'New name');
    await selectBranch(client, 'c1', 'm9');
    expect(calls[0]).toEqual({ method: 'POST', url: 'https://x.test/api/v1/chats/c1', body: { chat: { title: 'New name' } } });
    expect(calls[1]?.body).toEqual({ chat: { history: { messages: {}, currentId: 'm9' } } });
  });

  it('uses the toggle, folder and delete routes', async () => {
    const { client, calls } = recordingClient();
    await getChat(client, 'c1');
    await togglePinned(client, 'c1');
    await toggleArchived(client, 'c1');
    await moveChatToFolder(client, 'c1', null);
    await deleteChat(client, 'c1');
    await setFolderExpanded(client, 'f1', true);
    expect(calls.map((c) => `${c.method} ${c.url.replace('https://x.test', '')}`)).toEqual([
      'GET /api/v1/chats/c1',
      'POST /api/v1/chats/c1/pin',
      'POST /api/v1/chats/c1/archive',
      'POST /api/v1/chats/c1/folder',
      'DELETE /api/v1/chats/c1',
      'POST /api/v1/folders/f1/update/expanded',
    ]);
    expect(calls[3]?.body).toEqual({ folder_id: null });
    expect(calls[5]?.body).toEqual({ is_expanded: true });
  });
});
