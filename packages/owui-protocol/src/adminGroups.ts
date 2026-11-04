import type { OwuiClient } from './http';

/*
 * Admin → Groups and permissions (Open WebUI 0.11.3). What a user may do is the default
 * permissions OR'd with every group they're in: a group can only add, never take away. New
 * groups start as a copy of today's defaults (as the web makes them). A group's stored tree is
 * sent back with only the admin's edits: keys it never had stay missing.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const ms = (value: unknown): number => (typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : 0);
const groupPath = (id: string) => `/api/v1/groups/id/${encodeURIComponent(id)}`;

/** A permission tree: section → key → on or off (a key may be missing). */
export type PermissionTree = Record<string, Record<string, boolean>>;

export type ShareWith = 'anyone' | 'members' | 'nobody';

export interface AdminGroup {
  id: string;
  name: string;
  description: string;
  /** null: the group grants nothing of its own. */
  permissions: PermissionTree | null;
  /** Kept as stored, sent back as stored. */
  data: Tree | null;
  /** Who may share things with the group. */
  shareWith: ShareWith;
  memberCount: number | null;
  createdAt: number;
  updatedAt: number;
}

export function permissionTreeOf(value: unknown): PermissionTree | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const tree: PermissionTree = {};
  for (const [section, keys] of Object.entries(value as Tree)) {
    const row = record(keys);
    tree[section] = Object.fromEntries(Object.entries(row).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
  }
  return tree;
}

const shareOf = (data: Tree | null): ShareWith => {
  const share = record(record(data).config).share;
  return share === true ? 'anyone' : share === false ? 'nobody' : 'members';
};

function groupOf(raw: unknown): AdminGroup | null {
  const row = record(raw);
  const id = text(row.id);
  if (!id) return null;
  const data = row.data && typeof row.data === 'object' ? record(row.data) : null;
  return {
    id,
    name: text(row.name) || id,
    description: text(row.description),
    permissions: permissionTreeOf(row.permissions),
    data,
    shareWith: shareOf(data),
    memberCount: typeof row.member_count === 'number' ? row.member_count : null,
    createdAt: ms(row.created_at),
    updatedAt: ms(row.updated_at),
  };
}

function groupFrom(raw: unknown): AdminGroup {
  const group = groupOf(raw);
  if (!group) throw new Error('Open WebUI did not describe the group');
  return group;
}

/** Every group, with how many are in each (for admins). */
export async function listAdminGroups(client: OwuiClient): Promise<AdminGroup[]> {
  return list(await client.get<unknown>('/api/v1/groups/')).flatMap((row) => groupOf(row) ?? []);
}

export async function getAdminGroup(client: OwuiClient, id: string): Promise<AdminGroup> {
  return groupFrom(await client.get<unknown>(groupPath(id)));
}

/** A group's members (ids, names and emails). */
export async function groupMembers(client: OwuiClient, id: string): Promise<{ id: string; name: string; email: string }[]> {
  return list(await client.post<unknown>(`${groupPath(id)}/users`)).flatMap((raw) => {
    const row = record(raw);
    return text(row.id) ? [{ id: text(row.id), name: text(row.name), email: text(row.email) }] : [];
  });
}

/** `data` with who may share with the group set, the rest as stored. */
export function dataWithShare(data: Tree | null, shareWith: ShareWith): Tree {
  const base = record(data);
  return { ...base, config: { ...record(base.config), share: shareWith === 'anyone' ? true : shareWith === 'nobody' ? false : 'members' } };
}

/** A new group; its permissions start as given (the web starts them from the defaults). */
export async function createAdminGroup(client: OwuiClient, input: { name: string; description: string; permissions: PermissionTree; shareWith?: ShareWith }): Promise<AdminGroup> {
  return groupFrom(await client.post<unknown>('/api/v1/groups/create', { name: input.name.trim(), description: input.description.trim(), permissions: input.permissions, ...(input.shareWith ? { data: dataWithShare(null, input.shareWith) } : {}) }));
}

/**
 * Saves a group: name and description always (the server needs them); permissions and data
 * only when given, as each replaces what's stored whole.
 */
export async function updateAdminGroup(client: OwuiClient, group: Pick<AdminGroup, 'id' | 'name' | 'description'>, change: { name?: string; description?: string; permissions?: PermissionTree; data?: Tree }): Promise<AdminGroup> {
  return groupFrom(
    await client.post<unknown>(`${groupPath(group.id)}/update`, {
      name: (change.name ?? group.name).trim(),
      description: (change.description ?? group.description).trim(),
      ...(change.permissions ? { permissions: change.permissions } : {}),
      ...(change.data ? { data: change.data } : {}),
    }),
  );
}

