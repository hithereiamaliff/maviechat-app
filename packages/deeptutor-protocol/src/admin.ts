import type { DtClient } from './http';

/*
 * DeepTutor's user management (1.7.1, admins only): every account with its role and preset,
 * adding one, making someone an admin or not, resetting a password, deleting an account, and
 * what each ordinary account has been given (models, knowledge, skills, partners, tools, books).
 * A role travels inside the sign-in, so a change applies at the person's next sign-in; and a
 * sign-in they already have keeps working until it expires (DeepTutor doesn't track them).
 * Admins all work in the one shared main workspace, so making someone an admin hands them it.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const userPath = (username: string) => `/api/auth/users/${encodeURIComponent(username)}`;

export type DtPreset = 'standard' | 'learner' | 'custom';

export interface DtAdminUser {
  id: string;
  username: string;
  /** `admin`, or `user` (DeepTutor also knows `teacher` and `student`, which grant nothing). */
  role: string;
  isAdmin: boolean;
  /** For ordinary accounts. */
  preset: DtPreset | '';
  createdAt: number | null;
  mustChangePassword: boolean;
  disabled: boolean;
  /** The admin set in DeepTutor's own configuration: its role can't be changed here. */
  configured: boolean;
}

function userOf(raw: unknown): DtAdminUser | null {
  const row = record(raw);
  const username = text(row.username);
  if (!username) return null;
  const preset = row.preset === 'standard' || row.preset === 'learner' || row.preset === 'custom' ? row.preset : '';
  const created = Date.parse(text(row.created_at));
  return {
    id: text(row.id),
    username,
    role: text(row.role) || 'user',
    isAdmin: row.role === 'admin',
    preset,
    createdAt: Number.isFinite(created) ? created : null,
    mustChangePassword: row.must_change_password === true,
    disabled: row.disabled === true,
    configured: row.id === 'env-admin',
  };
}

/** Every account (no paging): admins first, then by name. */
export async function listAdminUsers(client: DtClient): Promise<DtAdminUser[]> {
  const raw = await client.get<unknown>('/api/auth/users');
  return (Array.isArray(raw) ? raw : list(record(raw).users))
    .flatMap((row) => userOf(row) ?? [])
    .sort((a, b) => Number(b.isAdmin) - Number(a.isAdmin) || a.username.localeCompare(b.username));
}

/** What's wrong with a username, as DeepTutor checks it: an email, 3–64 letters, digits, `_`, `-` and `.`, or 2–64 CJK characters. */
export function usernameProblem(input: string): string | null {
  const name = input.trim();
  if (!name) return 'Give a username.';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name)) return null;
  if (/^[A-Za-z0-9_.-]{3,64}$/.test(name)) return null;
  if (/^[㐀-鿿豈-﫿぀-ヿ가-힯]{2,64}$/.test(name)) return null;
  return 'An email, or 3 to 64 letters, digits, dots, dashes or underscores.';
}

export const passwordProblem = (password: string): string | null => (password.length < 8 ? 'At least 8 characters.' : null);

/** A new ordinary account; DeepTutor asks them to change the password at their first sign-in. */
export async function createUser(client: DtClient, input: { username: string; password: string; preset: DtPreset }): Promise<{ id: string; username: string }> {
  const body = record(await client.post<unknown>('/api/auth/users', { username: input.username.trim(), password: input.password, preset: input.preset }));
  return { id: text(body.user_id), username: text(body.username) || input.username.trim() };
}

/** Makes someone an admin, or an ordinary account again (from their next sign-in). Not yourself. */
export async function setUserRole(client: DtClient, username: string, role: 'admin' | 'user'): Promise<void> {
  await client.send<unknown>('PUT', `${userPath(username)}/role`, { body: { role } });
}

/** Sets a new password; they're asked to change it at their next sign-in. */
export async function resetUserPassword(client: DtClient, username: string, password: string): Promise<void> {
  await client.send<unknown>('PUT', `${userPath(username)}/password`, { body: { new_password: password } });
}

/** Deletes an account for good (its data stays on the server). Not yourself. */
export async function deleteUser(client: DtClient, username: string): Promise<void> {
  await client.delete<unknown>(userPath(username));
}

/** What an ordinary account has been given, counted (DeepTutor's own editor changes it). */
export interface DtGrantSummary {
  models: number;
  knowledgeBases: number;
  skills: number;
  partners: number;
  /** null: every tool (the default); else how many. */
  tools: number | null;
  /** null: none (the default); else how many. */
  mcpTools: number | null;
  /** Running code: as the server allows (null or true), or never (false). */
  code: boolean | null;
  /** A learner's limits, or null. */
  learning: { ageBand: string; surfaces: string[] } | null;
}

export async function getUserGrants(client: DtClient, userId: string): Promise<DtGrantSummary> {
  const grant = record(record(await client.get<unknown>(`/api/multi-user/users/${encodeURIComponent(userId)}/grants`)).grant);
  const llm = list(record(grant.models).llm);
  const policy = grant.learning_policy === null || grant.learning_policy === undefined ? null : record(grant.learning_policy);
  return {
    models: llm.reduce<number>((sum, row) => sum + list(record(row).model_ids).length, 0),
    knowledgeBases: list(grant.knowledge_bases).length,
    skills: list(grant.skills).length,
    partners: list(grant.partners).length,
    tools: Array.isArray(grant.enabled_tools) ? grant.enabled_tools.length : null,
    mcpTools: Array.isArray(grant.mcp_tools) ? grant.mcp_tools.length : null,
    code: typeof grant.exec_enabled === 'boolean' ? grant.exec_enabled : null,
    learning: policy ? { ageBand: text(policy.age_band), surfaces: list(policy.allowed_surfaces).map(text).filter(Boolean) } : null,
  };
}

/** Whether they may make books of their own, and their access to shared ones. */
export async function getBookPermission(client: DtClient, userId: string): Promise<{ create: boolean; shared: 'none' | 'read'; books: number }> {
  const permission = record(record(await client.get<unknown>(`/api/multi-user/users/${encodeURIComponent(userId)}/book-permission`)).permission);
  return { create: permission.create === true, shared: permission.default === 'read' ? 'read' : 'none', books: Object.keys(record(permission.books)).length };
}
