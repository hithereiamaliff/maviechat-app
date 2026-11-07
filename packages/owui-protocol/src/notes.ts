import { accessRights } from './access';
import type { Capabilities } from './capabilities';
import type { FileItem } from './files';
import type { OwuiClient } from './http';
import { isAtLeast } from './version';
import { grantsOf, type AccessGrant } from './workspaceModels';

/*
 * Notes (Open WebUI 0.11.3, `/api/v1/notes/*`, with `enable_notes` and `features.notes`): a title
 * and the text, kept three ways in `data.content`: the web editor's own JSON, HTML, and Markdown.
 * The phone writes Markdown and saves it with the HTML the web loads (`json` left empty, as the
 * web's own Markdown import does). On 0.11 every save sends the note's sharing again, as the web
 * does: one without it leaves the note shared with nobody (0.12 saves leave sharing alone). 0.12
 * splits a note into pages (`data.pages`); `data.content` is then all of them, for reading, and
 * text is saved into a note of one page only. Times are in nanoseconds.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const ms = (nanoseconds: unknown): number => (typeof nanoseconds === 'number' ? Math.round(nanoseconds / 1_000_000) : 0);
const base = '/api/v1/notes';

/** A note in a list: the list sends the start of its Markdown (1,000 characters). */
export interface NoteSummary {
  id: string;
  /** As saved ('' shows as "Untitled"). */
  title: string;
  preview: string;
  pinned: boolean;
  ownerId: string;
  ownerName: string;
  /** Milliseconds. */
  createdAt: number;
  updatedAt: number;
}

/** A whole note. */
export interface Note extends NoteSummary {
  md: string;
  html: string;
  /** The rest of `data` (files, versions…), kept as it is. */
  data: Tree;
  accessGrants: AccessGrant[];
  /** You may change the text (the title is the owner's, or an admin's, to change, as on the web). */
  writeAccess: boolean;
  /** 0.12's pages (0 on 0.11). With more than one, `md` is all of them, for reading. */
  pageCount: number;
}

export const noteTitle = (note: Pick<NoteSummary, 'title'>): string => note.title.trim() || 'Untitled';

function summaryOf(raw: unknown): NoteSummary | null {
  const row = record(raw);
  const id = text(row.id);
  if (!id) return null;
  const user = record(row.user);
  return {
    id,
    title: text(row.title),
    preview: text(record(record(row.data).content).md),
    pinned: row.is_pinned === true,
    ownerId: text(row.user_id) || text(user.id),
    ownerName: text(user.name) || text(user.email),
    createdAt: ms(row.created_at),
    updatedAt: ms(row.updated_at),
  };
}

function noteOf(raw: unknown, writeAccess?: boolean): Note {
  const row = record(raw);
  const summary = summaryOf(row);
  if (!summary) throw new Error('Open WebUI did not describe the note');
  const data = record(row.data);
  const content = record(data.content);
  return {
    ...summary,
    md: text(content.md),
    html: text(content.html),
    data,
    accessGrants: grantsOf(row.access_grants),
    writeAccess: writeAccess ?? row.write_access === true,
    pageCount: list(data.pages).length,
  };
}

/** Whose notes: all, `created` yours, `shared` others'. */
export type NoteView = '' | 'created' | 'shared';

export interface NoteListQuery {
  query?: string;
  view?: NoteView;
  /** Notes shared with you to read only (the web's "Read Only"); otherwise the ones you may change. */
  readOnly?: boolean;
  orderBy?: 'name' | 'updated_at' | 'created_at';
  direction?: 'asc' | 'desc';
  /** From 1, 60 a page. */
  page?: number;
}

export const NOTES_PAGE_SIZE = 60;

/** One page of notes, as the web's Notes page searches them (words in the title or the text). */
export async function listNotes(client: OwuiClient, query: NoteListQuery = {}): Promise<{ items: NoteSummary[]; total: number }> {
  const params: Record<string, string | number> = { page: query.page ?? 1, order_by: query.orderBy ?? 'updated_at', direction: query.direction ?? 'desc' };
  if (query.query?.trim()) params.query = query.query.trim();
  if (query.view) params.view_option = query.view;
  // Yours are never read-only, so the web sends no such filter for them.
  if (query.readOnly && query.view !== 'created') params.permission = 'read_only';
  const body = record(await client.get<unknown>(`${base}/search`, { query: params }));
  return { items: list(body.items).flatMap((row) => summaryOf(row) ?? []), total: typeof body.total === 'number' ? body.total : 0 };
}

/** The notes you pinned to the sidebar. */
export async function listPinnedNotes(client: OwuiClient): Promise<NoteSummary[]> {
  return list(await client.get<unknown>(`${base}/pinned`)).flatMap((row) => summaryOf(row) ?? []);
}

export async function getNote(client: OwuiClient, id: string): Promise<Note> {
  return noteOf(await client.get<unknown>(`${base}/${encodeURIComponent(id)}`));
}

/** The note's text as saved: Markdown, the HTML the web loads, and no editor JSON (the web then reads the HTML). */
export const noteContent = (md: string, html: string): Tree => ({ json: null, html, md });

