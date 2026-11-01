import { describe, expect, it } from 'vitest';
import {
  createChat,
  deleteChat,
  deleteMessage,
  getChat,
  listChats,
  listArchivedChats,
  listFolderChats,
  listPinnedChats,
  markChatUnread,
  moveChatToFolder,
  renameChat,
  saveMessage,
  searchChats,
  selectBranch,
  toggleArchived,
  togglePinned,
  unarchiveAllChats,
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

describe('message-level chat calls', () => {
  it('deletes one message, saves one edited message and creates chats', async () => {
    const { client, calls } = recordingClient();
    const message = { id: 'm1', parentId: null, childrenIds: [], role: 'user', content: 'Edited' };
    await deleteMessage(client, 'c1', 'm1');
    await saveMessage(client, 'c1', message, 'a9');
    await createChat(client, { title: 'Kept', history: { messages: {}, currentId: null } });
    expect(calls.map((c) => `${c.method} ${c.url.replace('https://x.test', '')}`)).toEqual([
      'DELETE /api/v1/chats/c1/messages/m1',
      'POST /api/v1/chats/c1',
      'POST /api/v1/chats/new',
    ]);
    expect(calls[1]?.body).toEqual({ chat: { history: { messages: { m1: message }, currentId: 'a9' } } });
  });
});

describe('archive and read state', () => {
  it('lists archived chats, unarchives all and marks unread', async () => {
    const { client, calls } = recordingClient();
    await listArchivedChats(client, 2, 'tax');
    await listArchivedChats(client);
    await unarchiveAllChats(client);
    await markChatUnread(client, 'c/1');
    expect(calls.map((c) => `${c.method} ${c.url.replace('https://x.test', '')}`)).toEqual([
      'GET /api/v1/chats/archived?page=2&query=tax',
      'GET /api/v1/chats/archived?page=1',
      'POST /api/v1/chats/unarchive/all',
      'POST /api/v1/chats/c%2F1/unread',
    ]);
  });
});
