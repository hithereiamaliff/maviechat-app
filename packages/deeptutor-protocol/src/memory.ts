import type { DtClient } from './http';

/*
 * Memory (DeepTutor 1.7.1), in three layers. L1 is your workspace itself, read live (chats,
 * favorites, quizzes, knowledge bases, books, partner conversations, Co-Writer pages). L2 is one
 * fact sheet per area, each fact citing the L1 items it came from. L3 is the big picture drawn
 * from the fact sheets (recent, profile, knowledge scope), plus preferences, which chats write
 * when you state one. Sheets are Markdown: `## sections`, one bullet per fact ending in footnote
 * markers and an entry-id comment, then the footnotes, one source each. Older sheets cite with
 * `[^m_…]` markers whose footnote lists the sources.
 *
 * The model fills the sheets in "runs" you start; a run keeps going on the server if you leave,
 * and can be cancelled and undone. DeepTutor's run list isn't limited to your account, so the app
 * only ever follows runs it started itself.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

export type DtMemoryLayer = 'L2' | 'L3';

/** The areas of your workspace memory reads (L1), each with its fact sheet (L2). */
export const MEMORY_SURFACES = [
  { key: 'chat', label: 'Chats' },
  { key: 'notebook', label: 'Favorites' },
  { key: 'quiz', label: 'Quizzes' },
  { key: 'kb', label: 'Knowledge Bases' },
  { key: 'book', label: 'Books' },
  { key: 'partner', label: 'Partners' },
  { key: 'cowriter', label: 'Co-Writer' },
] as const;

/** The big-picture sheets (L3). Preferences are written by chats, never by a run. */
export const MEMORY_SLOTS = [
  { key: 'recent', label: 'Recent Summary' },
  { key: 'profile', label: 'Your Profile' },
  { key: 'scope', label: 'Knowledge Scope' },
  { key: 'preferences', label: 'Preferences' },
] as const;

export function memoryDocLabel(layer: DtMemoryLayer, key: string): string {
  const rows: readonly { key: string; label: string }[] = layer === 'L2' ? MEMORY_SURFACES : MEMORY_SLOTS;
  return rows.find((row) => row.key === key)?.label ?? key;
}

const ENTRY_ID = /^m_[0-9A-HJKMNP-TV-Z]{26}$/;
const TRACE_ID = /^[a-z][a-z0-9_-]*:[0-9A-HJKMNP-TV-Z]{26}$/;
const ITEM_REF = /^[a-z][a-z0-9_-]*:[A-Za-z0-9_.:-]+$/;

export const isMemoryEntryId = (value: string): boolean => ENTRY_ID.test(value);

// ── Overview ─────────────────────────────────────────────────────────────────

export interface DtMemoryDocInfo {
  layer: DtMemoryLayer;
  key: string;
  exists: boolean;
  /** ISO time, or null. */
  updatedAt: string | null;
  entries: number;
}

export interface DtMemoryOverview {
  docs: DtMemoryDocInfo[];
  /** Memory kept from DeepTutor's first memory system, archived when it was upgraded. */
  archived: boolean;
}

export async function getMemoryOverview(client: DtClient): Promise<DtMemoryOverview> {
  const body = record(await client.get<unknown>('/api/memory/overview'));
  const docs = list(body.docs).flatMap((raw): DtMemoryDocInfo[] => {
    const row = record(raw);
    const layer = row.layer === 'L2' || row.layer === 'L3' ? row.layer : null;
    const key = text(row.key);
    if (!layer || !key) return [];
    return [{ layer, key, exists: row.exists === true, updatedAt: text(row.updated_at) || null, entries: count(row.entry_count) }];
  });
  return { docs, archived: list(body.backups).length > 0 };
}

// ── Sheets ───────────────────────────────────────────────────────────────────

export interface DtMemoryEntry {
  /** `m_…`; '' for a bullet without one (shown, not editable). */
  id: string;
  text: string;
  /** Where it came from: items (`chat:…`), fact sheets (`chat`), facts (`m_…`) or a chat turn. */
  refs: string[];
}

export interface DtMemorySheet {
  title: string;
  sections: { name: string; entries: DtMemoryEntry[] }[];
}

