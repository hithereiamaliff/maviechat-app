import type { OwuiClient } from './http';

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

export function listFolders(client: OwuiClient): Promise<FolderItem[]> {
  return client.get<FolderItem[]>('/api/v1/folders/');
}

export function setFolderExpanded(client: OwuiClient, id: string, expanded: boolean): Promise<unknown> {
  return client.post<unknown>(`/api/v1/folders/${encodeURIComponent(id)}/update/expanded`, { is_expanded: expanded });
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
