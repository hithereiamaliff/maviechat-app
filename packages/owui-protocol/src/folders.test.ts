import { describe, expect, it } from 'vitest';
import { createFolder, deleteFolder, folderChatsForExport, folderExportName, folderTree, getFolder, listFolderChatsForAll, listSharedFolders, markFolderRead, updateFolder, withSharedFolders, type FolderItem } from './folders';
import { OwuiClient, type FetchLike } from './http';

function recordingClient(answer: unknown) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(answer), { status: 200 });
  };
  return { client: new OwuiClient({ baseUrl: 'https://chat.test', token: 't', fetch }), calls };
}

const folder = (id: string, name: string, parent_id: string | null = null): FolderItem => ({ id, name, parent_id, created_at: 1, updated_at: 1 });

describe('folders', () => {
  it('nests folders by parent and sorts each level by name', () => {
    const tree = folderTree([folder('b', 'beta'), folder('a', 'Alpha'), folder('c', 'child', 'a'), folder('o', 'orphan', 'gone')]);
    expect(tree.map((node) => node.name)).toEqual(['Alpha', 'beta', 'orphan']);
    expect(tree[0]?.children.map((node) => node.name)).toEqual(['child']);
  });

  it('creates a folder at the top or inside another, with settings only when given', async () => {
    const { client, calls } = recordingClient({ id: 'f1', name: 'Work' });
    await createFolder(client, { name: 'Work' });
    await createFolder(client, { name: 'Notes', parentId: 'f1', data: { system_prompt: 'Be brief.' }, meta: { background_image_url: null } });
    expect(calls).toEqual([
      { method: 'POST', url: 'https://chat.test/api/v1/folders/', body: { name: 'Work', parent_id: null } },
      { method: 'POST', url: 'https://chat.test/api/v1/folders/', body: { name: 'Notes', parent_id: 'f1', data: { system_prompt: 'Be brief.' }, meta: { background_image_url: null } } },
    ]);
  });

  it('reads, changes, marks read and deletes through the folder’s own address', async () => {
    const { client, calls } = recordingClient({});
    await getFolder(client, 'f/1');
    await updateFolder(client, 'f/1', { name: 'Renamed', data: { model_ids: ['m1'] } });
    await markFolderRead(client, 'f/1');
    await deleteFolder(client, 'f/1', { deleteContents: false });
    await deleteFolder(client, 'f/1', { deleteContents: true });
    await folderChatsForExport(client, 'f/1');
    expect(calls).toEqual([
      { method: 'GET', url: 'https://chat.test/api/v1/folders/f%2F1', body: undefined },
      { method: 'POST', url: 'https://chat.test/api/v1/folders/f%2F1/update', body: { name: 'Renamed', data: { model_ids: ['m1'] } } },
      { method: 'POST', url: 'https://chat.test/api/v1/folders/f%2F1/read', body: {} },
      { method: 'DELETE', url: 'https://chat.test/api/v1/folders/f%2F1?delete_contents=false', body: undefined },
      { method: 'DELETE', url: 'https://chat.test/api/v1/folders/f%2F1?delete_contents=true', body: undefined },
      { method: 'GET', url: 'https://chat.test/api/v1/chats/folder/f%2F1', body: undefined },
    ]);
  });

  it('names the export file after the folder, without characters a file name can’t hold', () => {
    expect(folderExportName('Work')).toBe('folder-Work-export.json');
    expect(folderExportName('a/b: c?')).toBe('folder-a_b_ c_-export.json');
    expect(folderExportName('  ')).toBe('folder-folder-export.json');
  });

  it('reads folders shared with you: whose, and read or write', async () => {
    const { client, calls } = recordingClient([
      { id: 's1', name: 'Team', user_id: 'u2', owner_name: 'Amy', permission: 'write', parent_id: null, created_at: 1, updated_at: 2 },
      { id: 's2', name: 'Inside', user_id: 'u2', owner_name: 'Amy', permission: 'read', parent_id: 's1', created_at: 1, updated_at: 2 },
      { nope: true },
    ]);
    const shared = await listSharedFolders(client);
    expect(calls[0]?.url).toBe('https://chat.test/api/v1/folders/shared');
    expect(shared.map((folder) => [folder.id, folder.owner_name, folder.permission])).toEqual([
      ['s1', 'Amy', 'write'],
      ['s2', 'Amy', 'read'],
    ]);
    const own: FolderItem[] = [{ id: 'f1', name: 'Mine', created_at: 1, updated_at: 1 }, { id: 's1', name: 'Team', created_at: 1, updated_at: 1 }];
    const both = withSharedFolders(own, shared);
    expect(both.map((folder) => folder.id)).toEqual(['f1', 's1', 's2']);
    expect(folderTree(both).find((node) => node.id === 's1')?.children.map((node) => node.id)).toEqual(['s2']);
  });

  it('reads a page of a folder’s chats, everyone’s, with what you may do', async () => {
    const { client, calls } = recordingClient({ chats: [{ id: 'c1', title: 'Hi', user_id: 'u2', owner_name: 'Amy', readonly: true, updated_at: 5, created_at: 1 }, {}], folder_permission: 'read', total: 11, has_more: true });
    const page = await listFolderChatsForAll(client, 'f 1', 2);
    expect(calls[0]?.url).toBe('https://chat.test/api/v1/folders/f%201/shared/chats?page=2');
    expect(page.permission).toBe('read');
    expect(page.hasMore).toBe(true);
    expect(page.chats.map((chat) => [chat.id, chat.owner_name, chat.readonly])).toEqual([['c1', 'Amy', true]]);
  });
});
