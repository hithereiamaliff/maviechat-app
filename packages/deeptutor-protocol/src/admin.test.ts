import { describe, expect, it } from 'vitest';
import { createUser, deleteUser, getUserGrants, listAdminUsers, passwordProblem, resetUserPassword, setUserRole, usernameProblem } from './admin';
import { DtClient, type FetchLike } from './http';

function recordingClient(...answers: unknown[]) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(answers.shift() ?? {}), { status: 200 });
  };
  return { client: new DtClient({ baseUrl: 'https://learn.test', token: 't', fetch }), calls };
}

describe('DeepTutor user management', () => {
  it('lists accounts, admins first', async () => {
    const users = await listAdminUsers(
      recordingClient([
        { id: 'u2', username: 'zara', role: 'user', preset: 'learner', created_at: '2026-11-01T08:00:00Z', must_change_password: true },
        { id: 'env-admin', username: 'admin', role: 'admin', created_at: '' },
        { id: 'u1', username: 'amy', role: 'user', preset: 'standard', created_at: '2026-10-01T08:00:00Z' },
        { username: '' },
      ]).client,
    );
    expect(users.map((user) => [user.username, user.isAdmin, user.preset, user.configured, user.mustChangePassword])).toEqual([
      ['admin', true, '', true, false],
      ['amy', false, 'standard', false, false],
      ['zara', false, 'learner', false, true],
    ]);
    expect(users[0]?.createdAt).toBeNull();
    expect(users[2]?.createdAt).toBe(Date.UTC(2026, 10, 1, 8));
  });

  it('checks usernames and passwords as DeepTutor does', () => {
    expect(usernameProblem('amy@example.com')).toBeNull();
    expect(usernameProblem('amy.lee_2')).toBeNull();
    expect(usernameProblem('李明')).toBeNull();
    expect(usernameProblem('ab')).not.toBeNull();
    expect(usernameProblem('has space')).not.toBeNull();
    expect(passwordProblem('1234567')).not.toBeNull();
    expect(passwordProblem('12345678')).toBeNull();
  });

  it('adds, promotes, resets and deletes by username', async () => {
    const { client, calls } = recordingClient({ ok: true, user_id: 'u9', username: 'new.user' }, { ok: true }, { ok: true }, { ok: true });
    expect(await createUser(client, { username: ' new.user ', password: 'secret-pass', preset: 'standard' })).toEqual({ id: 'u9', username: 'new.user' });
    await setUserRole(client, 'new.user', 'admin');
    await resetUserPassword(client, 'new.user', 'another-pass');
    await deleteUser(client, 'a@b.c');
    expect(calls.map((call) => [call.method, call.url.replace('https://learn.test', ''), call.body])).toEqual([
      ['POST', '/api/auth/users', { username: 'new.user', password: 'secret-pass', preset: 'standard' }],
      ['PUT', '/api/auth/users/new.user/role', { role: 'admin' }],
      ['PUT', '/api/auth/users/new.user/password', { new_password: 'another-pass' }],
      ['DELETE', '/api/auth/users/a%40b.c', undefined],
    ]);
  });

  it('counts what an account has been given', async () => {
    const summary = await getUserGrants(
      recordingClient({
        grant: {
          version: 2,
          models: { llm: [{ profile_id: 'p', model_ids: ['a', 'b'] }, { profile_id: 'q', model_ids: ['c'] }] },
          knowledge_bases: [{ resource_id: 'admin:kb:x' }],
          skills: [],
          partners: [{ partner_id: 'p1' }],
          enabled_tools: null,
          mcp_tools: ['mcp_notes_search'],
          exec_enabled: false,
          learning_policy: { age_band: '9-12', allowed_surfaces: ['chat', 'reading'] },
        },
      }).client,
      'u2',
    );
    expect(summary).toEqual({ models: 3, knowledgeBases: 1, skills: 0, partners: 1, tools: null, mcpTools: 1, code: false, learning: { ageBand: '9-12', surfaces: ['chat', 'reading'] } });
  });
});
