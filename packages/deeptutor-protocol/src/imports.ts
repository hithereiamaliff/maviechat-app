import type { DtClient } from './http';
import type { DtPage, DtSessionSummary } from './sessions';

/*
 * Imported conversations (DeepTutor 1.7.1, "My Agents"): chats from ChatGPT's export, or from a
 * computer's Claude Code or Codex folders (imported on DeepTutor's web page), kept as DeepTutor
 * chats you can open, continue and refer to. They're left out of the chat history, so they're
 * listed here. Importing the same conversation again changes nothing: its id is fixed by its
 * source's own id. DeepTutor's web page shows only Claude Code and Codex imports; the app shows
 * ChatGPT's too.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export interface DtImportedChat extends DtSessionSummary {
  imported: {
    /** `chatgpt`, `claude_code` or `codex`. */
    source: string;
    /** The project folder a Claude Code chat came from, or ''. */
    folder: string;
    /** The import "agent" (a named slice of a folder, on the web page) it belongs to, or ''. */
    agentId: string;
    agentName: string;
  };
}

export async function listImportedChats(client: DtClient, { limit = 200, offset = 0 }: DtPage = {}): Promise<DtImportedChat[]> {
  const body = record(await client.get<unknown>('/api/imports/chat-history', { query: { limit: Math.min(200, Math.max(1, limit)), offset } }));
  return list(body.sessions).flatMap((raw): DtImportedChat[] => {
    const row = record(raw) as DtSessionSummary;
    const id = text(row.id) || text(row.session_id);
    if (!id) return [];
    const meta = record(record(row.preferences).import);
    const fromId = ['chatgpt', 'claude_code', 'codex'].find((source) => id.startsWith(`imported_${source}_`)) ?? '';
    return [{ ...row, id, title: text(row.title), imported: { source: text(meta.source) || fromId, folder: text(meta.source_cwd), agentId: text(meta.agent_id), agentName: text(meta.agent_name) } }];
  });
}

/** Every imported chat, a page of 200 at a time (up to `max`). */
export async function listAllImportedChats(client: DtClient, max = 2000): Promise<DtImportedChat[]> {
  const all: DtImportedChat[] = [];
  for (let offset = 0; offset < max; offset += 200) {
    const page = await listImportedChats(client, { limit: 200, offset });
    all.push(...page);
    if (page.length < 200) break;
  }
  return all;
}

const SOURCE_NAMES: Record<string, string> = { chatgpt: 'ChatGPT', claude_code: 'Claude Code', codex: 'Codex' };
export const importSourceName = (source: string): string => SOURCE_NAMES[source] ?? source;

function dayOf(value: unknown): string {
  const ms = typeof value === 'number' ? (value > 1e12 ? value : value * 1000) : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : '';
}

const timeOf = (value: unknown): number => (typeof value === 'number' ? (value > 1e12 ? value : value * 1000) : typeof value === 'string' ? Date.parse(value) || 0 : 0);

export interface DtImportGroup {
  key: string;
  label: string;
  source: string;
  chats: DtImportedChat[];
}

/**
 * Imported chats grouped as the web page groups them: by the import they belong to, else by
 * source, Claude Code by project folder and Codex by day; ChatGPT's in one group. Newest first.
 */
export function groupImportedChats(chats: DtImportedChat[]): DtImportGroup[] {
  const groups = new Map<string, DtImportGroup>();
  for (const chat of chats) {
    const { source, folder, agentId, agentName } = chat.imported;
    let key: string;
    let label: string;
    if (agentId) {
      key = `agent:${agentId}`;
      label = agentName || importSourceName(source);
    } else if (source === 'claude_code') {
      key = `claude_code:${folder}`;
      label = `Claude Code · ${folder.split(/[\\/]/).filter(Boolean).pop() || 'no project'}`;
    } else if (source === 'codex') {
      const day = dayOf(chat.created_at);
      key = `codex:${day}`;
      label = `Codex · ${day || 'undated'}`;
    } else {
      key = source;
      label = importSourceName(source);
    }
    const group = groups.get(key) ?? { key, label, source, chats: [] };
    group.chats.push(chat);
    groups.set(key, group);
  }
  const newest = (group: DtImportGroup) => Math.max(...group.chats.map((chat) => timeOf(chat.updated_at ?? chat.created_at)));
  for (const group of groups.values()) group.chats.sort((a, b) => timeOf(b.updated_at ?? b.created_at) - timeOf(a.updated_at ?? a.created_at));
  return [...groups.values()].sort((a, b) => newest(b) - newest(a));
}

// ── Importing ────────────────────────────────────────────────────────────────

export interface DtImportSession {
  external_id: string;
  title: string;
  source_cwd: string;
  created_at: number;
  updated_at: number;
  messages: { role: 'user' | 'assistant'; content: string; created_at?: number }[];
}

/** A conversation as the app's ChatGPT reader gives it (owui-protocol's `PlainConversation`). */
export interface DtPlainConversation {
  id: string | null;
  title: string;
  /** Unix seconds. */
  created: number;
  updated: number;
  messages: { role: 'user' | 'assistant'; text: string; at: number | null }[];
}

/** The id DeepTutor gives an imported chat. */
export const importedChatId = (source: string, externalId: string): string => `imported_${source}_${externalId.replace(/[^A-Za-z0-9_-]/g, '-')}`;

/**
 * ChatGPT conversations in DeepTutor's import shape: those without an id (DeepTutor skips them)
 * or seen already in the file left out; a missing title made from the first question.
 */
export function chatGptImportSessions(conversations: DtPlainConversation[]): DtImportSession[] {
  const seen = new Set<string>();
  const sessions: DtImportSession[] = [];
  for (const conversation of conversations) {
    const id = (conversation.id ?? '').slice(0, 256);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const question = conversation.messages.find((message) => message.role === 'user')?.text.replace(/\s+/g, ' ').trim() ?? '';
    const title = conversation.title.trim() || (question.length > 80 ? `${question.slice(0, 79)}…` : question);
    sessions.push({
      external_id: id,
      title,
      source_cwd: '',
      created_at: conversation.created,
      updated_at: Math.max(conversation.created, conversation.updated),
      messages: conversation.messages.map((message) => ({ role: message.role, content: message.text, ...(message.at ? { created_at: message.at } : {}) })),
    });
  }
  return sessions;
}

/** Batches small enough to send: at most 100 conversations, and about 4 MB, each. */
export function importBatches(sessions: DtImportSession[], maxCount = 100, maxBytes = 4_000_000): DtImportSession[][] {
  const batches: DtImportSession[][] = [];
  let batch: DtImportSession[] = [];
  let size = 0;
  for (const session of sessions) {
    const bytes = JSON.stringify(session).length;
    if (batch.length && (batch.length >= maxCount || size + bytes > maxBytes)) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(session);
    size += bytes;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export interface DtImportTotals {
  imported: number;
  /** Already there, empty, or refused. */
  skipped: number;
}

/** Sends one batch. */
export async function importChatHistory(client: DtClient, source: 'chatgpt' | 'claude_code' | 'codex', sessions: DtImportSession[]): Promise<DtImportTotals> {
  const body = record(await client.post<unknown>('/api/imports/chat-history', { source, sessions }, { timeoutMs: 120_000 }));
  return { imported: typeof body.imported === 'number' ? body.imported : 0, skipped: typeof body.skipped === 'number' ? body.skipped : 0 };
}