/** A new note of yours, private, as the web makes one (its title is today's date there). */
export async function createNote(client: OwuiClient, input: { title: string; md?: string; html?: string }): Promise<Note> {
  const answer = await client.post<unknown>(`${base}/create`, { title: input.title, data: { content: noteContent(input.md ?? '', input.html ?? '') }, meta: null, access_grants: [] });
  return noteOf(answer, true);
}

/**
 * Saves a title and, when given, new text (`md` with its `html`). The note's sharing goes with it
 * as read, because the server sets the sharing on every save; the rest of `data` stays as it is.
 */
export async function saveNote(client: OwuiClient, note: Pick<Note, 'id' | 'title' | 'accessGrants' | 'writeAccess'>, change: { title?: string; md?: string; html?: string }): Promise<Note> {
  const body: Tree = { title: change.title ?? note.title, access_grants: note.accessGrants };
  if (change.md !== undefined) body.data = { content: noteContent(change.md, change.html ?? '') };
  return noteOf(await client.post<unknown>(`${base}/${encodeURIComponent(note.id)}/update`, body), note.writeAccess);
}

/**
 * Saves with the sharing as it is on the server now (read just before), so a save from the phone
 * never undoes sharing changed elsewhere meanwhile. An empty title is saved as "Untitled", as on
 * the web.
 */
export async function saveNoteNow(client: OwuiClient, id: string, change: { title?: string; md?: string; html?: string }): Promise<Note> {
  const current = await getNote(client, id);
  const title = change.title === undefined ? undefined : change.title.trim() ? change.title : 'Untitled';
  return saveNote(client, current, { ...change, title });
}

/** Pins a note to your sidebar, or takes it off; answers with the note. */
export async function toggleNotePinned(client: OwuiClient, id: string): Promise<NoteSummary> {
  const note = summaryOf(await client.post<unknown>(`${base}/${encodeURIComponent(id)}/pin`, undefined));
  if (!note) throw new Error('Open WebUI did not describe the note');
  return note;
}

export async function deleteNote(client: OwuiClient, id: string): Promise<void> {
  await client.delete<unknown>(`${base}/${encodeURIComponent(id)}/delete`);
}

/** The note's address on the web. */
export const noteLink = (baseUrl: string, id: string): string => `${baseUrl}/notes/${encodeURIComponent(id)}`;

/** A new note's title, as the web's Notes page makes it: today's date, YYYY-MM-DD. */
export function newNoteTitle(now: Date): string {
  const two = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

/**
 * Whether a save keeps the note's sharing. On 0.11 each save sends it again, and the server keeps
 * only what this account may grant (everyone with `sharing.public_notes`, people and groups with
 * their permissions; admins all of it), so a save by someone who may not would quietly un-share
 * it. 0.12 saves don't touch sharing.
 */
export function saveKeepsSharing(grants: AccessGrant[], capabilities: Capabilities): boolean {
  if (isAtLeast(capabilities.version, '0.12.0')) return true;
  if (capabilities.isAdmin) return grants.every((grant) => grant.principal_type !== 'anyone');
  const rights = accessRights(capabilities, 'notes');
  return grants.every((grant) => {
    if (grant.principal_type === 'anyone') return false;
    if (grant.principal_type === 'user') return grant.principal_id === '*' ? rights.everyone : rights.people;
    return rights.groups;
  });
}

/** What another device or the web changed in a note (`events:note`): only what it sent. */
export interface NoteChange {
  id: string;
  title?: string;
  /** Present when the text changed. */
  md?: string;
  html?: string;
  updatedAt: number;
  accessGrants?: AccessGrant[];
}

export function noteChangeOf(raw: unknown): NoteChange | null {
  const row = record(raw);
  const id = text(row.id);
  if (!id) return null;
  const content = record(row.data).content;
  const change: NoteChange = { id, updatedAt: ms(row.updated_at) };
  if (typeof row.title === 'string') change.title = row.title;
  if (typeof content === 'object' && content !== null) {
    change.md = text(record(content).md);
    change.html = text(record(content).html);
  }
  if (Array.isArray(row.access_grants)) change.accessGrants = grantsOf(row.access_grants);
  return change;
}

/** A note you can attach (the + menu's Attach Notes). */
export interface NoteChoice {
  id: string;
  title: string;
  /** Milliseconds. */
  updatedAt: number;
}

/** Your notes, newest first, a page at a time; or those matching `query`. */
export async function listNoteChoices(client: OwuiClient, query: string, page = 1): Promise<NoteChoice[]> {
  const words = query.trim();
  const raw = words ? (record(await client.get<unknown>(`${base}/search`, { query: { query: words, page } })).items ?? []) : await client.get<unknown>(`${base}/`, { query: { page } });
  return list(raw).flatMap((row) => {
    const note = summaryOf(row);
    return note ? [{ id: note.id, title: noteTitle(note), updatedAt: note.updatedAt }] : [];
  });
}

/** A note for the model to read, as the web attaches it. */
export function noteReferenceItem(note: NoteChoice, itemId: string): FileItem {
  return { type: 'note', id: note.id, url: '', name: note.title, status: 'processed', itemId };
}
