import type { OwuiClient } from './http';
import type { ServerConfig } from './server';
import type { UserSettings } from './models';

/*
 * Memories (Open WebUI 0.11.3, Settings → Personalization): things you've asked models to remember
 * about you, given to them with each chat while your Memory switch is on. Each has a type (about
 * you, or background for future chats) and an optional path that groups related ones. The server
 * answers 404 on every route when the admin turned memories off, and 403 to an account without
 * the `features.memories` permission.
 */

export type MemoryType = 'user' | 'context';

export interface Memory {
  id: string;
  type: MemoryType;
  /** Groups related memories, like `work/projects`; null when it has none. */
  path: string | null;
  content: string;
  /** Unix seconds. */
  updated_at: number;
  created_at: number;
  [key: string]: unknown;
}

export interface MemoryInput {
  content: string;
  type: MemoryType;
  /** Empty clears the path. */
  path: string;
}

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const seconds = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

function memoryOf(raw: unknown): Memory {
  const row = record(raw);
  return {
    ...row,
    id: typeof row.id === 'string' ? row.id : '',
    type: row.type === 'user' ? 'user' : 'context',
    path: typeof row.path === 'string' && row.path ? row.path : null,
    content: typeof row.content === 'string' ? row.content : '',
    updated_at: seconds(row.updated_at),
    created_at: seconds(row.created_at),
  };
}

/** Newest change first, as the web lists them. */
export async function listMemories(client: OwuiClient): Promise<Memory[]> {
  const raw = await client.get<unknown>('/api/v1/memories/');
  return (Array.isArray(raw) ? raw.map(memoryOf) : []).filter((memory) => memory.id).sort((a, b) => b.updated_at - a.updated_at);
}

export async function addMemory(client: OwuiClient, input: MemoryInput): Promise<Memory> {
  return memoryOf(await client.post<unknown>('/api/v1/memories/add', { content: input.content.trim(), type: input.type, path: input.path.trim() || null }));
}

/** An empty path removes the memory's path (the server reads "" as "none"). */
export async function updateMemory(client: OwuiClient, id: string, input: MemoryInput): Promise<Memory> {
  return memoryOf(await client.post<unknown>(`/api/v1/memories/${encodeURIComponent(id)}/update`, { content: input.content.trim(), type: input.type, path: input.path.trim() }));
}

export function deleteMemory(client: OwuiClient, id: string): Promise<boolean> {
  return client.delete<boolean>(`/api/v1/memories/${encodeURIComponent(id)}`);
}

/** Every memory of yours, gone. */
export function clearMemories(client: OwuiClient): Promise<boolean> {
  return client.delete<boolean>('/api/v1/memories/delete/user');
}

/**
 * A path as the server stores it: slashes at the ends dropped and runs of them made one; an empty
 * path is none. A part that is `.` or `..`, or a control character, is refused (the server answers
 * 400), so `error` says why before saving.
 */
export function cleanMemoryPath(input: string): { path: string | null; error?: undefined } | { path?: undefined; error: string } {
  const value = input.trim().replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
  if (!value) return { path: null };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(value) || value.split('/').some((part) => part === '.' || part === '..')) return { error: 'A path can’t have “.” or “..” as a part, or control characters.' };
  return { path: value };
}

/** Memories whose words, path or type contain the search (the web's own search box). */
export function filterMemories(memories: Memory[], query: string): Memory[] {
  const wanted = query.trim().toLowerCase().slice(0, 500);
  if (!wanted) return memories;
  return memories.filter((memory) => [memory.content, memory.path ?? '', memory.type].some((field) => field.toLowerCase().includes(wanted)));
}

/** Your Memory switch: what you saved, else on whenever the admin has memories on (as the web reads it). */
export function memoryOn(ui: UserSettings['ui'], config: ServerConfig | undefined): boolean {
  const saved = ui?.memory;
  if (typeof saved === 'boolean') return saved;
  return config?.features?.enable_memories === true;
}