export async function addGroupMembers(client: OwuiClient, id: string, userIds: string[]): Promise<AdminGroup> {
  return groupFrom(await client.post<unknown>(`${groupPath(id)}/users/add`, { user_ids: userIds }));
}

export async function removeGroupMembers(client: OwuiClient, id: string, userIds: string[]): Promise<AdminGroup> {
  return groupFrom(await client.post<unknown>(`${groupPath(id)}/users/remove`, { user_ids: userIds }));
}

/** Deletes the group: its members lose what it gave them; what was shared with it is no longer. */
export async function deleteAdminGroup(client: OwuiClient, id: string): Promise<void> {
  await client.delete<unknown>(`${groupPath(id)}/delete`);
}

/** The permissions everyone has (stored; the server fills keys it lacks). */
export async function getDefaultPermissions(client: OwuiClient): Promise<PermissionTree> {
  return permissionTreeOf(await client.get<unknown>('/api/v1/users/default/permissions')) ?? {};
}

/** The server's own stock defaults, for "Reset" (nothing is saved until the admin saves). */
export async function getStockPermissions(client: OwuiClient): Promise<PermissionTree> {
  return permissionTreeOf(await client.get<unknown>('/api/v1/users/default/permissions/defaults')) ?? {};
}

/** Saves the default permissions: the whole tree as read, with the admin's edits. */
export async function saveDefaultPermissions(client: OwuiClient, tree: PermissionTree): Promise<PermissionTree> {
  return permissionTreeOf(await client.post<unknown>('/api/v1/users/default/permissions', tree)) ?? {};
}

/** A tree with some switches changed, everything else (missing keys too) as it was. */
export function withPermissions(tree: PermissionTree | null, changes: Record<string, boolean>): PermissionTree {
  const next: PermissionTree = Object.fromEntries(Object.entries(tree ?? {}).map(([section, keys]) => [section, { ...keys }]));
  for (const [path, value] of Object.entries(changes)) {
    const [section = '', key = ''] = path.split('.');
    next[section] = { ...(next[section] ?? {}), [key]: value };
  }
  return next;
}

/** The switches that differ between two trees (`section.key`), for "what changes" and for no-change saves. */
export function permissionChanges(before: PermissionTree | null, after: PermissionTree | null): string[] {
  const paths = new Set<string>();
  for (const tree of [before, after]) for (const [section, keys] of Object.entries(tree ?? {})) for (const key of Object.keys(keys)) paths.add(`${section}.${key}`);
  return [...paths].filter((path) => {
    const [section = '', key = ''] = path.split('.');
    return before?.[section]?.[key] !== after?.[section]?.[key];
  });
}

/** What someone may do: the defaults, plus anything any of their groups switches on. */
export function effectivePermissions(defaults: PermissionTree, groups: (PermissionTree | null)[]): PermissionTree {
  const result: PermissionTree = {};
  for (const tree of [defaults, ...groups]) {
    for (const [section, keys] of Object.entries(tree ?? {})) {
      for (const [key, value] of Object.entries(keys)) {
        result[section] = { ...(result[section] ?? {}), [key]: (result[section]?.[key] ?? false) || value };
      }
    }
  }
  return result;
}

export interface PermissionItem {
  key: string;
  label: string;
  /** Shown only when this is on (`section.key`), as the web shows it. */
  needs?: string[];
  /** Only when the server has plugins (tools) switched on. */
  plugins?: boolean;
}

export interface PermissionSection {
  key: string;
  label: string;
  items: PermissionItem[];
}

