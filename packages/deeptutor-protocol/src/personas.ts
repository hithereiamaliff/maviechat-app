import type { DtClient } from './http';

/*
 * Personas (DeepTutor 1.7.1): voices a chat can answer in, each a Markdown file with a name and a
 * one-line description. They're the account's, the same in every workspace. Besides your own,
 * you see the admin's as presets (read-only); one of yours with the same name takes its place.
 * DeepTutor writes the file's header itself (name and description), so only the body is edited.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Names DeepTutor accepts for a persona or a skill: lowercase letters, digits and dashes, 64 at most. */
export const RESOURCE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A name as it's typed, made into one DeepTutor accepts, as its own pages do while you type. */
export function slugifyName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .slice(0, 64);
}

/** What's wrong with a name, or null. */
export function resourceNameProblem(name: string): string | null {
  if (!name) return 'Give it a name.';
  if (!RESOURCE_NAME_PATTERN.test(name)) return 'Lowercase letters, digits and dashes, starting with a letter or digit.';
  return null;
}

export interface DtPersona {
  name: string;
  description: string;
  /** The admin's, offered to everyone. */
  preset: boolean;
  readOnly: boolean;
}

export interface DtPersonaFile extends DtPersona {
  /** The whole file, header included. */
  content: string;
}

const personaPath = (name: string) => `/api/personas/${encodeURIComponent(name)}`;

function personaOf(raw: unknown): DtPersona | null {
  const row = record(raw);
  const name = text(row.name);
  if (!name) return null;
  return { name, description: text(row.description), preset: row.source === 'admin', readOnly: row.read_only === true };
}

function personaFrom(raw: unknown): DtPersona {
  const persona = personaOf(raw);
  if (!persona) throw new Error('DeepTutor did not describe the persona');
  return persona;
}

/** Yours (by name), then the presets you haven't replaced. */
export async function listPersonas(client: DtClient): Promise<DtPersona[]> {
  const body = record(await client.get<unknown>('/api/personas'));
  return list(body.personas).flatMap((row) => personaOf(row) ?? []);
}

export async function getPersona(client: DtClient, name: string): Promise<DtPersonaFile> {
  const raw = await client.get<unknown>(personaPath(name));
  return { ...personaFrom(raw), content: text(record(raw).content) };
}

/** A new persona of yours; `content` is its body (DeepTutor writes the header). */
export async function createPersona(client: DtClient, input: { name: string; description: string; content: string }): Promise<DtPersona> {
  return personaFrom(await client.post<unknown>('/api/personas', { name: input.name, description: input.description, content: input.content }));
}

/** Changes one of yours; a new name renames it. */
export async function updatePersona(client: DtClient, name: string, change: { description?: string; content?: string; renameTo?: string }): Promise<DtPersona> {
  const body: Tree = {};
  if (change.description !== undefined) body.description = change.description;
  if (change.content !== undefined) body.content = change.content;
  if (change.renameTo && change.renameTo !== name) body.rename_to = change.renameTo;
  return personaFrom((await client.send<unknown>('PUT', personaPath(name), { body })).data);
}

export async function deletePersona(client: DtClient, name: string): Promise<void> {
  await client.delete<unknown>(personaPath(name));
}
