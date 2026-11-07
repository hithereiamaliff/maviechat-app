import { describe, expect, it } from 'vitest';
import { createFolder, deleteFolder, folderChatsForExport, folderExportName, folderTree, getFolder, markFolderRead, updateFolder, type FolderItem } from './folders';
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
});