/** Every switch, in the web's order, in our own words. */
export const PERMISSION_SECTIONS: PermissionSection[] = [
  {
    key: 'workspace',
    label: 'Workspace',
    items: [
      { key: 'models', label: 'Models' },
      { key: 'models_import', label: 'Import models', needs: ['workspace.models'] },
      { key: 'models_export', label: 'Export models', needs: ['workspace.models'] },
      { key: 'knowledge', label: 'Knowledge' },
      { key: 'prompts', label: 'Prompts' },
      { key: 'prompts_import', label: 'Import prompts', needs: ['workspace.prompts'] },
      { key: 'prompts_export', label: 'Export prompts', needs: ['workspace.prompts'] },
      { key: 'skills', label: 'Skills' },
      { key: 'skills_import', label: 'Import skills', needs: ['workspace.skills'] },
      { key: 'skills_export', label: 'Export skills', needs: ['workspace.skills'] },
      { key: 'tools', label: 'Tools (they run code on the server)', plugins: true },
      { key: 'tools_import', label: 'Import tools', needs: ['workspace.tools'], plugins: true },
      { key: 'tools_export', label: 'Export tools', needs: ['workspace.tools'], plugins: true },
    ],
  },
  {
    key: 'sharing',
    label: 'Sharing',
    items: [
      { key: 'models', label: 'Share models' },
      { key: 'public_models', label: 'Share models with everyone', needs: ['sharing.models'] },
      { key: 'knowledge', label: 'Share knowledge' },
      { key: 'public_knowledge', label: 'Share knowledge with everyone', needs: ['sharing.knowledge'] },
      { key: 'prompts', label: 'Share prompts' },
      { key: 'public_prompts', label: 'Share prompts with everyone', needs: ['sharing.prompts'] },
      { key: 'skills', label: 'Share skills' },
      { key: 'public_skills', label: 'Share skills with everyone', needs: ['sharing.skills'] },
      { key: 'tools', label: 'Share tools', plugins: true },
      { key: 'public_tools', label: 'Share tools with everyone', needs: ['sharing.tools'], plugins: true },
      { key: 'notes', label: 'Share notes' },
      { key: 'public_notes', label: 'Share notes with everyone', needs: ['sharing.notes'] },
      { key: 'folders', label: 'Share folders' },
      { key: 'public_chats', label: 'Share chats publicly', needs: ['chat.share'] },
      { key: 'open_chats', label: 'Share chats anyone can join', needs: ['chat.share'] },
      { key: 'public_calendars', label: 'Share calendars with everyone', needs: ['features.calendar'] },
    ],
  },
  {
    key: 'access_grants',
    label: 'Who things can be shared with',
    items: [
      { key: 'allow_users', label: 'Particular people' },
      { key: 'allow_groups', label: 'Groups' },
    ],
  },
  {
    key: 'chat',
    label: 'Chats',
    items: [
      { key: 'controls', label: 'Chat controls' },
      { key: 'valves', label: 'Tool and function settings', needs: ['chat.controls'] },
      { key: 'system_prompt', label: 'System prompt', needs: ['chat.controls'] },
      { key: 'params', label: 'Advanced parameters', needs: ['chat.controls'] },
      { key: 'file_upload', label: 'Upload files' },
      { key: 'web_upload', label: 'Attach web pages' },
      { key: 'delete', label: 'Delete chats' },
      { key: 'delete_message', label: 'Delete messages' },
      { key: 'continue_response', label: 'Continue a reply' },
      { key: 'regenerate_response', label: 'Regenerate a reply' },
      { key: 'rate_response', label: 'Rate replies' },
      { key: 'edit', label: 'Edit messages' },
      { key: 'share', label: 'Share chats' },
      { key: 'export', label: 'Export chats' },
      { key: 'import', label: 'Import chats' },
      { key: 'stt', label: 'Dictation' },
      { key: 'tts', label: 'Read aloud' },
      { key: 'call', label: 'Voice calls' },
      { key: 'multiple_models', label: 'Several models at once' },
      { key: 'temporary', label: 'Temporary chats' },
      { key: 'temporary_enforced', label: 'Every chat is temporary', needs: ['chat.temporary'] },
    ],
  },
  {
    key: 'features',
    label: 'Features',
    items: [
      { key: 'api_keys', label: 'API keys' },
      { key: 'notes', label: 'Notes' },
      { key: 'channels', label: 'Channels' },
      { key: 'folders', label: 'Folders' },
      { key: 'direct_tool_servers', label: 'Their own tool servers' },
      { key: 'web_search', label: 'Web search' },
      { key: 'image_generation', label: 'Image generation' },
      { key: 'code_interpreter', label: 'Code interpreter' },
      { key: 'memories', label: 'Memories' },
      { key: 'automations', label: 'Automations' },
      { key: 'calendar', label: 'Calendar' },
      { key: 'webhooks', label: 'Webhooks' },
    ],
  },
  {
    key: 'settings',
    label: 'Settings',
    items: [{ key: 'interface', label: 'Change their settings' }],
  },
];

/** Whether a switch shows: what it needs is on (in the tree being edited), and tools only with plugins. */
export function permissionShown(item: PermissionItem, tree: PermissionTree, plugins: boolean): boolean {
  if (item.plugins && !plugins) return false;
  return (item.needs ?? []).every((path) => {
    const [section = '', key = ''] = path.split('.');
    return tree[section]?.[key] === true;
  });
}
