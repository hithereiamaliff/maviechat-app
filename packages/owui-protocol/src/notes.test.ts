import { describe, expect, it } from 'vitest';
import type { Capabilities } from './capabilities';
import { OwuiClient, type FetchLike } from './http';
import {
  pinnedNotesOrderOf,
  sortPinnedNotes,
  attachmentLink,
  attachmentsIn,
  changeNotePages,
  createNote,
  deleteNote,
  getNote,
  getNoteChat,
  hasHeldPictures,
  listNoteChats,
  listNoteChoices,
  listNotes,
  listPinnedNotes,
  newNoteChat,
  newNoteTitle,
  newPageTitle,
  noteChangeOf,
  noteLink,
  noteTitle,
  pageLink,
  pageParents,
  pageStep,
  pictureLink,
  saveKeepsSharing,
  saveNote,
  saveNoteNow,
  suggestNoteTitle,
  toggleNotePinned,
  withNoteFile,
  withNoteSelection,
  withoutAttachment,
  withoutNoteFile,
} from './notes';

function recordingClient(...answers: unknown[]) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(answers.shift() ?? {}), { status: 200 });
  };
  return { client: new OwuiClient({ baseUrl: 'https://chat.test', token: 't', fetch }), calls };
}

const NS = 1_000_000;
const NOTE = {
  id: 'n1',
  user_id: 'u1',
  title: 'Shopping',
  data: { content: { json: { type: 'doc' }, html: '<p>milk</p>', md: 'milk' }, files: [{ id: 'f1' }] },
  meta: null,
  is_pinned: true,
  access_grants: [{ principal_type: 'user', principal_id: '*', permission: 'read' }],
  created_at: 1_700_000_000_000 * NS,
  updated_at: 1_700_000_100_000 * NS,
  write_access: true,
};

const caps = (granted: Record<string, boolean>, isAdmin = false, version = '0.11.3') => ({ version, isAdmin, can: (key: string, fallback = false) => granted[key] ?? fallback }) as unknown as Capabilities;

