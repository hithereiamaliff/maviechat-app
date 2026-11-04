import type { OwuiClient } from './http';
import { grantsOf, listParams, type AccessGrant, type WorkspaceListQuery } from './workspaceModels';

/*
 * Workspace knowledge (Open WebUI 0.11.3): collections of documents that models search. A
 * collection holds files in folders; each upload is read and embedded by the server in the
 * background, then linked to the collection. Connected ("external") collections are made by
 * admins, searched at their source, and can't take files or folders.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const ms = (value: unknown): number => (typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : 0);
const base = '/api/v1/knowledge';
const kbPath = (id: string) => `${base}/${encodeURIComponent(id)}`;

export interface WorkspaceKnowledge {
  id: string;
  name: string;
  description: string;
  meta: Tree;
  /** Connected to an outside source by an admin: read-only here, searched there. */
  external: boolean;
  /** For a connected one, what it's connected to. */
  provider: string;
  /** In lists only. */
  fileCount: number | null;
  accessGrants: AccessGrant[];
  ownerName: string;
  writeAccess: boolean;
  updatedAt: number;
}

function knowledgeOf(raw: unknown): WorkspaceKnowledge | null {
  const row = record(raw);
  const id = text(row.id);
  if (!id) return null;
  const meta = record(row.meta);
  const user = record(row.user);
  return {
    id,
    name: text(row.name) || id,
    description: text(row.description),
    meta,
    external: meta.source === 'external',
    provider: text(record(meta.external).provider),
    fileCount: typeof row.file_count === 'number' ? row.file_count : null,
    accessGrants: grantsOf(row.access_grants),
    ownerName: text(user.name) || text(user.email),
    writeAccess: row.write_access === true,
    updatedAt: ms(row.updated_at),
  };
}

function knowledgeFrom(raw: unknown): WorkspaceKnowledge {
  const knowledge = knowledgeOf(raw);
  if (!knowledge) throw new Error('Open WebUI did not describe the knowledge base');
  return knowledge;
}

/** One page (30) of the collections you can read: search, whose, order; `source` local or connected only. */
export async function listWorkspaceKnowledge(client: OwuiClient, query: Omit<WorkspaceListQuery, 'tag'> & { source?: 'local' | 'external' } = {}): Promise<{ items: WorkspaceKnowledge[]; total: number }> {
  const params = listParams(query);
  if (query.source) params.source = query.source;
  const body = record(await client.get<unknown>(`${base}/search`, { query: params }));
  return { items: list(body.items).flatMap((row) => knowledgeOf(row) ?? []), total: typeof body.total === 'number' ? body.total : 0 };
}

export async function getWorkspaceKnowledge(client: OwuiClient, id: string): Promise<WorkspaceKnowledge> {
  return knowledgeFrom(await client.get<unknown>(kbPath(id)));
}

/** A new collection, private unless grants are given (the server embeds its name and description for search). */
export async function createWorkspaceKnowledge(client: OwuiClient, input: { name: string; description: string; accessGrants?: AccessGrant[] }): Promise<WorkspaceKnowledge> {
  return knowledgeFrom(await client.post<unknown>(`${base}/create`, { name: input.name.trim(), description: input.description.trim(), access_grants: input.accessGrants ?? [] }));
}

/** Name and description; sharing is left out, so it stays as it is. */
export async function updateWorkspaceKnowledge(client: OwuiClient, id: string, change: { name: string; description: string }): Promise<WorkspaceKnowledge> {
  return knowledgeFrom(await client.post<unknown>(`${kbPath(id)}/update`, { name: change.name.trim(), description: change.description.trim() }));
}

/** Deletes the collection: it leaves every model that used it; its search data goes. */
export async function deleteWorkspaceKnowledge(client: OwuiClient, id: string): Promise<void> {
  await client.delete<unknown>(`${kbPath(id)}/delete`);
}

/** Empties it: every file out (yours deleted, unless the server keeps files) and every folder gone. */
export async function resetWorkspaceKnowledge(client: OwuiClient, id: string): Promise<WorkspaceKnowledge> {
  return knowledgeFrom(await client.post<unknown>(`${kbPath(id)}/reset`, undefined, { query: { include_directories: true } }));
}

export interface KnowledgeFolder {
  id: string;
  name: string;
  parentId: string | null;
  updatedAt: number;
}

export interface KnowledgeFile {
  id: string;
  name: string;
  size: number | null;
  contentType: string;
  ownerName: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
}

const folderOf = (raw: unknown): KnowledgeFolder | null => {
  const row = record(raw);
  const id = text(row.id);
  return id ? { id, name: text(row.name) || id, parentId: text(row.parent_id) || null, updatedAt: ms(row.updated_at) } : null;
};

