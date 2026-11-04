import type { DtClient } from './http';

/*
 * Co-Writer (DeepTutor 1.7.1), the "Learning notebook": pages of blocks (BlockNote's), nested
 * under each other, with an icon, a cover and a pin. DeepTutor sends every page with a Markdown
 * copy of its blocks (`content`), which the app shows; editing blocks stays on DeepTutor's page.
 * Older pages (Word imports, pages a chat wrote) are Markdown only (`blocks` null). Each save
 * bumps `revision`, and a save must name the revision it started from.
 *
 * Flashcards are learning blocks of kind `flashcards`, reviewed across every page. Dito, the
 * page's companion, talks in ordinary chats that carry the page's id; it suggests edits, which
 * change the page only when accepted.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
/** Seconds or milliseconds or ISO, as milliseconds. */
const ms = (value: unknown): number => (typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : typeof value === 'string' ? Date.parse(value) || 0 : 0);
const pagePath = (id: string) => `/api/documents/${encodeURIComponent(id)}`;

export interface DtNoteSummary {
  id: string;
  title: string;
  /** Its first words, as plain text. */
  preview: string;
  parentId: string | null;
  /** An emoji, or ''. */
  icon: string;
  /** A CSS background (a colour or a gradient), or ''. */
  cover: string;
  pinned: boolean;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface DtNotePage extends DtNoteSummary {
  /** DeepTutor's Markdown copy of the blocks (or the page itself, for an older one). */
  content: string;
  /** null for an older, Markdown-only page. */
  blocks: Tree[] | null;
}

function summaryOf(raw: unknown): DtNoteSummary | null {
  const row = record(raw);
  const id = text(row.id);
  if (!id) return null;
  return {
    id,
    title: text(row.title),
    preview: text(row.preview),
    parentId: text(row.parent_id) || null,
    icon: text(row.icon),
    cover: text(row.cover),
    pinned: row.pinned === true,
    revision: count(row.revision),
    createdAt: ms(row.created_at),
    updatedAt: ms(row.updated_at),
  };
}

function pageOf(raw: unknown): DtNotePage {
  const summary = summaryOf(raw);
  if (!summary) throw new Error('DeepTutor did not describe the page');
  const row = record(raw);
  return { ...summary, content: text(row.content), blocks: Array.isArray(row.blocks) ? row.blocks.map(record) : null };
}

/** Every page, most recently edited first (DeepTutor's order). */
export async function listNotePages(client: DtClient): Promise<DtNoteSummary[]> {
  return list(record(await client.get<unknown>('/api/documents')).documents).flatMap((row) => summaryOf(row) ?? []);
}

export async function getNotePage(client: DtClient, id: string): Promise<DtNotePage> {
  return pageOf(await client.get<unknown>(pagePath(id)));
}

/** A blank page (of blocks), at the top or inside another. */
export async function createNotePage(client: DtClient, input: { title?: string; parentId?: string | null } = {}): Promise<DtNotePage> {
  return pageOf(await client.post<unknown>('/api/documents', { title: input.title ?? '', parent_id: input.parentId ?? null, content: '', blocks: [] }));
}

/** Pins, moves or renames a page, from the revision you have (409: it changed elsewhere). */
export async function updateNotePage(client: DtClient, page: Pick<DtNoteSummary, 'id' | 'revision'>, change: { pinned?: boolean; parentId?: string | null; title?: string; icon?: string; cover?: string }): Promise<DtNotePage> {
  const body: Tree = { expected_revision: page.revision };
  if (change.pinned !== undefined) body.pinned = change.pinned;
  if (change.parentId !== undefined) body.parent_id = change.parentId;
  if (change.title !== undefined) body.title = change.title;
  if (change.icon !== undefined) body.icon = change.icon;
  if (change.cover !== undefined) body.cover = change.cover;
  return pageOf((await client.send<unknown>('PUT', pagePath(page.id), { body })).data);
}

/** Deletes a page for good; its subpages move up a level. */
export async function deleteNotePage(client: DtClient, id: string): Promise<void> {
  await client.delete<unknown>(pagePath(id));
}

/** Pages that link to this one. */
export async function noteBacklinks(client: DtClient, id: string): Promise<DtNoteSummary[]> {
  return list(record(await client.get<unknown>(`${pagePath(id)}/backlinks`)).pages).flatMap((row) => summaryOf(row) ?? []);
}

/** Pages at the top: no parent, or one that's gone. */
export function topLevelPages(pages: DtNoteSummary[]): DtNoteSummary[] {
  const ids = new Set(pages.map((page) => page.id));
  return pages.filter((page) => !page.parentId || !ids.has(page.parentId));
}

export const childPages = (pages: DtNoteSummary[], id: string): DtNoteSummary[] => pages.filter((page) => page.parentId === id);

/** The pages above one, from the top. */
export function pageTrail(pages: DtNoteSummary[], id: string): DtNoteSummary[] {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const trail: DtNoteSummary[] = [];
  const seen = new Set<string>([id]);
  for (let at = byId.get(id)?.parentId; at && !seen.has(at); at = byId.get(at)?.parentId) {
    seen.add(at);
    const parent = byId.get(at);
    if (!parent) break;
    trail.unshift(parent);
  }
  return trail;
}

/** The colour of a page's cover (its first colour, for a gradient), or ''. */
export function coverColor(cover: string): string {
  return /#[0-9a-fA-F]{3,8}\b/.exec(cover)?.[0] ?? /rgba?\([^)]*\)/.exec(cover)?.[0] ?? '';
}

export const noteTitle = (page: Pick<DtNoteSummary, 'title'>): string => page.title.trim() || 'Untitled';

/** The id of a page's first block (Dito's conversations are anchored to a block), or ''. */
export const firstBlockId = (page: Pick<DtNotePage, 'blocks'>): string => text(page.blocks?.[0]?.id);

// ── Flashcards ───────────────────────────────────────────────────────────────

export interface DtDueCard {
  pageId: string;
  pageTitle: string;
  cardId: string;
  front: string;
  back: string;
  dueAt: number;
}

/** Cards due now, across every page (200 at most, the longest-waiting first). */
export async function dueFlashcards(client: DtClient): Promise<DtDueCard[]> {
  return list(record(await client.get<unknown>('/api/documents/review/due')).cards).flatMap((raw) => {
    const row = record(raw);
    const cardId = text(row.card_id);
    const pageId = text(row.page_id);
    return cardId && pageId ? [{ pageId, pageTitle: text(row.page_title), cardId, front: text(row.front), back: text(row.back), dueAt: ms(row.due_at) }] : [];
  });
}

/** Again (back in 10 minutes) or Remembered (the gap roughly doubles, up to 180 days). */
export async function gradeFlashcard(client: DtClient, card: Pick<DtDueCard, 'pageId' | 'cardId'>, remembered: boolean): Promise<{ intervalDays: number; dueAt: number }> {
  const body = record(await client.post<unknown>(`${pagePath(card.pageId)}/review`, { card_id: card.cardId, remembered }));
  return { intervalDays: count(body.interval_days), dueAt: ms(body.due_at) };
}

/** Anki's import file (tab-separated) for every page's cards, or one page's. */
export async function ankiExport(client: DtClient, pageId?: string): Promise<string> {
  const body = await client.get<unknown>(pageId ? `${pagePath(pageId)}/flashcards/export` : '/api/documents/flashcards/export', { timeoutMs: 60_000 });
  return typeof body === 'string' ? body : '';
}

/** The page as a Word file (text and links; interactive blocks flattened). */
export async function wordExport(client: DtClient, page: Pick<DtNotePage, 'title' | 'content'>): Promise<Uint8Array> {
  return (await client.sendBytes('POST', '/api/documents/export/docx', { body: { title: noteTitle(page), content: page.content }, timeoutMs: 60_000 })).bytes;
}

/** A Word file (.docx, 20 MB at most) as a new, Markdown-only page. */
export async function importWord(client: DtClient, file: Blob | { uri: string; name: string; type: string }, name: string): Promise<DtNotePage> {
  const form = new FormData();
  // React Native sends `{uri, name, type}` from the file itself; elsewhere a Blob.
  form.append('file', file as Blob, name);
  return pageOf((await client.send<unknown>('POST', '/api/documents/import/docx', { body: form, timeoutMs: 120_000 })).data);
}

// ── Dito: conversations and suggestions ──────────────────────────────────────

export interface DtNoteThread {
  sessionId: string;
  blockId: string;
  quote: string;
  title: string;
  /** idle, running, completed, failed, cancelled… */
  status: string;
  updatedAt: number;
  messages: number;
  lastMessage: string;
}

export async function listNoteThreads(client: DtClient, pageId: string): Promise<DtNoteThread[]> {
  return list(record(await client.get<unknown>(`${pagePath(pageId)}/threads`)).threads).flatMap((raw) => {
    const row = record(raw);
    const sessionId = text(row.session_id);
    return sessionId ? [{ sessionId, blockId: text(row.block_id), quote: text(row.quote), title: text(row.title), status: text(row.status), updatedAt: ms(row.updated_at ?? row.created_at), messages: count(row.message_count), lastMessage: text(row.last_message) }] : [];
  });
}

/** Ties a chat to a line of the page (after its first message names it). */
export async function anchorNoteThread(client: DtClient, pageId: string, thread: { sessionId: string; blockId: string; quote: string }): Promise<void> {
  await client.post<unknown>(`${pagePath(pageId)}/threads`, { session_id: thread.sessionId, block_id: thread.blockId, quote: thread.quote.slice(0, 4000), origin: 'ask' });
}

/** Deletes the conversation: its chat goes to DeepTutor's recycle bin. */
export async function deleteNoteThread(client: DtClient, pageId: string, sessionId: string): Promise<void> {
  await client.delete<unknown>(`${pagePath(pageId)}/threads/${encodeURIComponent(sessionId)}`);
}

export interface DtNoteSuggestion {
  id: string;
  operation: 'insert' | 'replace' | 'delete' | 'comment';
  blockId: string;
  markdown: string;
  /** The suggested blocks, when Dito wrote them as blocks; null for Markdown only. */
  blocks: Tree[] | null;
  explanation: string;
  status: 'pending' | 'accepted' | 'dismissed';
  createdAt: number;
}

export async function listNoteSuggestions(client: DtClient, pageId: string): Promise<DtNoteSuggestion[]> {
  return list(record(await client.get<unknown>(`${pagePath(pageId)}/suggestions`)).suggestions).flatMap((raw): DtNoteSuggestion[] => {
    const row = record(raw);
    const id = text(row.id);
    if (!id) return [];
    const operation = row.operation === 'replace' || row.operation === 'delete' || row.operation === 'comment' ? row.operation : 'insert';
    const status = row.status === 'accepted' || row.status === 'dismissed' ? row.status : 'pending';
    return [{ id, operation, blockId: text(row.block_id), markdown: text(row.markdown), blocks: Array.isArray(row.blocks) && row.blocks.length ? row.blocks.map(record) : null, explanation: text(row.explanation), status, createdAt: ms(row.created_at) }];
  });
}

/**
 * Whether the app can accept a suggestion itself: one that removes or only comments, or comes as
 * blocks. One in Markdown only needs turning into blocks first, which DeepTutor's page does.
 */
export const acceptableHere = (suggestion: DtNoteSuggestion): boolean => suggestion.operation === 'comment' || suggestion.operation === 'delete' || suggestion.blocks !== null;

/** Accepts (the page changes) or dismisses a suggestion; answers with the page as it is now. 409: the line changed since. */
export async function reviewNoteSuggestion(client: DtClient, pageId: string, suggestion: DtNoteSuggestion, accept: boolean): Promise<DtNotePage> {
  const body: Tree = { accept };
  if (accept && suggestion.blocks) body.blocks = suggestion.blocks;
  return pageOf(await client.post<unknown>(`${pagePath(pageId)}/suggestions/${encodeURIComponent(suggestion.id)}`, body));
}