/** Reads a fact sheet in either citation style. */
export function parseMemorySheet(markdown: string): DtMemorySheet {
  const lines = markdown.split(/\r?\n/);
  // Footnotes first: numbered ones name one source; older ones, named after a fact, list several.
  const numbered = new Map<string, string>();
  const byEntry = new Map<string, string[]>();
  for (const line of lines) {
    const footnote = /^\[\^([^\]]+)\]:\s*(.*?)\s*$/.exec(line);
    if (!footnote) continue;
    const [, label = '', rest = ''] = footnote;
    if (ENTRY_ID.test(label))
      byEntry.set(
        label,
        rest
          .split(',')
          .map((ref) => ref.trim())
          .filter(Boolean),
      );
    else numbered.set(label, rest);
  }
  const sheet: DtMemorySheet = { title: '', sections: [] };
  let section: { name: string; entries: DtMemoryEntry[] } | null = null;
  const into = () => {
    if (!section) {
      section = { name: '', entries: [] };
      sheet.sections.push(section);
    }
    return section;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\[\^[^\]]+\]:/.test(line)) continue;
    const heading = /^(#{1,2})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (heading[1] === '#') {
        if (!sheet.title) sheet.title = heading[2] ?? '';
      } else {
        section = { name: heading[2] ?? '', entries: [] };
        sheet.sections.push(section);
      }
      continue;
    }
    const bullet = /^\s*-\s+(.*)$/.exec(line);
    if (!bullet) continue;
    let body = bullet[1] ?? '';
    let id = '';
    let refs: string[] = [];
    const comment = /<!--\s*(m_[0-9A-HJKMNP-TV-Z]{26})\s*-->\s*$/.exec(body);
    if (comment) {
      id = comment[1] ?? '';
      body = body.slice(0, comment.index).trimEnd();
      // Footnote markers at the end, perhaps with commas between them.
      const markers: string[] = [];
      for (;;) {
        const marker = /,?\s*\[\^([^\]]+)\]\s*,?\s*$/.exec(body);
        if (!marker) break;
        markers.unshift(marker[1] ?? '');
        body = body.slice(0, marker.index).trimEnd();
      }
      refs = markers.flatMap((label) => numbered.get(label) ?? []);
    } else {
      const old = /\[\^(m_[0-9A-HJKMNP-TV-Z]{26})\]\s*$/.exec(body);
      if (old) {
        id = old[1] ?? '';
        body = body.slice(0, old.index).trimEnd();
        refs = byEntry.get(id) ?? [];
      }
    }
    if (!body) continue;
    into().entries.push({ id, text: body, refs: [...new Set(refs.filter(Boolean))] });
  }
  sheet.sections = sheet.sections.filter((part) => part.entries.length);
  return sheet;
}

export const memoryDocPath = (layer: DtMemoryLayer, key: string) => `/api/memory/doc/${layer}/${encodeURIComponent(key)}`;

/** A sheet's Markdown ('' when it has none yet). */
export async function getMemoryDoc(client: DtClient, layer: DtMemoryLayer, key: string): Promise<string> {
  return text(record(await client.get<unknown>(memoryDocPath(layer, key))).content);
}

/** What one source of a fact is, and where it leads. */
export type DtMemoryRef =
  /** An item of your workspace: a chat, a favorite, a quiz attempt… */
  | { kind: 'item'; surface: string; id: string }
  /** A whole fact sheet (how the big-picture sheets cite). */
  | { kind: 'sheet'; surface: string }
  /** One fact on a fact sheet (older big-picture sheets cite these). */
  | { kind: 'fact'; id: string }
  /** A moment in a chat (how chats cite preferences); it doesn't open anything. */
  | { kind: 'turn'; surface: string }
  | { kind: 'unknown'; ref: string };

export function describeMemoryRef(ref: string): DtMemoryRef {
  if (ENTRY_ID.test(ref)) return { kind: 'fact', id: ref };
  if (MEMORY_SURFACES.some((surface) => surface.key === ref)) return { kind: 'sheet', surface: ref };
  if (TRACE_ID.test(ref)) return { kind: 'turn', surface: ref.slice(0, ref.indexOf(':')) };
  if (ITEM_REF.test(ref)) {
    const colon = ref.indexOf(':');
    return { kind: 'item', surface: ref.slice(0, colon), id: ref.slice(colon + 1) };
  }
  return { kind: 'unknown', ref };
}

/** The fact sheet and fact an older big-picture sheet cites. */
export async function resolveMemoryFact(client: DtClient, id: string): Promise<{ layer: DtMemoryLayer; key: string; id: string }> {
  const body = record(await client.get<unknown>(`/api/memory/resolve_entry/${encodeURIComponent(id)}`));
  return { layer: body.layer === 'L3' ? 'L3' : 'L2', key: text(body.key), id: text(body.entry_id) || id };
}

/** The most a fact may say. */
export const MEMORY_FACT_MAX = 240;

/** Rewords a fact, keeping its sources (DeepTutor wants every fact to cite one). */
export async function editMemoryFact(client: DtClient, layer: DtMemoryLayer, key: string, entry: { id: string; refs: string[] }, newText: string): Promise<void> {
  const body = record(await client.post<unknown>(`${memoryDocPath(layer, key)}/apply`, { ops: [{ op: 'edit', target_id: entry.id, new_text: newText, new_refs: entry.refs }] }));
  if (body.accepted === false) throw new Error(text(body.reason) || 'DeepTutor refused the change');
}

/** Adds a fact citing `refs` (the app itself doesn't offer this: a fact needs a source). */
export async function addMemoryFact(client: DtClient, layer: DtMemoryLayer, key: string, fact: { section: string; text: string; refs: string[] }): Promise<string> {
  const body = record(await client.post<unknown>(`${memoryDocPath(layer, key)}/apply`, { ops: [{ op: 'add', section: fact.section, text: fact.text, refs: fact.refs }] }));
  if (body.accepted === false) throw new Error(text(body.reason) || 'DeepTutor refused the fact');
  return text(record(list(body.results)[0]).entry_id);
}

