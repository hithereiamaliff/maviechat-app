import { accessRights } from './access';
import type { Capabilities } from './capabilities';
import type { ChatRecord } from './chats';
import type { FileItem } from './files';
import type { OwuiClient } from './http';
import { uuidv4 } from './ids';
import { parseGeneratedTitle } from './titles';
import { isAtLeast } from './version';
import { grantsOf, type AccessGrant } from './workspaceModels';

/*
 * Notes (Open WebUI 0.11.3, `/api/v1/notes/*`, with `enable_notes` and `features.notes`): a title
 * and the text, kept three ways in `data.content`: the web editor's own JSON, HTML, and Markdown.
 * The phone writes Markdown and saves it with the HTML the web loads (`json` left empty, as the
 * web's own Markdown import does). On 0.11 every save sends the note's sharing again, as the web
 * does: one without it leaves the note shared with nobody (0.12 saves leave sharing alone). 0.12
 * splits a note into pages (`data.pages`); `data.content` is then all of them, for reading, and
 * text is saved a page at a time (`page_id`). Files: on 0.11 the note keeps a list of them
 * (`data.files`, the web's attachments: documents and recordings); on 0.12 they are links in a
 * page's text (`[name](/api/v1/files/{id}/content)`), which its editor shows as attachments.
 * Pictures from the phone go in the text as links to the uploaded picture, which both versions'
 * editors keep (pictures held inside the text, as the web pastes them, only its own editor
 * keeps). Times are in nanoseconds.
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
  /** 0.12's pages, in order (a page's subpages follow it); empty on 0.11. */
  pages: NotePage[];
  /** 0.12: how many times the pages were changed; a page change names the count it saw. */
  pagesRevision: number;
  /** 0.11's attached files (documents and recordings), as `data.files` lists them. */
  files: NoteFile[];
}

/** A 0.12 page: its own title and text. Pages nest; the first, `main`, can't move or go. */
export interface NotePage {
  id: string;
  /** null at the top. */
  parentId: string | null;
  title: string;
  md: string;
  html: string;
  /** How far in it sits (0 at the top). */
  depth: number;
  /** The first page shows the note's title until it's renamed. */
  inheritsTitle: boolean;
}

/** A file attached to a note. */
export interface NoteFile {
  id: string;
  name: string;
  /** Bytes, 0 when not known. */
  size: number;
  /** `image/jpeg`, `audio/mp4`…; '' when not known. */
  contentType: string;
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
    pages: pagesOf(data.pages),
    pagesRevision: typeof data.pages_revision === 'number' ? data.pages_revision : 0,
    files: noteFilesOf(data.files),
  };
}

function pagesOf(raw: unknown): NotePage[] {
  const depths = new Map<string, number>();
  return list(raw).flatMap((item) => {
    const page = record(item);
    const id = text(page.id);
    if (!id) return [];
    const parentId = text(page.parent_id) || null;
    const depth = parentId === null ? 0 : (depths.get(parentId) ?? -1) + 1;
    depths.set(id, depth);
    const content = record(page.content);
    return [{ id, parentId, title: text(page.title), md: text(content.md), html: text(content.html), depth, inheritsTitle: id === 'main' && page.inherit_note_title !== false }];
  });
}

/** 0.11's list of a note's files: the uploaded ones (pictures held inside the text are left out, as the web leaves them out). */
export function noteFilesOf(raw: unknown): NoteFile[] {
  return list(raw).flatMap((item) => {
    const entry = record(item);
    const id = text(entry.id);
    if (entry.type !== 'file' || !id) return [];
    const file = record(entry.file);
    const meta = record(file.meta);
    const size = typeof entry.size === 'number' ? entry.size : typeof meta.size === 'number' ? meta.size : 0;
    return [{ id, name: text(entry.name) || text(meta.name) || text(file.filename) || 'File', size, contentType: text(entry.content_type) || text(meta.content_type) }];
  });
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

/** What a save changes: the title, a page's text (`md` with its `html`), 0.11's file list. */
export interface NoteEdit {
  title?: string;
  md?: string;
  html?: string;
  /** 0.11: the whole `data.files` list, as the web keeps it (empty saves none). */
  files?: unknown[];
  /** 0.12: the page the text is for. */
  pageId?: string;
}

/**
 * Saves a title and, when given, new text or files. The note's sharing goes with it as read,
 * because 0.11 sets the sharing on every save; the rest of `data` stays as it is.
 */
export async function saveNote(client: OwuiClient, note: Pick<Note, 'id' | 'title' | 'accessGrants' | 'writeAccess'>, change: NoteEdit): Promise<Note> {
  const body: Tree = { title: change.title ?? note.title, access_grants: note.accessGrants };
  const data: Tree = {};
  if (change.md !== undefined) data.content = noteContent(change.md, change.html ?? '');
  if (change.files !== undefined) data.files = change.files.length ? change.files : null;
  if (Object.keys(data).length) body.data = data;
  if (change.pageId) body.page_id = change.pageId;
  return noteOf(await client.post<unknown>(`${base}/${encodeURIComponent(note.id)}/update`, body), note.writeAccess);
}

/**
 * Saves with the sharing as it is on the server now (read just before), so a save from the phone
 * never undoes sharing changed elsewhere meanwhile; a change to the files is made to the list as
 * read then too. An empty title is saved as "Untitled", as on the web.
 */
export async function saveNoteNow(client: OwuiClient, id: string, change: Omit<NoteEdit, 'files'> & { files?: (current: unknown[]) => unknown[] }): Promise<Note> {
  const current = await getNote(client, id);
  const title = change.title === undefined ? undefined : change.title.trim() ? change.title : 'Untitled';
  const files = change.files ? change.files(list(current.data.files)) : undefined;
  return saveNote(client, current, { ...change, title, files });
}

/** 0.11: a note's file list with an upload added (the entry the web keeps: see `fileItemFromUpload`). */
export const withNoteFile = (files: unknown[], entry: FileItem): unknown[] => [...files.filter((item) => text(record(item).id) !== entry.id), entry];

/** 0.11: a note's file list without that file. */
export const withoutNoteFile = (files: unknown[], id: string): unknown[] => files.filter((item) => text(record(item).id) !== id);

const ATTACHMENT = /(!?)\[([^\]\n]*)\]\(\/api\/v1\/files\/([\w-]+)\/content\)/g;
const linkName = (name: string) => name.replace(/[[\]\n\r]+/g, ' ').trim() || 'file';

