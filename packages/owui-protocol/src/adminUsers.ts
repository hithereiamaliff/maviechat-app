import type { OwuiClient } from './http';

/*
 * Admin → Users (Open WebUI 0.11.3), for admins only. Roles are `admin`, `user` and `pending`
 * (waiting for an admin; approving one is giving them `user`). The first account is the primary
 * admin: only they may change themselves, and never stop being admin. Deleting a user deletes
 * their chats too; their files, knowledge, models and tools stay.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const ms = (value: unknown): number => (typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : 0);
const userPath = (id: string) => `/api/v1/users/${encodeURIComponent(id)}`;

export const USER_ROLES = ['admin', 'user', 'pending'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  profileImageUrl: string;
  /** Signed in through these providers (provider → their id there). */
  oauth: Record<string, string>;
  groupIds: string[];
  lastActiveAt: number;
  createdAt: number;
  updatedAt: number;
}

function userOf(raw: unknown): AdminUser | null {
  const row = record(raw);
  const id = text(row.id);
  if (!id) return null;
  const oauth = Object.fromEntries(Object.entries(record(row.oauth)).map(([provider, value]) => [provider, text(record(value).sub)]));
  return {
    id,
    name: text(row.name) || text(row.email) || id,
    email: text(row.email),
    role: text(row.role) || 'pending',
    profileImageUrl: text(row.profile_image_url),
    oauth,
    groupIds: list(row.group_ids).map(text).filter(Boolean),
    lastActiveAt: ms(row.last_active_at),
    createdAt: ms(row.created_at),
    updatedAt: ms(row.updated_at),
  };
}

export type UserOrder = 'name' | 'email' | 'role' | 'created_at' | 'last_active_at' | 'updated_at';

/** One page (30) of users: by name or email (any case), in the order asked (`group_id:<id>` puts a group's members first). */
export async function listAdminUsers(client: OwuiClient, query: { query?: string; orderBy?: UserOrder | `group_id:${string}`; direction?: 'asc' | 'desc'; page?: number } = {}): Promise<{ items: AdminUser[]; total: number }> {
  const params: Record<string, string | number> = { order_by: query.orderBy ?? 'created_at', direction: query.direction ?? 'asc', page: query.page ?? 1 };
  if (query.query?.trim()) params.query = query.query.trim();
  const body = record(await client.get<unknown>('/api/v1/users/', { query: params }));
  return { items: list(body.users).flatMap((row) => userOf(row) ?? []), total: typeof body.total === 'number' ? body.total : 0 };
}

/** Everyone, briefly: for counting who's waiting for approval. */
export async function listAllUsers(client: OwuiClient): Promise<{ id: string; name: string; email: string; role: string }[]> {
  return list(record(await client.get<unknown>('/api/v1/users/all')).users).flatMap((raw) => {
    const row = record(raw);
    const id = text(row.id);
    return id ? [{ id, name: text(row.name), email: text(row.email), role: text(row.role) }] : [];
  });
}

export interface AdminUserDetail extends AdminUser {
  groups: { id: string; name: string }[];
  /** Signed in and seen in the last few minutes. */
  active: boolean;
}

export async function getAdminUser(client: OwuiClient, id: string): Promise<AdminUserDetail> {
  const raw = await client.get<unknown>(userPath(id));
  const user = userOf(raw);
  if (!user) throw new Error('Open WebUI did not describe the user');
  const row = record(raw);
  const groups = list(row.groups).flatMap((item) => {
    const group = record(item);
    return text(group.id) ? [{ id: text(group.id), name: text(group.name) || text(group.id) }] : [];
  });
  return { ...user, groupIds: groups.map((group) => group.id), groups, active: row.is_active === true };
}

/** What a user can reach: their groups, and the models, knowledge and tools they may read (of how many there are). */
export interface UserAccess {
  groups: { id: string; name: string }[];
  models: { items: { id: string; name: string }[]; total: number };
  knowledge: { items: { id: string; name: string }[]; total: number };
  tools: { items: { id: string; name: string }[]; total: number };
}

const named = (value: unknown) =>
  list(value).flatMap((item) => {
    const row = record(item);
    return text(row.id) ? [{ id: text(row.id), name: text(row.name) || text(row.id) }] : [];
  });
const reach = (value: unknown) => {
  const row = record(value);
  return { items: named(row.items), total: typeof row.total === 'number' ? row.total : 0 };
};

export async function userAccess(client: OwuiClient, id: string): Promise<UserAccess> {
  const body = record(await client.get<unknown>(`${userPath(id)}/preview`));
  return { groups: named(body.groups), models: reach(body.models), knowledge: reach(body.knowledge), tools: reach(body.tools) };
}

/**
 * Makes an account. The server answers with a signed-in session for it, which the app drops:
 * only the new account's id, name, email and role are kept.
 */
export async function addUser(client: OwuiClient, input: { name: string; email: string; password: string; role: UserRole; profileImageUrl?: string }): Promise<{ id: string; name: string; email: string; role: string }> {
  const row = record(await client.post<unknown>('/api/v1/auths/add', { name: input.name.trim(), email: input.email.trim(), password: input.password, role: input.role, ...(input.profileImageUrl ? { profile_image_url: input.profileImageUrl } : {}) }));
  return { id: text(row.id), name: text(row.name), email: text(row.email), role: text(row.role) };
}

/** Changes only what's given. A new password signs that user out everywhere. */
export async function updateUser(client: OwuiClient, id: string, change: { role?: UserRole; name?: string; email?: string; password?: string; profileImageUrl?: string }): Promise<AdminUser> {
  const body: Tree = {};
  if (change.role) body.role = change.role;
  if (change.name !== undefined) body.name = change.name.trim();
  if (change.email !== undefined) body.email = change.email.trim();
  if (change.password) body.password = change.password;
  if (change.profileImageUrl !== undefined) body.profile_image_url = change.profileImageUrl;
  const user = userOf(await client.post<unknown>(`${userPath(id)}/update`, body));
  if (!user) throw new Error('Open WebUI did not describe the user');
  return user;
}

/** Deletes the account and all its chats (403 for yourself and the primary admin). */
export async function deleteUser(client: OwuiClient, id: string): Promise<void> {
  await client.delete<unknown>(userPath(id));
}

/** Seen in the last three minutes, as the web marks someone active. */
export const recentlyActive = (lastActiveAt: number, now: number): boolean => lastActiveAt > 0 && now - lastActiveAt < 180_000;

/** Why the app won't let you change a user's role this way, if it won't. */
export function roleChangeProblem(target: { id: string; role: string }, me: { id: string }, role: string): string | null {
  if (!(USER_ROLES as readonly string[]).includes(role)) return 'Admin, user or pending only.';
  if (target.id === me.id && target.role === 'admin' && role !== 'admin') return 'You can’t take away your own admin role here: another admin can.';
  return null;
}