describe('notes', () => {
  it('searches as the web’s Notes page does: words, whose, read-only, order, 60 a page', async () => {
    const { client, calls } = recordingClient({ items: [{ ...NOTE, data: { content: { md: 'milk' } }, user: { id: 'u1', name: 'Amy' } }], total: 1 });
    const page = await listNotes(client, { query: ' milk ', view: 'shared', readOnly: true, orderBy: 'name', direction: 'asc', page: 2 });
    const url = new URL(calls[0]?.url ?? '');
    expect(url.pathname).toBe('/api/v1/notes/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({ query: 'milk', view_option: 'shared', permission: 'read_only', order_by: 'name', direction: 'asc', page: '2' });
    expect(page.items[0]).toEqual({ id: 'n1', title: 'Shopping', preview: 'milk', pinned: true, ownerId: 'u1', ownerName: 'Amy', createdAt: 1_700_000_000_000, updatedAt: 1_700_000_100_000 });
    const yours = recordingClient({ items: [], total: 0 });
    await listNotes(yours.client, { view: 'created', readOnly: true });
    expect(new URL(yours.calls[0]?.url ?? '').searchParams.get('permission')).toBeNull();
  });

  it('reads a whole note, the pinned list and the attach list', async () => {
    const { client } = recordingClient(NOTE, [NOTE], [{ ...NOTE, title: '' }]);
    const note = await getNote(client, 'n1');
    expect(note).toMatchObject({ md: 'milk', html: '<p>milk</p>', writeAccess: true, pinned: true });
    expect(note.accessGrants).toHaveLength(1);
    expect((await listPinnedNotes(client))[0]?.id).toBe('n1');
    expect((await listNoteChoices(client, ''))[0]?.title).toBe('Untitled');
  });

  it('makes a note private, with Markdown and its HTML and no editor JSON', async () => {
    const { client, calls } = recordingClient({ ...NOTE, access_grants: [] });
    const note = await createNote(client, { title: '2026-11-07', md: 'a', html: '<p>a</p>' });
    expect(calls[0]?.body).toEqual({ title: '2026-11-07', data: { content: { json: null, html: '<p>a</p>', md: 'a' } }, meta: null, access_grants: [] });
    expect(note.writeAccess).toBe(true);
  });

  it('saves with the note’s sharing every time, and the text only when it changed', async () => {
    const { client, calls } = recordingClient(NOTE, NOTE);
    const note = await getNote(recordingClient(NOTE).client, 'n1');
    await saveNote(client, note, { title: 'Groceries' });
    expect(calls[0]?.body).toEqual({ title: 'Groceries', access_grants: note.accessGrants });
    await saveNote(client, note, { md: 'eggs', html: '<p>eggs</p>' });
    expect(calls[1]?.url).toBe('https://chat.test/api/v1/notes/n1/update');
    expect(calls[1]?.body).toEqual({ title: 'Shopping', access_grants: note.accessGrants, data: { content: { json: null, html: '<p>eggs</p>', md: 'eggs' } } });
  });

  it('saves with the sharing read just before, and names an empty title "Untitled"', async () => {
    const shared = { ...NOTE, access_grants: [{ principal_type: 'group', principal_id: 'g2', permission: 'read' }] };
    const { client, calls } = recordingClient(shared, shared);
    await saveNoteNow(client, 'n1', { title: ' ', md: 'x', html: '<p>x</p>' });
    expect(calls.map((call) => call.method)).toEqual(['GET', 'POST']);
    expect(calls[1]?.body).toMatchObject({ title: 'Untitled', access_grants: [{ principal_type: 'group', principal_id: 'g2', permission: 'read' }] });
  });

  it('pins and deletes', async () => {
    const { client, calls } = recordingClient({ ...NOTE, is_pinned: false }, true);
    expect((await toggleNotePinned(client, 'n1')).pinned).toBe(false);
    await deleteNote(client, 'n1');
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['POST https://chat.test/api/v1/notes/n1/pin', 'DELETE https://chat.test/api/v1/notes/n1/delete']);
  });

  it('tells whether a save keeps the sharing this account may not grant', () => {
    const everyone = [{ principal_type: 'user' as const, principal_id: '*', permission: 'read' as const }];
    const group = [{ principal_type: 'group' as const, principal_id: 'g', permission: 'write' as const }];
    expect(saveKeepsSharing([], caps({}))).toBe(true);
    expect(saveKeepsSharing(everyone, caps({}))).toBe(false);
    expect(saveKeepsSharing(everyone, caps({ 'sharing.public_notes': true }))).toBe(true);
    expect(saveKeepsSharing(group, caps({}))).toBe(true);
    expect(saveKeepsSharing(group, caps({ 'access_grants.allow_groups': false }))).toBe(false);
    expect(saveKeepsSharing(everyone, caps({}, true))).toBe(true);
    // 0.12 saves leave sharing alone.
    expect(saveKeepsSharing(everyone, caps({}, false, '0.12.5'))).toBe(true);
  });

  it('counts 0.12’s pages', async () => {
    const { client } = recordingClient({ ...NOTE, data: { content: { md: '## One\n\na\n\n## Two\n\nb' }, pages: [{ id: 'main' }, { id: 'p2' }] } });
    const note = await getNote(client, 'n1');
    expect(note.pageCount).toBe(2);
    expect((await getNote(recordingClient(NOTE).client, 'n1')).pageCount).toBe(0);
  });

  it('reads a change from elsewhere: only what was sent', () => {
    expect(noteChangeOf({ id: 'n1', title: 'T', updated_at: 5 * NS })).toEqual({ id: 'n1', title: 'T', updatedAt: 5 });
    expect(noteChangeOf({ id: 'n1', title: 'T', data: { content: { md: 'x', html: '<p>x</p>' } }, updated_at: 0 })).toMatchObject({ md: 'x', html: '<p>x</p>' });
    expect(noteChangeOf({ title: 'no id' })).toBeNull();
  });

  it('names notes as the web does', () => {
    expect(newNoteTitle(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(noteTitle({ title: '  ' })).toBe('Untitled');
    expect(noteLink('https://chat.test', 'a b')).toBe('https://chat.test/notes/a%20b');
  });

  it('reads 0.11’s file list: uploaded files only, named and sized from the entry or its file', async () => {
    const files = [
      { type: 'file', id: 'f1', name: 'report.pdf', size: 2048, file: { meta: { content_type: 'application/pdf' } } },
      { type: 'file', id: 'f2', file: { filename: 'memo.m4a', meta: { name: 'memo.m4a', size: 99, content_type: 'audio/mp4' } } },
      { type: 'image', id: 'i1', url: 'data:image/png;base64,AAAA' },
    ];
    const note = await getNote(recordingClient({ ...NOTE, data: { content: { md: 'x' }, files } }).client, 'n1');
    expect(note.files).toEqual([
      { id: 'f1', name: 'report.pdf', size: 2048, contentType: 'application/pdf' },
      { id: 'f2', name: 'memo.m4a', size: 99, contentType: 'audio/mp4' },
    ]);
    expect(withNoteFile(files, { type: 'file', id: 'f3', url: 'f3', name: 'new.txt' }).map((item) => (item as { id: string }).id)).toEqual(['f1', 'f2', 'i1', 'f3']);
    expect(withoutNoteFile(files, 'f1')).toHaveLength(2);
  });

  it('saves a file list (none as null), and a page’s text with its page', async () => {
    const { client, calls } = recordingClient(NOTE, NOTE, NOTE);
    const note = await getNote(recordingClient(NOTE).client, 'n1');
    await saveNote(client, note, { files: [] });
    expect(calls[0]?.body).toEqual({ title: 'Shopping', access_grants: note.accessGrants, data: { files: null } });
    await saveNote(client, note, { md: 'b', html: '<p>b</p>', pageId: 'p2' });
    expect(calls[1]?.body).toEqual({ title: 'Shopping', access_grants: note.accessGrants, data: { content: { json: null, html: '<p>b</p>', md: 'b' } }, page_id: 'p2' });
    const fresh = recordingClient(NOTE, NOTE);
    await saveNoteNow(fresh.client, 'n1', { files: (current) => withNoteFile(current, { type: 'file', id: 'f9', url: 'f9', name: 'a.txt' }) });
    expect((fresh.calls[1]?.body as { data: { files: { id: string }[] } }).data.files.map((item) => item.id)).toEqual(['f1', 'f9']);
  });

  it('finds 0.12’s attachments in the text, adds and takes them away', () => {
    const md = `Intro\n\n${attachmentLink({ id: 'f-1', name: 'report [final].pdf' })}\n\n${pictureLink({ id: 'p-1', name: 'photo.jpg' })}\n\nsee [memo](/api/v1/files/f-2/content) too`;
    expect(md).toContain('[report  final .pdf](/api/v1/files/f-1/content)');
    expect(attachmentsIn(md)).toEqual([
      { id: 'f-1', name: 'report  final .pdf', size: 0, contentType: '' },
      { id: 'f-2', name: 'memo', size: 0, contentType: '' },
    ]);
    expect(withoutAttachment(md, 'f-1')).toBe('Intro\n\n![photo.jpg](/api/v1/files/p-1/content)\n\nsee [memo](/api/v1/files/f-2/content) too');
    expect(withoutAttachment(md, 'f-2')).toContain('see  too');
    expect(withoutAttachment(md, 'p-1')).toBe(md);
  });

  it('spots pictures held inside the text, which only the web’s editor keeps', () => {
    expect(hasHeldPictures('![](data://abc)', '')).toBe(true);
    expect(hasHeldPictures('', '<p><img src="data:image/png;base64,AAA"></p>')).toBe(true);
    expect(hasHeldPictures('![photo](/api/v1/files/p/content)', '<img src="/api/v1/files/p/content">')).toBe(false);
  });

  it('reads 0.12’s pages: nesting, the first page’s title, the pages’ revision', async () => {
    const pages = [
      { id: 'main', title: 'Trip', content: { md: 'plan', html: '' } },
      { id: 'a', parent_id: null, title: 'Days', content: { md: 'one', html: '<p>one</p>' }, revision: 2 },
      { id: 'a1', parent_id: 'a', title: 'Monday', content: { md: 'mon' } },
      { id: 'b', title: 'Costs', content: { md: '' } },
    ];
    const note = await getNote(recordingClient({ ...NOTE, data: { content: { md: 'all' }, pages, pages_revision: 7 } }).client, 'n1');
    expect(note.pagesRevision).toBe(7);
    expect(note.pages.map((page) => [page.id, page.depth, page.parentId, page.inheritsTitle])).toEqual([
      ['main', 0, null, true],
      ['a', 0, null, false],
      ['a1', 1, 'a', false],
      ['b', 0, null, false],
    ]);
    expect(newPageTitle(note.pages)).toBe('Page 5');
    expect(newPageTitle([{ title: 'Page 2' }])).toBe('Page 3');
    expect(pageStep(note.pages, 'b', -1)).toEqual({ action: 'move', pageId: 'b', parentId: null, beforeId: 'a' });
    expect(pageStep(note.pages, 'a', 1)).toEqual({ action: 'move', pageId: 'a', parentId: null, beforeId: null });
    expect(pageStep(note.pages, 'a', -1)).toBeNull();
    expect(pageStep(note.pages, 'main', 1)).toBeNull();
    expect(pageParents(note.pages, 'a').map((page) => page.id)).toEqual(['main', 'b']);
    expect(pageLink('https://chat.test', 'n1', 'a1')).toBe('https://chat.test/notes/n1?page=a1');
  });

  it('changes pages with the revision it saw, and a new page’s own id', async () => {
    const answer = { ...NOTE, data: { pages: [{ id: 'main', title: 'T', content: { md: '' } }], pages_revision: 4 } };
    const { client, calls } = recordingClient(answer, answer);
    const made = await changeNotePages(client, { id: 'n1', pagesRevision: 3, writeAccess: true }, { action: 'create', title: 'Page 2', parentId: null });
    expect(calls[0]?.url).toBe('https://chat.test/api/v1/notes/n1/pages/update');
    expect(calls[0]?.body).toEqual({ action: 'create', revision: 3, title: 'Page 2', parent_id: null, new_id: made.pageId });
    expect(made.pageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(made.note.pagesRevision).toBe(4);
    await changeNotePages(client, { id: 'n1', pagesRevision: 4, writeAccess: true }, { action: 'move', pageId: 'p', parentId: 'q', beforeId: null });
    expect(calls[1]?.body).toEqual({ action: 'move', revision: 4, page_id: 'p', parent_id: 'q', before_id: null });
  });

  it('reads a 0.12 change for the page you’re on, and 0.11’s files when sent', () => {
    const raw = { id: 'n1', updated_at: 9 * NS, data: { content: { md: 'all' }, pages: [{ id: 'main', title: 'T', content: { md: 'first' } }, { id: 'p2', title: 'Two', content: { md: 'second', html: '<p>second</p>' } }], pages_revision: 2 } };
    expect(noteChangeOf(raw, 'p2')).toMatchObject({ md: 'second', html: '<p>second</p>', pagesRevision: 2 });
    expect(noteChangeOf(raw)?.md).toBe('first');
    expect(noteChangeOf(raw, 'gone')?.md).toBeUndefined();
    expect(noteChangeOf({ id: 'n1', data: { files: null } })?.files).toEqual([]);
    expect(noteChangeOf({ id: 'n1', data: { content: { md: 'x' } } })?.files).toBeUndefined();
  });

  it('opens the note’s chats, and words a message with your selection as the web does', async () => {
    const chat = { id: 'c1', title: 'Chat', chat: { params: { system: 'CONTEXT' } }, updated_at: 1, created_at: 1 };
    const { client, calls } = recordingClient(chat, [chat, { nope: true }], chat);
    expect((await getNoteChat(client, 'n 1')).id).toBe('c1');
    expect((await listNoteChats(client, 'n 1')).map((item) => item.id)).toEqual(['c1']);
    await newNoteChat(client, 'n 1');
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET https://chat.test/api/v1/notes/n%201/chat',
      'GET https://chat.test/api/v1/notes/n%201/chats',
      'POST https://chat.test/api/v1/notes/n%201/chat',
    ]);
    expect(withNoteSelection('Shorten it.', '  the middle bit ')).toBe('Shorten it.\n\nSelected note text for replace_note_content operations:\nthe middle bit');
    expect(withNoteSelection('Shorten it.', ' ')).toBe('Shorten it.');
  });

  it('asks a model for a title, once, and reads it from the answer', async () => {
    const { client, calls } = recordingClient({ choices: [{ message: { content: 'Sure! {"title": "Weekly Groceries"}' } }] }, { choices: [{ message: { content: 'no idea' } }] });
    expect(await suggestNoteTitle(client, 'm1', 'milk, eggs', 'n1')).toBe('Weekly Groceries');
    expect(calls[0]?.url).toBe('https://chat.test/api/chat/completions');
    expect(calls[0]?.body).toMatchObject({ model: 'm1', stream: false, chat_id: 'temporary:note-n1', messages: [{ role: 'user' }] });
    expect((calls[0]?.body as { messages: { content: string }[] }).messages[0]?.content).toContain('<note>\nmilk, eggs\n</note>');
    await expect(suggestNoteTitle(client, 'm1', 'x', 'n1')).rejects.toThrow('no title');
  });
});

describe('pinned notes order', () => {
  it('reads the order the web saves, and sorts by it with the rest after, as listed', () => {
    expect(pinnedNotesOrderOf({ pinnedNotesOrder: ['b', 3, '', 'a'] })).toEqual(['b', 'a']);
    expect(pinnedNotesOrderOf(null)).toEqual([]);
    const notes = [{ id: 'a' }, { id: 'x' }, { id: 'b' }, { id: 'y' }];
    expect(sortPinnedNotes(notes, ['b', 'a']).map((note) => note.id)).toEqual(['b', 'a', 'x', 'y']);
    expect(sortPinnedNotes(notes, []).map((note) => note.id)).toEqual(['a', 'x', 'b', 'y']);
  });
});
