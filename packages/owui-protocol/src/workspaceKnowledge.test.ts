import { describe, expect, it } from 'vitest';
import { OwuiClient, type FetchLike } from './http';
import {
  fetchUrl,
  knowledgeUploadMetadata,
  listKnowledgeFiles,
  listWorkspaceKnowledge,
  removeKnowledgeFile,
  textFileName,
  updateKnowledgeFolder,
  updateWorkspaceKnowledge,
  urlFileName,
  urlsFromText,
} from './workspaceKnowledge';

function recordingClient(...answers: unknown[]) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(answers.shift() ?? {}), { status: 200 });
  };
  return { client: new OwuiClient({ baseUrl: 'https://chat.test', token: 't', fetch }), calls };
}

describe('workspace knowledge', () => {
  it('lists collections, telling connected ones apart', async () => {
    const { client, calls } = recordingClient({ items: [{ id: 'k1', name: 'Docs', file_count: 3, write_access: true, user: { name: 'Amy' }, updated_at: 1_730_000_000 }, { id: 'k2', name: 'Wiki', meta: { source: 'external', external: { provider: 'confluence' } } }], total: 2 });
    const { items, total } = await listWorkspaceKnowledge(client, { query: 'do', view: 'created', source: 'local' });
    expect(calls[0]?.url).toBe('https://chat.test/api/v1/knowledge/search?order_by=updated_at&direction=desc&page=1&query=do&view_option=created&source=local');
    expect(total).toBe(2);
    expect(items[0]).toMatchObject({ id: 'k1', fileCount: 3, writeAccess: true, ownerName: 'Amy', external: false, updatedAt: 1_730_000_000_000 });
    expect(items[1]).toMatchObject({ external: true, provider: 'confluence', fileCount: null });
  });

  it('changes name and description without sending sharing', async () => {
    const { client, calls } = recordingClient({ id: 'k1', name: 'Docs 2' });
    await updateWorkspaceKnowledge(client, 'k1', { name: ' Docs 2 ', description: ' all of them ' });
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://chat.test/api/v1/knowledge/k1/update', body: { name: 'Docs 2', description: 'all of them' } });
    expect(calls[0]?.body).not.toHaveProperty('access_grants');
  });

  it('reads a folder: the top level as an empty folder id, files, folders and the way down', async () => {
    const { client, calls } = recordingClient({
      items: [{ id: 'f1', filename: 'a.pdf', meta: { name: 'a.pdf', size: 2048, content_type: 'application/pdf' }, user: { name: 'Amy' }, user_id: 'u1', created_at: 1_730_000_000 }],
      directories: [{ id: 'd2', name: 'Sub', parent_id: 'd1', updated_at: 1 }],
      breadcrumbs: [{ id: 'd1', name: 'Top' }],
      total: 1,
    });
    const page = await listKnowledgeFiles(client, 'k1', { query: 'a', inText: true });
    expect(calls[0]?.url).toBe('https://chat.test/api/v1/knowledge/k1/files?page=1&directory_id=&order_by=updated_at&direction=desc&query=a&include_content=true');
    expect(page.files[0]).toEqual({ id: 'f1', name: 'a.pdf', size: 2048, contentType: 'application/pdf', ownerName: 'Amy', ownerId: 'u1', createdAt: 1_730_000_000_000, updatedAt: 1_730_000_000_000 });
    expect(page.folders).toEqual([{ id: 'd2', name: 'Sub', parentId: 'd1', updatedAt: 1000 }]);
    expect(page.path.map((folder) => folder.name)).toEqual(['Top']);
  });

  it('renames a folder in place, or moves it to the top', async () => {
    const { client, calls } = recordingClient({ id: 'd1', name: 'New' }, { id: 'd1', name: 'New' });
    await updateKnowledgeFolder(client, 'k1', 'd1', { name: ' New ' });
    await updateKnowledgeFolder(client, 'k1', 'd1', { parentId: null });
    expect(calls[0]?.body).toEqual({ name: 'New' });
    expect(calls[1]?.body).toEqual({ parent_id: null });
  });

  it('says whether removing a file deletes it too', async () => {
    const { client, calls } = recordingClient({});
    await removeKnowledgeFile(client, 'k1', 'f1', { deleteFile: false });
    expect(calls[0]).toMatchObject({ url: 'https://chat.test/api/v1/knowledge/k1/file/remove?delete_file=false', body: { file_id: 'f1' } });
  });

  it('describes an upload into a collection', () => {
    expect(JSON.parse(knowledgeUploadMetadata('k1', null))).toEqual({ knowledge_id: 'k1' });
    expect(JSON.parse(knowledgeUploadMetadata('k1', 'd1', 'https://example.com'))).toEqual({ knowledge_id: 'k1', directory_id: 'd1', source_url: 'https://example.com' });
  });

  it('reads web addresses and names their pages', async () => {
    expect(urlsFromText('https://a.test/x\n\nftp://b.test  https://a.test/x\nnot a url http://c.test')).toEqual({ urls: ['https://a.test/x', 'http://c.test'], refused: ['ftp://b.test', 'not', 'a', 'url'] });
    expect(urlFileName('https://www.example.com/docs/getting-started?x=1')).toBe('www-example-com-docs-getting-started-x-1.txt');
    expect(urlFileName('https://example.com/' + 'a'.repeat(80))).toHaveLength(54);
    expect(textFileName(' Notes: week 1 ')).toBe('Notes week 1.txt');
    expect(textFileName('a.TXT')).toBe('a.TXT');
    const page = await fetchUrl(recordingClient({ status: true, type: 'web', name: 'Example', url: 'https://example.com', content: 'Hello' }).client, 'https://example.com');
    expect(page).toEqual({ kind: 'page', name: 'Example', url: 'https://example.com', content: 'Hello' });
    const file = await fetchUrl(recordingClient({ status: true, type: 'file', name: 'a.pdf', url: 'https://example.com/a.pdf', file: { id: 'f9' } }).client, 'https://example.com/a.pdf');
    expect(file).toEqual({ kind: 'file', name: 'a.pdf', url: 'https://example.com/a.pdf', fileId: 'f9' });
  });
});
