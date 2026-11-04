import { isChatGptExport, readChatGptExport, type PlainConversation } from './chatgpt';
import type { ChatDocument, ChatRecord } from './chats';
import type { HistoryMessage } from './history';
import type { OwuiClient } from './http';
import { uuidv4 } from './ids';

/*
 * Settings → Data Controls (Open WebUI 0.11.3): your chats out as one JSON file, and chats in from
 * such a file or from ChatGPT's export.
 */

type Tree = Record<string, unknown>;
const isTree = (value: unknown): value is Tree => typeof value === 'object' && value !== null && !Array.isArray(value);
const whole = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null);

// ── Export ───────────────────────────────────────────────────────────────────

/** Lines of JSON (one chat each) as one JSON array; a line that isn't JSON is left out. An array is taken as it is. */
export function jsonLinesToArray(body: string): { json: string; count: number } {
  const trimmed = body.trim();
  if (trimmed.startsWith('[')) {
    const list: unknown = JSON.parse(trimmed);
    return { json: trimmed, count: Array.isArray(list) ? list.length : 0 };
  }
  const lines: string[] = [];
  for (const raw of trimmed.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      if (isTree(JSON.parse(line))) lines.push(line);
    } catch {
      // a broken line: left out
    }
  }
  return { json: `[${lines.join(',')}]`, count: lines.length };
}

/** Every chat of yours, archived ones too, as the web's export file (the server sends one chat per line). */
export async function exportAllChats(client: OwuiClient): Promise<{ json: string; count: number }> {
  const body = await client.getText('/api/v1/chats/all', { headers: { Accept: 'application/x-ndjson' }, timeoutMs: 300_000 });
  return jsonLinesToArray(body);
}

/** Your archived chats, in the same format (so they can be imported again). */
export async function exportArchivedChats(client: OwuiClient): Promise<{ json: string; count: number }> {
  const list = await client.get<unknown>('/api/v1/chats/all/archived', { timeoutMs: 300_000 });
  const chats = Array.isArray(list) ? list : [];
  return { json: JSON.stringify(chats), count: chats.length };
}

/** The web's names for the files: `chat-export-<ms>.json`, `archived-chat-export-<ms>.json`. */
export function exportFileNameAt(kind: 'all' | 'archived', nowMs: number): string {
  return `${kind === 'archived' ? 'archived-chat-export' : 'chat-export'}-${nowMs}.json`;
}

// ── Import ───────────────────────────────────────────────────────────────────

/** One chat as `POST /api/v1/chats/import` takes it. The server gives it a new id. */
export interface ImportChat {
  chat: ChatDocument;
  meta: Tree;
  pinned: boolean;
  folder_id: string | null;
  variables?: Tree;
  created_at: number | null;
  updated_at: number | null;
}

export interface ImportPlan {
  from: 'chatgpt' | 'open-webui';
  chats: ImportChat[];
  /** Entries left out: not chats, or with nothing to keep. */
  skipped: number;
}

export class ImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportFileError';
  }
}

/** The model the web gives a ChatGPT conversation whose export names none. */
export const CHATGPT_FALLBACK_MODEL = 'gpt-3.5-turbo';

/** A ChatGPT conversation as an Open WebUI chat: one thread, each reply under the message before it. */
export function chatFromConversation(conversation: PlainConversation): ImportChat {
  const model = conversation.model ?? CHATGPT_FALLBACK_MODEL;
  const messages: Record<string, HistoryMessage> = {};
  let parentId: string | null = null;
  for (const said of conversation.messages) {
    const id = uuidv4();
    messages[id] = {
      id,
      parentId,
      childrenIds: [],
      role: said.role,
      content: said.text,
      timestamp: Math.floor(said.at ?? conversation.created),
      ...(said.role === 'assistant' ? { model: said.model ?? model, done: true } : { models: [model] }),
    };
    if (parentId) messages[parentId]?.childrenIds.push(id);
    parentId = id;
  }
  return {
    chat: { title: conversation.title || 'New Chat', models: [model], params: {}, history: { messages, currentId: parentId }, tags: [], timestamp: Math.floor(conversation.created * 1000) },
    meta: {},
    pinned: false,
    folder_id: null,
    created_at: Math.floor(conversation.created),
    updated_at: Math.floor(conversation.updated),
  };
}

/** An Open WebUI file's entries: export records (a `chat` inside), or bare chats as older exports had them. */
function openWebUiChats(list: unknown[]): ImportPlan {
  const chats: ImportChat[] = [];
  let skipped = 0;
  for (const item of list) {
    if (isTree(item) && isTree(item.chat)) {
      chats.push({
        chat: item.chat as ChatDocument,
        meta: isTree(item.meta) ? item.meta : {},
        pinned: false,
        folder_id: typeof item.folder_id === 'string' && item.folder_id ? item.folder_id : null,
        ...(isTree(item.variables) ? { variables: item.variables } : {}),
        created_at: whole(item.created_at),
        updated_at: whole(item.updated_at),
      });
    } else if (isTree(item) && (isTree(item.history) || Array.isArray(item.messages))) {
      chats.push({ chat: item as ChatDocument, meta: {}, pinned: false, folder_id: null, created_at: null, updated_at: null });
    } else {
      skipped += 1;
    }
  }
  return { from: 'open-webui', chats, skipped };
}

/**
 * What a file holds to import: ChatGPT's `conversations.json`, or an Open WebUI export (all chats,
 * archived ones, or one downloaded chat). Throws `ImportFileError` when it's neither.
 */
export function readImportFile(body: string, nowSeconds = Date.now() / 1000): ImportPlan {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new ImportFileError('This file isn’t JSON. Choose a chat export (.json).');
  }
  const list = Array.isArray(data) ? data : isTree(data) ? [data] : [];
  if (isChatGptExport(list)) {
    const read = readChatGptExport(list, nowSeconds);
    if (!read.conversations.length) throw new ImportFileError('None of the conversations in this file has messages to import.');
    return { from: 'chatgpt', chats: read.conversations.map(chatFromConversation), skipped: read.skipped };
  }
  const plan = openWebUiChats(list);
  if (!plan.chats.length) throw new ImportFileError('There are no chats in this file to import.');
  return plan;
}

/** Chats per request: the server checks and stores each request whole. */
export const IMPORT_BATCH = 25;

/**
 * Imports the chats a batch at a time, reporting each step, and answers with the new chats; the
 * server answers 403 without the `chat.import` permission. A failed batch stops the import:
 * earlier batches stay imported.
 */
export async function importChats(client: OwuiClient, chats: ImportChat[], onProgress?: (done: number, total: number) => void): Promise<ChatRecord[]> {
  const made: ChatRecord[] = [];
  for (let at = 0; at < chats.length; at += IMPORT_BATCH) {
    const batch = chats.slice(at, at + IMPORT_BATCH);
    const answer = await client.post<unknown>('/api/v1/chats/import', { chats: batch }, { timeoutMs: 120_000 });
    if (Array.isArray(answer)) made.push(...(answer as ChatRecord[]));
    onProgress?.(Math.min(at + batch.length, chats.length), chats.length);
  }
  return made;
}
