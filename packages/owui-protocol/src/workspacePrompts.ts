import type { OwuiClient } from './http';
import { grantsOf, listParams, tagNames, type AccessGrant, type WorkspaceListQuery } from './workspaceModels';

/*
 * Workspace prompts (Open WebUI 0.11.3): text you insert with `/command`, with variables filled in
 * as it goes in. A command is unique across the whole server (400 when taken, even by a prompt you
 * can't see). Each save of the text keeps a version; one version is live (what `/` inserts), and
 * an older one can be made live again. Name, command and tags change without a new version.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const ms = (value: unknown): number => (typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : 0);
const base = '/api/v1/prompts';
const idPath = (id: string) => `${base}/id/${encodeURIComponent(id)}`;

export interface WorkspacePrompt {
  id: string;
  /** Without the slash. */
  command: string;
  name: string;
  content: string;
  tags: string[];
  data: Tree | null;
  meta: Tree | null;
  isActive: boolean;
  versionId: string;
  accessGrants: AccessGrant[];
  ownerName: string;
  writeAccess: boolean;
  updatedAt: number;
}

function promptOf(raw: unknown): WorkspacePrompt | null {
  const row = record(raw);
  const id = text(row.id);
  const command = text(row.command).replace(/^\//, '');
  if (!id && !command) return null;
  const user = record(row.user);
  return {
    id: id || command,
    command,
    name: text(row.name) || command,
    content: text(row.content),
    tags: tagNames(row.tags),
    data: row.data && typeof row.data === 'object' ? record(row.data) : null,
    meta: row.meta && typeof row.meta === 'object' ? record(row.meta) : null,
    isActive: row.is_active !== false,
    versionId: text(row.version_id),
    accessGrants: grantsOf(row.access_grants),
    ownerName: text(user.name) || text(user.email),
    writeAccess: row.write_access === true,
    updatedAt: ms(row.updated_at),
  };
}

function promptFrom(raw: unknown): WorkspacePrompt {
  const prompt = promptOf(raw);
  if (!prompt) throw new Error('Open WebUI did not describe the prompt');
  return prompt;
}

export async function listWorkspacePrompts(client: OwuiClient, query: WorkspaceListQuery = {}): Promise<{ items: WorkspacePrompt[]; total: number }> {
  const body = record(await client.get<unknown>(`${base}/list`, { query: listParams(query) }));
  return { items: list(body.items).flatMap((row) => promptOf(row) ?? []), total: typeof body.total === 'number' ? body.total : 0 };
}

export async function workspacePromptTags(client: OwuiClient): Promise<string[]> {
  return list(await client.get<unknown>(`${base}/tags`)).map(text).filter(Boolean);
}

export async function getWorkspacePrompt(client: OwuiClient, id: string): Promise<WorkspacePrompt> {
  return promptFrom(await client.get<unknown>(idPath(id)));
}

/** A command from a name, as the web makes one while you type: letters, digits, `-` and `_`. */
export const commandFromName = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/gi, '');

export function commandProblem(command: string): string | null {
  if (!command) return 'Give it a command.';
  if (!/^[A-Za-z0-9_-]+$/.test(command)) return 'Letters, digits, dashes and underscores only.';
  return null;
}

/** A new prompt (its first version, live); private unless grants are given. */
export async function createWorkspacePrompt(client: OwuiClient, input: { command: string; name: string; content: string; tags: string[]; accessGrants?: AccessGrant[] }): Promise<WorkspacePrompt> {
  return promptFrom(await client.post<unknown>(`${base}/create`, { command: input.command, name: input.name, content: input.content, tags: input.tags, access_grants: input.accessGrants ?? [], commit_message: 'Created' }));
}

/**
 * New text as a new version, live or not. Open WebUI 0.11.3 writes the new text into the prompt
 * either way (only the live version marker stays behind when it isn't live), so the app saves
 * not-live versions the way the web does and says what they do. Sharing isn't sent.
 */
export async function saveWorkspacePromptVersion(client: OwuiClient, prompt: WorkspacePrompt, change: { content: string; commitMessage: string; live: boolean }): Promise<WorkspacePrompt> {
  return promptFrom(
    await client.post<unknown>(`${idPath(prompt.id)}/update`, {
      command: prompt.command,
      name: prompt.name,
      content: change.content,
      data: prompt.data,
      meta: prompt.meta,
      tags: prompt.tags,
      commit_message: change.commitMessage.trim() || null,
      is_production: change.live,
    }),
  );
}

