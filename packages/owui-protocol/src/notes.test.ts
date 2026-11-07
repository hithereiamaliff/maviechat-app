import { describe, expect, it } from 'vitest';
import type { Capabilities } from './capabilities';
import { OwuiClient, type FetchLike } from './http';
import { createNote, deleteNote, getNote, listNoteChoices, listNotes, listPinnedNotes, newNoteTitle, noteChangeOf, noteLink, noteTitle, saveKeepsSharing, saveNote, saveNoteNow, toggleNotePinned } from './notes';

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
});
