import { describe, expect, it } from 'vitest';
import { OwuiClient, type FetchLike } from './http';
import { dataWithShare, effectivePermissions, listAdminGroups, PERMISSION_SECTIONS, permissionChanges, permissionShown, updateAdminGroup, withPermissions } from './adminGroups';
import { addUser, listAdminUsers, roleChangeProblem, updateUser } from './adminUsers';

function recordingClient(...answers: unknown[]) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(answers.shift() ?? {}), { status: 200 });
  };
  return { client: new OwuiClient({ baseUrl: 'https://chat.test', token: 't', fetch }), calls };
}

describe('admin users', () => {
  it('lists a page of users in the order asked', async () => {
    const { client, calls } = recordingClient({ users: [{ id: 'u1', name: 'Amy', email: 'amy@x.test', role: 'pending', group_ids: ['g1'], oauth: { google: { sub: '42' } }, last_active_at: 1_730_000_000, created_at: 1_729_000_000 }], total: 1 });
    const { items } = await listAdminUsers(client, { query: ' amy ', orderBy: 'last_active_at', direction: 'desc', page: 2 });
    expect(calls[0]?.url).toBe('https://chat.test/api/v1/users/?order_by=last_active_at&direction=desc&page=2&query=amy');
    expect(items[0]).toMatchObject({ id: 'u1', role: 'pending', groupIds: ['g1'], oauth: { google: '42' }, lastActiveAt: 1_730_000_000_000 });
  });

  it('drops the session the server hands back for a new account', async () => {
    const { client, calls } = recordingClient({ token: 'secret-session', token_type: 'Bearer', id: 'u2', email: 'bo@x.test', name: 'Bo', role: 'user' });
    const made = await addUser(client, { name: ' Bo ', email: 'bo@x.test', password: 'pw', role: 'user' });
    expect(made).toEqual({ id: 'u2', name: 'Bo', email: 'bo@x.test', role: 'user' });
    expect(JSON.stringify(made)).not.toContain('secret-session');
    expect(calls[0]?.body).toEqual({ name: 'Bo', email: 'bo@x.test', password: 'pw', role: 'user' });
  });

  it('sends only what changes, and never an empty password', async () => {
    const { client, calls } = recordingClient({ id: 'u2', name: 'Bo', email: 'bo@x.test', role: 'admin' });
    await updateUser(client, 'u2', { role: 'admin', password: '' });
    expect(calls[0]?.body).toEqual({ role: 'admin' });
  });

  it('won’t let an admin demote themselves here', () => {
    expect(roleChangeProblem({ id: 'me', role: 'admin' }, { id: 'me' }, 'user')).not.toBeNull();
    expect(roleChangeProblem({ id: 'other', role: 'admin' }, { id: 'me' }, 'user')).toBeNull();
    expect(roleChangeProblem({ id: 'other', role: 'user' }, { id: 'me' }, 'owner')).not.toBeNull();
  });
});

describe('groups and permissions', () => {
  it('reads groups, with who may share with them', async () => {
    const [group, open] = await listAdminGroups(recordingClient([{ id: 'g1', name: 'Staff', description: '', member_count: 3, permissions: { chat: { share: true, junk: 'x' } }, data: { config: { share: 'members' } } }, { id: 'g2', name: 'Open', data: { config: { share: true } } }]).client);
    expect(group).toMatchObject({ id: 'g1', memberCount: 3, shareWith: 'members', permissions: { chat: { share: true } } });
    expect(open).toMatchObject({ shareWith: 'anyone', permissions: null });
    expect(dataWithShare({ config: { other: 1 }, keep: true }, 'nobody')).toEqual({ config: { other: 1, share: false }, keep: true });
  });

  it('saves a group with name and description always, permissions only when changed', async () => {
    const { client, calls } = recordingClient({ id: 'g1', name: 'Staff' }, { id: 'g1', name: 'Staff' });
    await updateAdminGroup(client, { id: 'g1', name: 'Staff', description: 'All staff' }, { name: 'Staff 2' });
    await updateAdminGroup(client, { id: 'g1', name: 'Staff', description: 'All staff' }, { permissions: { chat: { share: false } } });
    expect(calls[0]?.body).toEqual({ name: 'Staff 2', description: 'All staff' });
    expect(calls[1]?.body).toEqual({ name: 'Staff', description: 'All staff', permissions: { chat: { share: false } } });
  });

  it('changes switches and keeps missing keys missing', () => {
    const stored = { chat: { share: true }, workspace: {} };
    const next = withPermissions(stored, { 'workspace.models': true });
    expect(next).toEqual({ chat: { share: true }, workspace: { models: true } });
    expect(stored.workspace).toEqual({});
    expect(permissionChanges(stored, next)).toEqual(['workspace.models']);
    expect(permissionChanges(stored, withPermissions(stored, {}))).toEqual([]);
  });

  it('lets groups add permissions, never take them away', () => {
    const defaults = { chat: { share: true, delete: false }, workspace: { models: false } };
    const merged = effectivePermissions(defaults, [{ chat: { share: false }, workspace: { models: true } }, null, { chat: { delete: true } }]);
    expect(merged).toEqual({ chat: { share: true, delete: true }, workspace: { models: true } });
  });

  it('shows a switch only when what it needs is on, and tools only with plugins', () => {
    const exportModels = PERMISSION_SECTIONS[0]?.items.find((item) => item.key === 'models_export');
    const tools = PERMISSION_SECTIONS[0]?.items.find((item) => item.key === 'tools');
    expect(exportModels && permissionShown(exportModels, { workspace: { models: false } }, true)).toBe(false);
    expect(exportModels && permissionShown(exportModels, { workspace: { models: true } }, true)).toBe(true);
    expect(tools && permissionShown(tools, {}, false)).toBe(false);
    const keys = PERMISSION_SECTIONS.flatMap((section) => section.items.map((item) => `${section.key}.${item.key}`));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(13 + 16 + 2 + 21 + 12 + 1);
  });
});