function knowledgeFileOf(raw: unknown): KnowledgeFile | null {
  const row = record(raw);
  const id = text(row.id);
  if (!id) return null;
  const meta = record(row.meta);
  const user = record(row.user);
  return {
    id,
    name: text(meta.name) || text(row.filename) || id,
    size: typeof meta.size === 'number' ? meta.size : null,
    contentType: text(meta.content_type),
    ownerName: text(user.name) || text(user.email),
    ownerId: text(row.user_id),
    createdAt: ms(row.created_at),
    updatedAt: ms(row.updated_at) || ms(row.created_at),
  };
}

export interface KnowledgeFilesQuery {
  /** Searches names; with `inText`, the files' text too (slow on the server). */
  query?: string;
  inText?: boolean;
  /** Whose files: '' all, `created` ones you added, `shared` others'. */
  view?: '' | 'created' | 'shared';
  orderBy?: 'name' | 'created_at' | 'updated_at';
  direction?: 'asc' | 'desc';
  /** null: the top level. */
  folderId?: string | null;
  /** From 1, 30 a page. */
  page?: number;
}

export interface KnowledgeFilesPage {
  files: KnowledgeFile[];
  /** The folders in this one (on every page). */
  folders: KnowledgeFolder[];
  /** From the top down to this folder. */
  path: KnowledgeFolder[];
  total: number;
}

/** One folder's files (30 a page), its folders, and the way down to it. */
export async function listKnowledgeFiles(client: OwuiClient, id: string, query: KnowledgeFilesQuery = {}): Promise<KnowledgeFilesPage> {
  const params: Record<string, string | number | boolean> = { page: query.page ?? 1, directory_id: query.folderId ?? '', order_by: query.orderBy ?? 'updated_at', direction: query.direction ?? 'desc' };
  if (query.query?.trim()) params.query = query.query.trim();
  if (query.inText && query.query?.trim()) params.include_content = true;
  if (query.view) params.view_option = query.view;
  const body = record(await client.get<unknown>(`${kbPath(id)}/files`, { query: params }));
  return {
    files: list(body.items).flatMap((row) => knowledgeFileOf(row) ?? []),
    folders: list(body.directories).flatMap((row) => folderOf(row) ?? []),
    path: list(body.breadcrumbs).flatMap((row) => folderOf(row) ?? []),
    total: typeof body.total === 'number' ? body.total : 0,
  };
}

export interface PendingKnowledgeFile {
  id: string;
  name: string;
  status: string;
  /** The folder it goes into (null: the top level). */
  folderId: string | null;
}

/** Uploads the server is still reading or embedding for this collection (not yet in its list). */
export async function pendingKnowledgeFiles(client: OwuiClient, id: string): Promise<PendingKnowledgeFile[]> {
  return list(await client.get<unknown>(`${kbPath(id)}/files/pending`)).flatMap((raw) => {
    const row = record(raw);
    const fileId = text(row.id);
    const meta = record(row.meta);
    // The upload's own form fields are kept under meta.data, the folder among them.
    return fileId ? [{ id: fileId, name: text(meta.name) || text(row.filename) || fileId, status: text(record(row.data).status) || 'pending', folderId: text(record(meta.data).directory_id) || null }] : [];
  });
}

/** Links a file that's already read (yours, or one you can read) into the collection. */
export async function addFileToKnowledge(client: OwuiClient, id: string, fileId: string, folderId: string | null = null): Promise<void> {
  await client.post<unknown>(`${kbPath(id)}/file/add`, { file_id: fileId, directory_id: folderId });
}

/**
 * Takes a file out of the collection and its search data. Unless `deleteFile` is false (or the
 * server keeps files), the file itself is deleted too when it's yours (or you're an admin).
 */
export async function removeKnowledgeFile(client: OwuiClient, id: string, fileId: string, { deleteFile }: { deleteFile?: boolean } = {}): Promise<void> {
  await client.post<unknown>(`${kbPath(id)}/file/remove`, { file_id: fileId }, deleteFile === undefined ? {} : { query: { delete_file: deleteFile } });
}

/** Moves a file to another folder (null: the top level). */
export async function moveKnowledgeFile(client: OwuiClient, id: string, fileId: string, folderId: string | null): Promise<void> {
  await client.post<unknown>(`${kbPath(id)}/file/move`, { file_id: fileId, directory_id: folderId });
}

/** A new folder (400 when one of that name is there already). */
export async function createKnowledgeFolder(client: OwuiClient, id: string, name: string, parentId: string | null): Promise<KnowledgeFolder> {
  const folder = folderOf(await client.post<unknown>(`${kbPath(id)}/dirs/create`, { name: name.trim(), parent_id: parentId }));
  if (!folder) throw new Error('Open WebUI did not describe the folder');
  return folder;
}