export async function deleteMemoryFact(client: DtClient, layer: DtMemoryLayer, key: string, id: string): Promise<void> {
  await client.delete<unknown>(`${memoryDocPath(layer, key)}/entry/${encodeURIComponent(id)}`);
}

/** Empties a sheet and forgets what it has read, so its next update reads everything again. */
export async function resetMemoryDoc(client: DtClient, layer: DtMemoryLayer, key: string): Promise<void> {
  await client.post<unknown>(`${memoryDocPath(layer, key)}/reset`);
}

/** Labels (and where they lead) for the items of one area, to name a fact's sources. */
export interface DtMemoryItem {
  id: string;
  label: string;
  meta: Tree;
}

/** One area's items. Not for chats: that list carries every message of every chat. */
export async function getMemoryItems(client: DtClient, surface: string): Promise<DtMemoryItem[]> {
  const body = record(await client.get<unknown>(`/api/memory/snapshot/${encodeURIComponent(surface)}`));
  return list(body.entities).flatMap((raw) => {
    const row = record(raw);
    const id = text(row.id);
    return id ? [{ id, label: text(row.label) || id, meta: record(row.metadata) }] : [];
  });
}

// ── Runs ─────────────────────────────────────────────────────────────────────

/** update: gather new facts; audit: check facts against their sources; dedup: merge repeats. */
export type DtMemoryRunMode = 'update' | 'audit' | 'dedup' | 'merge';

/** The runs a sheet allows (preferences are written by chats, so only tidied). */
export function memoryRunModes(layer: DtMemoryLayer, key: string): DtMemoryRunMode[] {
  return layer === 'L3' && key === 'preferences' ? ['dedup'] : ['update', 'audit', 'dedup'];
}

export interface DtMemoryRun {
  id: string;
  layer: DtMemoryLayer;
  key: string;
  mode: string;
  status: 'queued' | 'running' | 'cancelled' | 'done' | 'error';
  error: string;
  events: number;
  undos: number;
}

export const memoryRunActive = (run: DtMemoryRun): boolean => run.status === 'queued' || run.status === 'running';

function runOf(raw: unknown): DtMemoryRun {
  const row = record(raw);
  const status = text(row.status);
  return {
    id: text(row.id),
    layer: row.layer === 'L3' ? 'L3' : 'L2',
    key: text(row.key),
    mode: text(row.mode),
    status: status === 'queued' || status === 'running' || status === 'cancelled' || status === 'done' || status === 'error' ? status : 'error',
    error: text(row.error),
    events: count(row.event_count),
    undos: count(row.undo_count),
  };
}

/** How many model calls a run may make, from DeepTutor's settings (read only: they're shared by every account). */
export async function getMemoryRunLimits(client: DtClient): Promise<{ update: Record<DtMemoryLayer, number>; audit: Record<DtMemoryLayer, number>; dedupIterations: number }> {
  const body = record(await client.get<unknown>('/api/memory/settings'));
  const pair = (value: unknown) => {
    const row = record(value);
    return { L2: clampBudget(count(row.l2_budget) || 20), L3: clampBudget(count(row.l3_budget) || 10) };
  };
  return { update: pair(body.update), audit: pair(body.audit), dedupIterations: Math.min(20, Math.max(1, count(record(body.dedup).iterations) || 3)) };
}

const clampBudget = (value: number) => Math.min(200, Math.max(1, Math.round(value)));

/**
 * Starts a run on one sheet with the account's default model. DeepTutor doesn't limit a run's
 * size itself, so the app keeps it to the web's limits. 409: a run on this sheet is going already
 * (perhaps another account's).
 */
export async function startMemoryRun(client: DtClient, input: { layer: DtMemoryLayer; key: string; mode: DtMemoryRunMode; budget?: number; iterations?: number }): Promise<DtMemoryRun> {
  const body: Tree = { layer: input.layer, key: input.key, mode: input.mode, language: 'en' };
  if (input.budget !== undefined) body.budget = clampBudget(input.budget);
  if (input.iterations !== undefined) body.iterations = Math.min(20, Math.max(1, Math.round(input.iterations)));
  return runOf(await client.post<unknown>('/api/memory/runs/start', body));
}

/** One run this app started. */
export async function getMemoryRun(client: DtClient, id: string): Promise<DtMemoryRun> {
  return runOf(await client.get<unknown>(`/api/memory/runs/${encodeURIComponent(id)}`));
}

export async function cancelMemoryRun(client: DtClient, id: string): Promise<void> {
  await client.post<unknown>(`/api/memory/runs/${encodeURIComponent(id)}/cancel`);
}

/** Puts the sheet back as it was before the run's last change (again for the one before). 409: nothing left to undo. */
export async function undoMemoryRun(client: DtClient, id: string): Promise<void> {
  await client.post<unknown>(`/api/memory/runs/${encodeURIComponent(id)}/undo`);
}
