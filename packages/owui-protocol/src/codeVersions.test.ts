import { describe, expect, it } from 'vitest';
import { updateAdminFunction, updateWorkspaceTool } from './codeItems';
import { compareCodeVersions, compareSkillFile, deleteCodeVersion, getCodeVersion, listCodeVersions, liveCodeVersionId, makeCodeVersionLive } from './codeVersions';
import { OwuiClient, type FetchLike } from './http';
import { unifiedLines } from './textDiff';
import { updateWorkspaceSkill } from './workspaceSkills';

function server(routes: Record<string, unknown>) {
  const calls: { method: string; path: string; query: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    const parsed = new URL(url);
    const method = init?.method ?? 'GET';
    calls.push({ method, path: parsed.pathname, query: parsed.search, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(routes[`${method} ${parsed.pathname}`] ?? {}), { status: 200 });
  };
  return { client: new OwuiClient({ baseUrl: 'https://chat.test', token: 't', fetch }), calls };
}

const PATCH = ['--- selected.py', '+++ production.py', '@@ -1,2 +1,2 @@', ' import os', '-x = 1', '+x = 2'].join('\n');

describe('versions of tools, functions and skills', () => {
  it('lists a page of versions with their notes and authors', async () => {
    const { client, calls } = server({ 'GET /api/v1/tools/id/t%201/history': [{ id: 'v2', parent_id: 'v1', commit_message: 'faster', user: { name: 'Amy' }, created_at: 1_730_000_100 }, { id: 'v1', parent_id: null, commit_message: null, user: null, created_at: 1_730_000_000 }, {}] });
    expect(await listCodeVersions(client, 'tools', 't 1', 2)).toEqual([
      { id: 'v2', parentId: 'v1', note: 'faster', author: 'Amy', createdAt: 1_730_000_100_000 },
      { id: 'v1', parentId: null, note: '', author: '', createdAt: 1_730_000_000_000 },
    ]);
    expect(calls[0]).toMatchObject({ path: '/api/v1/tools/id/t%201/history', query: '?page=2' });
  });

  it('reads a version with what it holds: a tool’s description from its meta, a skill’s own and its files', async () => {
    const { client } = server({
      'GET /api/v1/tools/id/t1/history/v1': { id: 'v1', snapshot: { name: 'Weather', content: 'import os', meta: { description: 'Forecasts' } }, created_at: 1 },
      'GET /api/v1/skills/id/s1/history/v1': { id: 'v1', snapshot: { name: 'Writing', description: 'Style', content: '# Writing', data: { files: [{ path: 'SKILL.md', size: 9, encoding: null }, { path: 'logo.png', size: 120, encoding: 'base64' }] } }, created_at: 1 },
    });
    expect((await getCodeVersion(client, 'tools', 't1', 'v1')).snapshot).toEqual({ name: 'Weather', description: 'Forecasts', content: 'import os', files: [] });
    expect((await getCodeVersion(client, 'skills', 's1', 'v1')).snapshot).toEqual({ name: 'Writing', description: 'Style', content: '# Writing', files: [{ path: 'SKILL.md', size: 9, binary: false }, { path: 'logo.png', size: 120, binary: true }] });
  });

  it('finds the live version, deletes one, and makes one live (a skill with the one it was at)', async () => {
    const { client, calls } = server({ 'GET /api/v1/functions/id/f1': { id: 'f1', version_id: 'v3' } });
    expect(await liveCodeVersionId(client, 'functions', 'f1')).toBe('v3');
    await deleteCodeVersion(client, 'functions', 'f1', 'v1');
    expect(calls[1]).toMatchObject({ method: 'DELETE', path: '/api/v1/functions/id/f1/history/v1' });
    await makeCodeVersionLive(client, 'tools', 't1', 'v1', 'v3');
    expect(calls[2]).toMatchObject({ method: 'POST', path: '/api/v1/tools/id/t1/update/version', body: { version_id: 'v1' } });
    await makeCodeVersionLive(client, 'skills', 's1', 'v1', 'v3');
    expect(calls[3]?.body).toEqual({ version_id: 'v1', expected_version_id: 'v3' });
  });

  it('compares a tool’s versions as the server does: name and description, then the code', async () => {
    const { client, calls } = server({ 'GET /api/v1/tools/id/t1/history/diff': { metadata: { name: { before: 'Old', after: 'New' }, meta: { before: { description: 'A' }, after: { description: 'B' } } }, content_diff: PATCH, line_endings_only: false } });
    const result = await compareCodeVersions(client, 'tools', 't1', 'v1', 'v2');
    expect(calls[0]?.query).toBe('?from_id=v1&to_id=v2');
    expect(result.changes).toEqual([
      { what: 'Name', before: 'Old', after: 'New' },
      { what: 'Description', before: 'A', after: 'B' },
    ]);
    expect(unifiedLines(result.diff)).toEqual(['@@ -1,2 +1,2 @@', ' import os', '-x = 1', '+x = 2']);
    expect(result.diff).toMatchObject({ removed: 1, added: 1, lineEndingsOnly: false });
  });

  it('compares a skill: its SKILL.md line by line, its other files listed', async () => {
    const { client, calls } = server({
      'GET /api/v1/skills/id/s1/history/diff': { metadata: { description: { before: 'A', after: 'B' } }, files: [{ path: 'SKILL.md', status: 'modified', binary: false }, { path: 'logo.png', status: 'added', binary: true }, { path: 'notes.md', status: 'deleted', binary: false }] },
      'GET /api/v1/skills/id/s1/history/diff/file': { binary: false, diff: PATCH, line_endings_only: false },
    });
    const result = await compareCodeVersions(client, 'skills', 's1', 'v1', 'v2');
    expect(result.changes).toEqual([{ what: 'Description', before: 'A', after: 'B' }]);
    expect(result.diff.removed).toBe(1);
    expect(result.files).toEqual([
      { path: 'logo.png', status: 'added', binary: true },
      { path: 'notes.md', status: 'deleted', binary: false },
    ]);
    expect(calls[1]?.query).toBe('?from_id=v1&to_id=v2&path=SKILL.md');
    expect(await compareSkillFile(server({ 'GET /api/v1/skills/id/s1/history/diff/file': { binary: true } }).client, 's1', 'v1', 'v2', 'logo.png')).toMatchObject({ binary: true, diff: { hunks: [] } });
  });

  it('sends a note with a save, and none when it’s empty', async () => {
    const { client, calls } = server({ 'POST /api/v1/skills/id/s1/update': { id: 's1', name: 'Writing' } });
    await updateWorkspaceTool(client, 't1', { name: 'Weather', description: '', content: 'x', note: ' faster ' });
    await updateAdminFunction(client, 'f1', { name: 'Filter', description: '', content: 'x', note: '  ' });
    await updateWorkspaceSkill(client, { id: 's1', name: 'Writing', description: '', content: '# W', tags: [], isActive: true, note: 'clearer' });
    expect(calls[0]?.body).toMatchObject({ commit_message: 'faster' });
    expect(calls[1]?.body).not.toHaveProperty('commit_message');
    expect(calls[2]?.body).toMatchObject({ commit_message: 'clearer' });
  });
});