/** Renames a folder, or moves it (`parentId` null: to the top; left out: where it is). 400 on a clash or a move into itself. */
export async function updateKnowledgeFolder(client: OwuiClient, id: string, folderId: string, change: { name?: string; parentId?: string | null }): Promise<KnowledgeFolder> {
  const body: Tree = {};
  if (change.name !== undefined) body.name = change.name.trim();
  if (change.parentId !== undefined) body.parent_id = change.parentId;
  const folder = folderOf(await client.post<unknown>(`${kbPath(id)}/dirs/${encodeURIComponent(folderId)}/update`, body));
  if (!folder) throw new Error('Open WebUI did not describe the folder');
  return folder;
}

/** Deletes a folder: what's in it moves up a level, or (with `moveFiles` false) is deleted with it. */
export async function deleteKnowledgeFolder(client: OwuiClient, id: string, folderId: string, { moveFiles }: { moveFiles: boolean }): Promise<void> {
  await client.delete<unknown>(`${kbPath(id)}/dirs/${encodeURIComponent(folderId)}/delete`, { query: { move_files: moveFiles } });
}

/** The form fields of an upload into a collection (the file part is added by the caller): read and linked in the background. */
export function knowledgeUploadMetadata(id: string, folderId: string | null, sourceUrl?: string): string {
  return JSON.stringify({ knowledge_id: id, ...(folderId ? { directory_id: folderId } : {}), ...(sourceUrl ? { source_url: sourceUrl } : {}) });
}

/** A file's text as the server read it, and how reading it went. */
export interface FileText {
  id: string;
  name: string;
  content: string;
  status: string;
  error: string;
}

export async function getFileText(client: OwuiClient, fileId: string): Promise<FileText> {
  const row = record(await client.get<unknown>(`/api/v1/files/${encodeURIComponent(fileId)}`));
  const data = record(row.data);
  return { id: text(row.id) || fileId, name: text(record(row.meta).name) || text(row.filename), content: text(data.content), status: text(data.status), error: text(data.error) };
}

/** New text for a file: read again and embedded again into every collection that has it. */
export async function updateFileText(client: OwuiClient, fileId: string, content: string): Promise<void> {
  await client.post<unknown>(`/api/v1/files/${encodeURIComponent(fileId)}/data/content/update`, { content });
}

export async function renameFile(client: OwuiClient, fileId: string, filename: string): Promise<void> {
  await client.post<unknown>(`/api/v1/files/${encodeURIComponent(fileId)}/rename`, { filename: filename.trim() });
}

/** What the server fetched from a web address: a page's text, or a file it stored (already read). */
export type FetchedUrl = { kind: 'page'; name: string; url: string; content: string } | { kind: 'file'; name: string; url: string; fileId: string };

/** The server fetches a web address (a page, a YouTube video's captions, or a file), as the web's "Add web page" does. */
export async function fetchUrl(client: OwuiClient, url: string): Promise<FetchedUrl> {
  const row = record(await client.post<unknown>('/api/v1/retrieval/process/url', { url }, { timeoutMs: 120_000 }));
  const type = text(row.type);
  const name = text(row.name) || url;
  if (type === 'file' || type === 'image') {
    const fileId = text(record(row.file).id);
    if (!fileId) throw new Error('the server stored nothing for it');
    return { kind: 'file', name, url, fileId };
  }
  const content = text(row.content);
  if (!content.trim()) throw new Error('the page had no text');
  return { kind: 'page', name, url, content };
}

/** Web addresses from text, one a line: http(s) only, each once. */
export function urlsFromText(input: string): { urls: string[]; refused: string[] } {
  const urls: string[] = [];
  const refused: string[] = [];
  for (const line of input.split(/\s+/)) {
    const value = line.trim();
    if (!value) continue;
    let ok = false;
    try {
      const parsed = new URL(value);
      ok = (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname);
    } catch {
      ok = false;
    }
    if (!ok) refused.push(value);
    else if (!urls.includes(value)) urls.push(value);
  }
  return { urls, refused };
}

/** A page's file name, as the web names them: the address without its scheme, made safe, 50 characters at most. */
export function urlFileName(url: string): string {
  const slug = url
    .replace(/^https?:\/\//i, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '');
  return `${slug || 'page'}.txt`;
}

/** A name for text added by hand, as a `.txt` file (`.txt` added unless it's there). */
export const textFileName = (name: string): string => {
  const clean = name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim() || 'text';
  return /\.txt$/i.test(clean) ? clean : `${clean}.txt`;
};