/** Name, command and tags, without a new version (400 when the command is taken). */
export async function updateWorkspacePromptMeta(client: OwuiClient, id: string, change: { name: string; command: string; tags: string[] }): Promise<WorkspacePrompt> {
  return promptFrom(await client.post<unknown>(`${idPath(id)}/update/meta`, { name: change.name, command: change.command, tags: change.tags }));
}

/** On or off for everyone (an off prompt leaves every `/` menu). */
export async function toggleWorkspacePrompt(client: OwuiClient, id: string): Promise<WorkspacePrompt> {
  return promptFrom(await client.post<unknown>(`${idPath(id)}/toggle`));
}

export async function deleteWorkspacePrompt(client: OwuiClient, id: string): Promise<void> {
  await client.delete<unknown>(`${idPath(id)}/delete`);
}

export interface PromptVersion {
  id: string;
  content: string;
  name: string;
  /** Its tags as saved with it. */
  tags: string[];
  commitMessage: string;
  /** Who saved it (empty when the server didn't say: a version read on its own). */
  author: string;
  createdAt: number;
}

/** A version as the server lists it, with what it saved (its snapshot); null without an id. */
function versionFrom(raw: unknown): PromptVersion | null {
  const row = record(raw);
  const versionId = text(row.id);
  if (!versionId) return null;
  const snapshot = record(row.snapshot);
  const user = record(row.user);
  const tags = list(snapshot.tags).map((tag) => (typeof tag === 'string' ? tag : text(record(tag).name))).filter(Boolean);
  return { id: versionId, content: text(snapshot.content), name: text(snapshot.name), tags, commitMessage: text(row.commit_message), author: text(user.name) || text(user.email), createdAt: ms(row.created_at) };
}

/** Versions, newest first (20 a page, from 0; versions saved in the same second keep the server's order). */
export async function listPromptVersions(client: OwuiClient, id: string, page = 0): Promise<PromptVersion[]> {
  const versions = list(await client.get<unknown>(`${idPath(id)}/history`, { query: { page } })).flatMap((raw) => versionFrom(raw) ?? []);
  return versions.map((version, index) => ({ version, index })).sort((a, b) => b.version.createdAt - a.version.createdAt || a.index - b.index).map((item) => item.version);
}

/** One version on its own (the live one, say, when it isn't among those listed so far). */
export async function getPromptVersion(client: OwuiClient, id: string, versionId: string): Promise<PromptVersion> {
  const version = versionFrom(await client.get<unknown>(`${idPath(id)}/history/${encodeURIComponent(versionId)}`));
  if (!version) throw new Error('The server didn’t send that version.');
  return version;
}

/** Makes an older version live again (its text, name and tags; the command and sharing stay). */
export async function makePromptVersionLive(client: OwuiClient, id: string, versionId: string): Promise<WorkspacePrompt> {
  return promptFrom(await client.post<unknown>(`${idPath(id)}/update/version`, { version_id: versionId }));
}

/** Deletes a version that isn't live (400 for the live one). */
export async function deletePromptVersion(client: OwuiClient, id: string, versionId: string): Promise<void> {
  await client.delete<unknown>(`${idPath(id)}/history/${encodeURIComponent(versionId)}`);
}

/** As the web exports prompts: a JSON list, written on the phone. */
export function promptsExport(prompts: WorkspacePrompt[]): string {
  return JSON.stringify(
    prompts.map((prompt) => ({ command: prompt.command, name: prompt.name, content: prompt.content, tags: prompt.tags })),
    null,
    2,
  );
}

/** What an import file gives for one prompt. */
export interface PromptImport {
  command: string;
  name: string;
  content: string;
  tags: string[];
}

/**
 * Prompts from an exported JSON file (the web's or the app's; one or a list), each to be made as
 * a new prompt the way the web imports them. Entries without a command or text are skipped.
 */
export function promptsFromImport(json: unknown): { prompts: PromptImport[]; skipped: number } {
  let skipped = 0;
  const prompts = (Array.isArray(json) ? json : [json]).flatMap((raw) => {
    const row = record(raw);
    const command = text(row.command).trim().replace(/^\//, '');
    const content = text(row.content);
    if (!command || !content.trim()) {
      skipped += 1;
      return [];
    }
    return [{ command, name: text(row.name).trim() || text(row.title).trim() || command, content, tags: tagNames(row.tags) }];
  });
  return { prompts, skipped };
}
