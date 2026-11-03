import { describe, expect, it } from 'vitest';
import {
  attachmentUrl,
  deleteFile,
  fileItemFromUpload,
  inlineImageItem,
  isContextFile,
  isImageItem,
  readableAsText,
  requestFiles,
  attachmentName,
  textFileItem,
  uploadFile,
  waitForProcessing,
  type FileItem,
} from './files';
import type { HistoryMessage } from './history';
import { OwuiClient, type FetchLike } from './http';

const doc: FileItem = { type: 'file', id: 'f1', url: 'f1', name: 'report.pdf', content_type: 'application/pdf' };
const photo: FileItem = { type: 'file', id: 'p1', url: 'p1', name: 'photo.jpg', content_type: 'image/jpeg' };

describe('uploads', () => {
  it('posts multipart with the process flag and no JSON content type', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'f9', meta: { content_type: 'text/plain' } }), { status: 200 });
    };
    const form = new FormData();
    form.append('file', new Blob(['hello'], { type: 'text/plain' }), 'note.txt');
    const result = await uploadFile(new OwuiClient({ baseUrl: 'https://x.test', token: 't', fetch }), form, { process: false });
    expect(result.id).toBe('f9');
    expect(calls[0]?.url).toBe('https://x.test/api/v1/files/?process=false');
    expect(calls[0]?.init?.body).toBe(form);
    expect((calls[0]?.init?.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('shapes the attachment like the web client', () => {
    expect(fileItemFromUpload({ id: 'f1', meta: { content_type: 'image/png', collection_name: 'c' } }, { name: 'a.png', size: 9, itemId: 'tmp' })).toEqual({
      type: 'file',
      file: { id: 'f1', meta: { content_type: 'image/png', collection_name: 'c' } },
      id: 'f1',
      url: 'f1',
      name: 'a.png',
      collection_name: 'c',
      status: 'uploaded',
      size: 9,
      error: '',
      itemId: 'tmp',
      content_type: 'image/png',
    });
  });

  it('tells photos from documents and finds previews', () => {
    expect(isImageItem(photo)).toBe(true);
    expect(isImageItem({ type: 'image', content_type: undefined })).toBe(true);
    expect(isImageItem(doc)).toBe(false);
    expect(attachmentUrl(photo, 'https://x.test')).toBe('https://x.test/api/v1/files/p1/content');
    expect(attachmentUrl({ id: null, url: 'data:image/png;base64,AA' }, 'https://x.test')).toBe('data:image/png;base64,AA');
    // Generated images and older chats point at a server path.
    expect(attachmentUrl({ id: null, url: '/api/v1/files/g1/content' }, 'https://x.test')).toBe('https://x.test/api/v1/files/g1/content');
  });
});

describe('requestFiles', () => {
  const message = (id: string, files: unknown[]): HistoryMessage => ({ id, parentId: null, childrenIds: [], role: 'user', content: id, files });

  it('carries documents from the whole conversation once, never photos', () => {
    const branch = [message('u1', [doc, photo]), message('u2', [doc])];
    const files = requestFiles(branch, message('u3', [{ ...doc, id: 'f2', url: 'f2' }, photo]));
    expect(files.map((file) => (file as FileItem).id)).toEqual(['f1', 'f2']);
  });

  it("keeps to the chat's files when it has the list, so one removed in Controls stays out", () => {
    const second = { ...doc, id: 'f2', url: 'f2' };
    const third = { ...doc, id: 'f3', url: 'f3' };
    const branch = [message('u1', [doc]), message('u2', [second])];
    // f2 was removed from the chat's files; f9 is no longer in the shown conversation.
    const files = requestFiles(branch, message('u3', [third]), [doc, { ...doc, id: 'f9' }]);
    expect(files.map((file) => (file as FileItem).id)).toEqual(['f1', 'f3']);
    expect(requestFiles(branch, message('u3', []), [])).toEqual([]);
  });

  it('names a file item for people', () => {
    expect(attachmentName(doc)).toBe((doc as FileItem).name);
    expect(attachmentName({ type: 'file', name: '', file: { filename: 'x.pdf', meta: { name: 'Report.pdf' } } })).toBe('Report.pdf');
    expect(attachmentName({ type: 'collection', id: 'k1' })).toBe('Knowledge');
    expect(attachmentName(null)).toBe('File');
  });

  it('accepts knowledge-style items and rejects junk', () => {
    expect(isContextFile({ type: 'collection', id: 'k1' })).toBe(true);
    expect(isContextFile({ type: 'image', url: 'data:' })).toBe(false);
    expect(isContextFile(null)).toBe(false);
  });
});

describe('document processing', () => {
  it('polls the status until the document is ready, then stops', async () => {
    const answers = ['pending', 'pending', 'completed'];
    const urls: string[] = [];
    const fetch: FetchLike = async (url) => {
      urls.push(url);
      return new Response(JSON.stringify({ status: answers.shift() }), { status: 200 });
    };
    const client = new OwuiClient({ baseUrl: 'https://x.test', token: 't', fetch });
    const sleeps: number[] = [];
    const status = await waitForProcessing(client, 'f/1', { intervalMs: 5, sleep: async (ms) => void sleeps.push(ms) });
    expect(status).toBe('completed');
    expect(urls).toEqual(Array(3).fill('https://x.test/api/v1/files/f%2F1/process/status'));
    expect(sleeps).toEqual([5, 5]);
  });

  it('reports failure and gives up after the timeout', async () => {
    const reply = (status: string): FetchLike => async () => new Response(JSON.stringify({ status }), { status: 200 });
    const failed = new OwuiClient({ baseUrl: 'https://x.test', token: 't', fetch: reply('failed') });
    expect(await waitForProcessing(failed, 'f1', { sleep: async () => {} })).toBe('failed');
    const stuck = new OwuiClient({ baseUrl: 'https://x.test', token: 't', fetch: reply('pending') });
    expect(await waitForProcessing(stuck, 'f1', { timeoutMs: -1, sleep: async () => {} })).toBe('pending');
  });

  it('deletes uploads by id', async () => {
    const calls: string[] = [];
    const fetch: FetchLike = async (url, init) => {
      calls.push(`${init?.method} ${url}`);
      return new Response('{}', { status: 200 });
    };
    await deleteFile(new OwuiClient({ baseUrl: 'https://x.test', token: 't', fetch }), 'f1');
    expect(calls).toEqual(['DELETE https://x.test/api/v1/files/f1']);
  });
});

describe('temporary chat attachments', () => {
  it('reads only text-like documents', () => {
    expect(readableAsText('notes.md', 'application/octet-stream')).toBe(true);
    expect(readableAsText('data', 'application/json')).toBe(true);
    expect(readableAsText('page.txt', null)).toBe(true);
    expect(readableAsText('report.pdf', 'application/pdf')).toBe(false);
    expect(readableAsText('md', undefined)).toBe(false);
  });

  it('shapes text and inline photo items like the web client', () => {
    expect(textFileItem({ name: 'a.txt', content: 'hi', itemId: 'i', id: 'x' })).toEqual({
      type: 'text',
      file: '',
      id: 'x',
      url: '',
      name: 'a.txt',
      collection_name: '',
      status: 'uploaded',
      size: 2,
      error: '',
      itemId: 'i',
      content: 'hi',
    });
    expect(isContextFile(textFileItem({ name: 'a.txt', content: 'hi', itemId: 'i', id: 'x' }))).toBe(true);
    expect(inlineImageItem('data:image/jpeg;base64,AA')).toEqual({ type: 'image', url: 'data:image/jpeg;base64,AA' });
  });
});