/** 0.12: the files a page's text attaches (links of their own to a server file; pictures aren't attachments). */
export function attachmentsIn(md: string): NoteFile[] {
  const seen = new Set<string>();
  const files: NoteFile[] = [];
  for (const match of md.matchAll(ATTACHMENT)) {
    const id = match[3] ?? '';
    if (match[1] === '!' || seen.has(id)) continue;
    seen.add(id);
    files.push({ id, name: match[2] || 'File', size: 0, contentType: '' });
  }
  return files;
}

/** A file attached in the text (0.12's attachment, as its own line). */
export const attachmentLink = (file: { id: string; name: string }): string => `[${linkName(file.name)}](/api/v1/files/${file.id}/content)`;

/** A picture shown in the text, from the uploaded picture. */
export const pictureLink = (file: { id: string; name: string }): string => `![${linkName(file.name)}](/api/v1/files/${file.id}/content)`;

/** The text without that file's attachment links (and the lines they leave empty). */
export function withoutAttachment(md: string, id: string): string {
  return md
    .split('\n')
    .flatMap((line) => {
      const next = line.replace(ATTACHMENT, (whole, bang: string, _name: string, fileId: string) => (bang !== '!' && fileId === id ? '' : whole));
      return next !== line && !next.trim() ? [] : [next];
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Pictures held inside the text, as the web pastes them (`data://…` on 0.11, `data:image/…` on
 * 0.12). The web's editor reads a note's HTML without them, so a save from the phone, which the
 * editor then loads from HTML, would lose them there.
 */
export const hasHeldPictures = (md: string, html: string): boolean => /\]\(\s*data:|<img[^>]+src=["']?data:/i.test(`${md}\n${html}`);

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
  /** Present when the text changed (on 0.12, the text of the page asked about). */
  md?: string;
  html?: string;
  updatedAt: number;
  accessGrants?: AccessGrant[];
  /** 0.11: the file list, when it was sent. */
  files?: unknown[];
  /** 0.12: the pages, when they were sent (with the text of each). */
  pages?: NotePage[];
  pagesRevision?: number;
}

/** A note event; on 0.12 the text is the given page's (else the first's). */
export function noteChangeOf(raw: unknown, pageId?: string | null): NoteChange | null {
  const row = record(raw);
  const id = text(row.id);
  if (!id) return null;
  const data = record(row.data);
  const change: NoteChange = { id, updatedAt: ms(row.updated_at) };
  if (typeof row.title === 'string') change.title = row.title;
  if (Array.isArray(data.pages)) {
    change.pages = pagesOf(data.pages);
    change.pagesRevision = typeof data.pages_revision === 'number' ? data.pages_revision : 0;
    const page = change.pages.find((item) => item.id === (pageId ?? 'main')) ?? (pageId ? undefined : change.pages[0]);
    if (page) {
      change.md = page.md;
      change.html = page.html;
    }
  } else if (typeof data.content === 'object' && data.content !== null) {
    change.md = text(record(data.content).md);
    change.html = text(record(data.content).html);
  }
  if ('files' in data) change.files = list(data.files);
  if (Array.isArray(row.access_grants)) change.accessGrants = grantsOf(row.access_grants);
  return change;
}

/** A 0.12 change to a note's pages (the server checks it against the pages' revision). */
export type PageOperation =
  | { action: 'create'; title: string; parentId: string | null }
  | { action: 'rename'; pageId: string; title: string }
  | { action: 'move'; pageId: string; parentId: string | null; beforeId: string | null }
  | { action: 'delete'; pageId: string };

/** Makes a page change; answers with the note, and the new page's id for a new one. */
export async function changeNotePages(client: OwuiClient, note: Pick<Note, 'id' | 'pagesRevision' | 'writeAccess'>, operation: PageOperation): Promise<{ note: Note; pageId: string | null }> {
  const newId = operation.action === 'create' ? uuidv4() : null;
  const body: Tree = { action: operation.action, revision: note.pagesRevision };
  if ('pageId' in operation) body.page_id = operation.pageId;
  if ('title' in operation) body.title = operation.title;
  if ('parentId' in operation) body.parent_id = operation.parentId;
  if ('beforeId' in operation) body.before_id = operation.beforeId;
  if (newId) body.new_id = newId;
  const answer = await client.post<unknown>(`${base}/${encodeURIComponent(note.id)}/pages/update`, body);
  return { note: noteOf(answer, note.writeAccess), pageId: newId };
}

/** A new page's title, as the web names one: "Page N", the next number not taken. */
export function newPageTitle(pages: Pick<NotePage, 'title'>[]): string {
  let number = pages.length + 1;
  while (pages.some((page) => page.title === `Page ${number}`)) number += 1;
  return `Page ${number}`;
}

/** A page one place up or down among its siblings (the first page stays first); null at the end. */
export function pageStep(pages: NotePage[], id: string, direction: -1 | 1): PageOperation | null {
  const page = pages.find((item) => item.id === id);
  if (!page || page.id === 'main') return null;
  const siblings = pages.filter((item) => item.id !== 'main' && item.parentId === page.parentId);
  const index = siblings.findIndex((item) => item.id === id);
  const next = index + direction;
  if (index === -1 || next < 0 || next >= siblings.length) return null;
  return { action: 'move', pageId: id, parentId: page.parentId, beforeId: siblings[direction < 0 ? next : next + 1]?.id ?? null };
}

/** Where a page can move to: the top, or under a page that isn't it or one of its subpages. */
export function pageParents(pages: NotePage[], id: string): NotePage[] {
  const branch = new Set([id]);
  for (const page of pages) if (page.parentId !== null && branch.has(page.parentId)) branch.add(page.id);
  return pages.filter((page) => !branch.has(page.id));
}

/** A page's address on the web. */
export const pageLink = (baseUrl: string, noteId: string, pageId: string): string => `${noteLink(baseUrl, noteId)}?page=${encodeURIComponent(pageId)}`;

/*
 * The note's chat (both versions): a hidden chat of yours tied to the note. The server gives its
 * model the note's tools (read it, rewrite it: `view_note`, `replace_note_content`) and, on 0.11,
 * the note's files; a rewrite comes back to the note as a note event.
 */

/** The note's chat, made the first time (the latest one of yours, after that). */
export function getNoteChat(client: OwuiClient, noteId: string): Promise<ChatRecord> {
  return client.get<ChatRecord>(`${base}/${encodeURIComponent(noteId)}/chat`);
}

/** Your chats about the note, newest first. */
export async function listNoteChats(client: OwuiClient, noteId: string): Promise<ChatRecord[]> {
  return list(await client.get<unknown>(`${base}/${encodeURIComponent(noteId)}/chats`)).filter((chat): chat is ChatRecord => typeof record(chat).id === 'string');
}

/** A new chat about the note. */
export function newNoteChat(client: OwuiClient, noteId: string): Promise<ChatRecord> {
  return client.post<ChatRecord>(`${base}/${encodeURIComponent(noteId)}/chat`, undefined);
}

/** The prompts the web suggests in a note's empty chat; the first is its Enhance. */
export const NOTE_CHAT_PROMPTS = ['Enhance this note and update it.', 'Summarize this note.', 'Extract action items from this note.', 'Rewrite the selected text.'] as const;

/** A message with the text you selected in the note, as the web adds it (for the model's rewrite). */
export const withNoteSelection = (message: string, selected: string): string =>
  selected.trim() ? `${message}\n\nSelected note text for replace_note_content operations:\n${selected.trim()}` : message;

/**
 * A title for the note from its text, by the model (the web's Generate beside the title). It goes
 * as a temporary chat named after the note (nothing is saved): connections that route by chat
 * (`{{CHAT_ID}}` in an admin's custom headers, as OpenCode Go's session header) refuse a request
 * with none.
 */
export async function suggestNoteTitle(client: OwuiClient, model: string, md: string, noteId: string): Promise<string> {
  const prompt = [
    'Suggest a title for the note below: two to four words, in the language the note is written in, saying what it is about.',
    'No emoji, quotation marks or formatting. Answer with JSON alone, like {"title": "Weekly Groceries"}.',
    '',
    '<note>',
    md,
    '</note>',
  ].join('\n');
  const answer = record(await client.post<unknown>('/api/chat/completions', { model, stream: false, chat_id: `temporary:note-${noteId}`, messages: [{ role: 'user', content: prompt }] }));
  const content = record(record(list(answer.choices)[0]).message).content;
  const title = typeof content === 'string' ? parseGeneratedTitle(content) : null;
  if (!title) throw new Error(typeof answer.detail === 'string' ? answer.detail : "The model's answer held no title");
  return title;
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
