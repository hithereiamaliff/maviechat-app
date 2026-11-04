import type { OwuiClient } from './http';
import type { ValvesSpec } from './valves';

/*
 * Admin → Functions (Open WebUI 0.11.3, when plugins are on): Python on the server that adds
 * models (pipes), changes messages on the way in or out (filters), adds buttons to replies
 * (actions) or reacts to events. Saving one runs it (and may install packages), so the app
 * switches, shares settings, shows code, exports and deletes; writing code stays on the web.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const ms = (value: unknown): number => (typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : 0);
const idPath = (id: string) => `/api/v1/functions/id/${encodeURIComponent(id)}`;

export type FunctionType = 'pipe' | 'filter' | 'action' | 'event' | string;

export interface AdminFunction {
  id: string;
  name: string;
  type: FunctionType;
  description: string;
  author: string;
  version: string;
  fundingUrl: string;
  isActive: boolean;
  /** A filter or action that applies to every model. */
  isGlobal: boolean;
  /** Its Python (when read one by one). */
  content: string | null;
  updatedAt: number;
}

function functionOf(raw: unknown): AdminFunction | null {
  const row = record(raw);
  const id = text(row.id);
  if (!id) return null;
  const meta = record(row.meta);
  const manifest = record(meta.manifest);
  return {
    id,
    name: text(row.name) || id,
    type: text(row.type) || 'pipe',
    description: text(meta.description),
    author: text(manifest.author),
    version: text(manifest.version),
    fundingUrl: text(manifest.funding_url),
    isActive: row.is_active === true,
    isGlobal: row.is_global === true,
    content: typeof row.content === 'string' ? row.content : null,
    updatedAt: ms(row.updated_at),
  };
}

function functionFrom(raw: unknown): AdminFunction {
  const fn = functionOf(raw);
  if (!fn) throw new Error('Open WebUI did not describe the function');
  return fn;
}

export async function listAdminFunctions(client: OwuiClient): Promise<AdminFunction[]> {
  return list(await client.get<unknown>('/api/v1/functions/list')).flatMap((row) => functionOf(row) ?? []);
}

/** One function with its code (not found answers 401). */
export async function getAdminFunction(client: OwuiClient, id: string): Promise<AdminFunction> {
  return functionFrom(await client.get<unknown>(idPath(id)));
}

/** On or off: read first, flipped only if needed (a flip isn't the same twice). */
export async function setFunctionActive(client: OwuiClient, id: string, on: boolean): Promise<void> {
  if ((await getAdminFunction(client, id)).isActive !== on) await client.post<unknown>(`${idPath(id)}/toggle`);
}

/** A filter or action for every model, or only those it's chosen for: read first, flipped only if needed. */
export async function setFunctionGlobal(client: OwuiClient, id: string, global: boolean): Promise<void> {
  if ((await getAdminFunction(client, id)).isGlobal !== global) await client.post<unknown>(`${idPath(id)}/toggle/global`);
}

export async function deleteAdminFunction(client: OwuiClient, id: string): Promise<void> {
  await client.delete<unknown>(`${idPath(id)}/delete`);
}

/** Every function with its code (its settings too, if asked: they may hold keys). */
export async function exportAdminFunctions(client: OwuiClient, { valves = false }: { valves?: boolean } = {}): Promise<unknown[]> {
  return list(await client.get<unknown>('/api/v1/functions/export', { query: { include_valves: valves } }));
}

/**
 * A new function from its code. **The server runs it to save it** (and installs its
 * requirements): the app doesn't offer this; probes use it on the scratch instance only.
 */
export async function createAdminFunction(client: OwuiClient, input: { id: string; name: string; description: string; content: string }): Promise<AdminFunction> {
  return functionFrom(await client.post<unknown>('/api/v1/functions/create', { id: input.id, name: input.name, content: input.content, meta: { description: input.description } }));
}

// --- Shared settings ("valves") of a tool or a function: everyone who uses it shares them. ---

export type ValvesOf = 'tools' | 'functions';
const valvesPath = (kind: ValvesOf, id: string) => `/api/v1/${kind}/id/${encodeURIComponent(id)}/valves`;

/** The settings form (a JSON schema), or null when there are none. Reading it loads the code on the server. */
export function getSharedValvesSpec(client: OwuiClient, kind: ValvesOf, id: string): Promise<ValvesSpec | null> {
  return client.get<ValvesSpec | null>(`${valvesPath(kind, id)}/spec`);
}

/** The values set (one left out uses the default). */
export async function getSharedValves(client: OwuiClient, kind: ValvesOf, id: string): Promise<Tree> {
  return record(await client.get<unknown>(valvesPath(kind, id)));
}

/**
 * Saves the settings everyone shares. A value at its default is left out (the stored settings
 * become exactly the keys sent), never sent as null.
 */
export async function updateSharedValves(client: OwuiClient, kind: ValvesOf, id: string, values: Tree): Promise<Tree> {
  const kept = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null && value !== undefined));
  return record(await client.post<unknown>(`${valvesPath(kind, id)}/update`, kept));
}

export const FUNCTION_TYPE_LABELS: Record<string, string> = { pipe: 'Pipe', filter: 'Filter', action: 'Action', event: 'Event' };
