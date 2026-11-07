import type { ChatListItem, ChatRecord } from './chats';
import type { OwuiClient } from './http';
import type { AccessGrant } from './workspaceModels';

/** `GET /api/v1/folders/` item (`FolderNameIdResponse`). Times are Unix seconds. */
export interface FolderItem {
  id: string;
  name: string;
  parent_id?: string | null;
  /** Remembered on the server, like the web app's open folders. */
  is_expanded?: boolean;
  unread_count?: number;
  meta?: { icon?: string | null; [key: string]: unknown } | null;
  created_at: number;
  updated_at: number;
  [key: string]: unknown;
}

export interface FolderNode extends FolderItem {
  children: FolderNode[];
}

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * A folder someone else shares with you, or one inside it (`GET /api/v1/folders/shared`): whose it
 * is, and what you may do in it (`write`: make chats and folders in it, edit and share it; `read`:
 * read its chats).
 */
export interface SharedFolder extends FolderItem {
  user_id: string;
  owner_name: string;
  permission: 'read' | 'write';
}

export async function listSharedFolders(client: OwuiClient): Promise<SharedFolder[]> {
  const raw = await client.get<unknown>('/api/v1/folders/shared');
  return (Array.isArray(raw) ? raw : []).flatMap((item) => {
    const row = record(item);
    if (!text(row.id) || typeof row.name !== 'string') return [];
    return [{ ...(row as unknown as FolderItem), user_id: text(row.user_id), owner_name: text(row.owner_name), permission: row.permission === 'write' ? ('write' as const) : ('read' as const) }];
  });
}

/** Your folders and the ones shared with you, in one list for the tree (one shared with you that's yours stays yours). */
export function withSharedFolders(own: FolderItem[], shared: SharedFolder[]): FolderItem[] {
  const mine = new Set(own.map((folder) => folder.id));
  return [...own, ...shared.filter((folder) => !mine.has(folder.id))];
}

/** A chat in a folder, as everyone who may see the folder sees it: whose it is, read only when it isn't yours. */
export interface FolderChat extends ChatListItem {
  user_id?: string;
  owner_name?: string;
  readonly?: boolean;
}

export interface FolderChatsPage {
  chats: FolderChat[];
  /** What you may do in the folder: make chats in it (`write`), or read them. */
  permission: 'read' | 'write';
  hasMore: boolean;
}

/**
 * A page (10) of a folder's chats, everyone's, as the web lists any folder's chats (so the owner
 * sees chats that people with write access made in it too), unread first, then newest.
 */
export async function listFolderChatsForAll(client: OwuiClient, folderId: string, page = 1): Promise<FolderChatsPage> {
  const body = record(await client.get<unknown>(`/api/v1/folders/${encodeURIComponent(folderId)}/shared/chats`, { query: { page } }));
  const chats = (Array.isArray(body.chats) ? body.chats : []).filter((chat): chat is FolderChat => Boolean(text(record(chat).id)));
  return { chats, permission: body.folder_permission === 'write' ? 'write' : 'read', hasMore: body.has_more === true };
}

export function listFolders(client: OwuiClient): Promise<FolderItem[]> {
  return client.get<FolderItem[]>('/api/v1/folders/');
}

export function setFolderExpanded(client: OwuiClient, id: string, expanded: boolean): Promise<unknown> {
  return client.post<unknown>(`/api/v1/folders/${encodeURIComponent(id)}/update/expanded`, { is_expanded: expanded });
}

/** How the folder looks. */
export interface FolderMeta {
  /** The folder's icon: an emoji's short name (`grinning`), as the web's picker saves it; '' for none. */
  icon?: string | null;
  /** A picture behind the folder's page: a data URL, or null for none. */
  background_image_url?: string | null;
  [key: string]: unknown;
}

/** What every chat in the folder gets. The server adds the system prompt and the knowledge itself. */
export interface FolderData {
  system_prompt?: string;
  /** Knowledge bases and files, kept as a model keeps its knowledge. */
  files?: unknown[];
  /** The models a new chat in the folder starts with. */
  model_ids?: string[];
  /** 0.12: a line under the folder's name. */
  description?: string;
  [key: string]: unknown;
}

/** `GET /api/v1/folders/{id}`: the folder with its settings, and the people and groups it's shared with. */
export interface FolderDetail {
  id: string;
  name: string;
  parent_id?: string | null;
  user_id?: string;
  meta?: FolderMeta | null;
  data?: FolderData | null;
  access_grants?: AccessGrant[];
  is_expanded?: boolean;
  created_at: number;
  updated_at: number;
  [key: string]: unknown;
}

const folderPath = (id: string) => `/api/v1/folders/${encodeURIComponent(id)}`;

export function getFolder(client: OwuiClient, id: string): Promise<FolderDetail> {
  return client.get<FolderDetail>(folderPath(id));
}

/** A new folder, at the top or inside `parentId`. The server refuses a name the folders beside it already use. */
export function createFolder(client: OwuiClient, input: { name: string; parentId?: string | null; data?: FolderData; meta?: FolderMeta }): Promise<FolderDetail> {
  return client.post<FolderDetail>('/api/v1/folders/', {
    name: input.name,
    parent_id: input.parentId ?? null,
    ...(input.data ? { data: input.data } : {}),
    ...(input.meta ? { meta: input.meta } : {}),
  });
}

/** Renames the folder or changes its settings. The server merges `data` and `meta` key by key, so keys left out stay as they are. */
export function updateFolder(client: OwuiClient, id: string, change: { name?: string; data?: FolderData; meta?: FolderMeta }): Promise<FolderDetail> {
  return client.post<FolderDetail>(`${folderPath(id)}/update`, change);
}

/**
 * Deletes the folder and the folders inside it. With `deleteContents` their chats go too;
 * without, the chats move out of the folder. Either way the server refuses when the folder
 * holds chats and the account may not delete chats.
 */
export function deleteFolder(client: OwuiClient, id: string, { deleteContents }: { deleteContents: boolean }): Promise<unknown> {
  return client.delete<unknown>(folderPath(id), { query: { delete_contents: deleteContents } });
}

/** Marks every chat in the folder, and in the folders inside it, as read. */
export function markFolderRead(client: OwuiClient, id: string): Promise<unknown> {
  return client.post<unknown>(`${folderPath(id)}/read`, {});
}

/** Every chat in the folder and the folders inside it, whole, as the web's Export saves them. */
export function folderChatsForExport(client: OwuiClient, id: string): Promise<ChatRecord[]> {
  return client.get<ChatRecord[]>(`/api/v1/chats/folder/${encodeURIComponent(id)}`);
}

/** The export file's name, as the web names it (`folder-<name>-export.json`; the web adds the time). */
export function folderExportName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'folder';
  return `folder-${safe}-export.json`;
}

/** Nests folders by `parent_id`, sorted by name. Folders whose parent is missing become top-level. */
export function folderTree(folders: FolderItem[]): FolderNode[] {
  const nodes = new Map<string, FolderNode>(folders.map((folder) => [folder.id, { ...folder, children: [] }]));
  const roots: FolderNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  const byName = (a: FolderNode, b: FolderNode) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const sort = (list: FolderNode[]) => {
    list.sort(byName);
    for (const node of list) sort(node.children);
  };
  sort(roots);
  return roots;
}
