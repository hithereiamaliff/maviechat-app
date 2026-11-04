import { describe, expect, it } from 'vitest';
import { listKnowledgeBases } from './chatOptions';
import { getCliApps, usableCliApps } from './cliApps';
import { joinFrontMatter, splitFrontMatter } from './frontMatter';
import { DtClient, type FetchLike } from './http';
import { listKnowledgeCenter } from './knowledge';
import { createPersona, listPersonas, resourceNameProblem, slugifyName, updatePersona } from './personas';
import { cleanTag, filterSkills, listSkills, skillUsage, tagCounts, tagProblem, updateSkill } from './skills';
import { isAgentConnection, listAgentConnections } from './subagents';

function recordingClient(...answers: { status?: number; body: unknown }[]) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const answer = answers.shift() ?? { body: {} };
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  };
  return { client: new DtClient({ baseUrl: 'https://learn.test', token: 't', fetch }), calls };
}

describe('Markdown files with a header', () => {
  const file = '---\nname: maths-tutor\ndescription: Patient\nalways: true\nrequires:\n  bins: [latex]\n---\n\n# Maths tutor\n\nGo step by step.\n';

  it('splits the header from the body and puts them back together', () => {
    const split = splitFrontMatter(file);
    expect(split.header).toBe('---\nname: maths-tutor\ndescription: Patient\nalways: true\nrequires:\n  bins: [latex]\n---\n');
    expect(split.body).toBe('# Maths tutor\n\nGo step by step.\n');
    expect(joinFrontMatter(split)).toBe(file);
    expect(joinFrontMatter({ ...split, body: '# Changed\n' })).toContain('always: true\nrequires:');
  });

  it('takes a file without a header (or with a byte-order mark, or Windows line ends) as it is', () => {
    expect(splitFrontMatter('# Just text')).toEqual({ header: '', body: '# Just text' });
    expect(splitFrontMatter('﻿---\r\nname: a\r\n---\r\nBody')).toEqual({ header: '---\r\nname: a\r\n---\r\n', body: 'Body' });
    expect(splitFrontMatter('--- not a header\nText').header).toBe('');
    expect(joinFrontMatter({ header: '', body: 'x' })).toBe('x');
  });
});

describe('names', () => {
  it('makes typed names into ones DeepTutor accepts, as its pages do', () => {
    expect(slugifyName('My Tutor_v2!')).toBe('my-tutor-v2');
    expect(slugifyName('--  Hello   World')).toBe('hello-world');
    expect(slugifyName('Ünïcode')).toBe('ncode');
    expect(slugifyName('a'.repeat(80))).toHaveLength(64);
    expect(resourceNameProblem('')).toBe('Give it a name.');
    expect(resourceNameProblem('-x')).not.toBeNull();
    expect(resourceNameProblem('peer-2')).toBeNull();
  });
});

describe('personas', () => {
  it('lists yours and the presets, which are read-only', async () => {
    const { client } = recordingClient({ body: { personas: [{ name: 'coach', description: 'Brisk', source: 'user', read_only: false }, { name: 'teacher', description: '', source: 'admin', read_only: true }, { description: 'nameless' }] } });
    expect(await listPersonas(client)).toEqual([
      { name: 'coach', description: 'Brisk', preset: false, readOnly: false },
      { name: 'teacher', description: '', preset: true, readOnly: true },
    ]);
  });

  it('creates one, and sends only what changed, renaming only to a new name', async () => {
    const { client, calls } = recordingClient({ body: { name: 'coach', description: 'Brisk', source: 'user', read_only: false } }, { body: { name: 'coach', source: 'user' } }, { body: { name: 'mentor', source: 'user' } });
    await createPersona(client, { name: 'coach', description: 'Brisk', content: 'Be brief.' });
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://learn.test/api/personas', body: { name: 'coach', description: 'Brisk', content: 'Be brief.' } });
    await updatePersona(client, 'coach', { description: 'Kind', renameTo: 'coach' });
    expect(calls[1]).toMatchObject({ method: 'PUT', url: 'https://learn.test/api/personas/coach', body: { description: 'Kind' } });
    expect(await updatePersona(client, 'coach', { content: 'Hi', renameTo: 'mentor' })).toMatchObject({ name: 'mentor' });
    expect(calls[2]?.body).toEqual({ content: 'Hi', rename_to: 'mentor' });
  });
});

describe('skills', () => {
  const rows = [
    { name: 'mine', description: 'Mine', tags: ['style'], source: 'user', read_only: false },
    { name: 'given', tags: ['tool', 'style'], source: 'admin', read_only: true, assigned: true },
    { name: 'pdf', tags: [], source: 'builtin', read_only: true },
  ];

  it('lists them with where each comes from', async () => {
    const skills = await listSkills(recordingClient({ body: { skills: rows } }).client);
    expect(skills.map((skill) => [skill.name, skill.source, skill.readOnly, skill.assigned])).toEqual([
      ['mine', 'user', false, false],
      ['given', 'admin', true, true],
      ['pdf', 'builtin', true, false],
    ]);
    expect(await listSkills(recordingClient({ body: ['bare'] }).client)).toMatchObject([{ name: 'bare' }]);
  });

  it('counts and filters by tag', async () => {
    const skills = await listSkills(recordingClient({ body: { skills: rows } }).client);
    expect(tagCounts(skills)).toEqual({ all: 3, untagged: 1, byTag: { style: 2, tool: 1 } });
    expect(filterSkills(skills, { kind: 'tag', tag: 'style' }).map((skill) => skill.name)).toEqual(['mine', 'given']);
    expect(filterSkills(skills, { kind: 'untagged' }).map((skill) => skill.name)).toEqual(['pdf']);
    expect(cleanTag('  Study Tips ')).toBe('study tips');
    expect(tagProblem('study tips')).toBeNull();
    expect(tagProblem('#hash')).not.toBeNull();
  });

  it('leaves the file alone when only its description or tags change', async () => {
    const { client, calls } = recordingClient({ body: { name: 'mine', source: 'user' } }, { body: { name: 'mine-2', source: 'user' } });
    await updateSkill(client, 'mine', { description: 'New', tags: ['tool'] });
    expect(calls[0]).toMatchObject({ method: 'PUT', url: 'https://learn.test/api/skills/mine', body: { description: 'New', tags: ['tool'] } });
    await updateSkill(client, 'mine', { content: '---\nname: mine\nalways: true\n---\n\nBody', renameTo: 'mine-2' });
    expect(calls[1]?.body).toEqual({ content: '---\nname: mine\nalways: true\n---\n\nBody', rename_to: 'mine-2' });
  });

  it('says which workspaces use a skill', async () => {
    const { client, calls } = recordingClient({ body: { workspaces: [{ workspace_id: 'w1', display_name: 'Biology' }, { display_name: 'no id' }] } });
    expect(await skillUsage(client, 'mine')).toEqual([{ id: 'w1', name: 'Biology' }]);
    expect(calls[0]?.url).toBe('https://learn.test/api/settings/workspace/resource-usage?kind=skills&resource_id=mine');
  });
});

describe('connected agents are not knowledge bases', () => {
  const kbs = [
    { name: 'Biology', status: 'ready', metadata: {} },
    { name: 'my-codex', status: 'ready', metadata: { type: 'subagent', agent_kind: 'codex', cwd: '' } },
  ];

  it('leaves them out of the chat’s and the Knowledge Center’s lists', async () => {
    expect(isAgentConnection(kbs[1])).toBe(true);
    expect((await listKnowledgeBases(recordingClient({ body: kbs }).client)).map((kb) => kb.name)).toEqual(['Biology']);
    expect((await listKnowledgeCenter(recordingClient({ body: kbs }).client)).map((kb) => kb.name)).toEqual(['Biology']);
  });

  it('lists the connections, or none when the server has knowledge features off', async () => {
    expect(await listAgentConnections(recordingClient({ body: { connections: [{ name: 'my-codex', agent_kind: 'codex', cwd: '', description: '' }] } }).client)).toEqual([{ name: 'my-codex', kind: 'codex', folder: '', description: '' }]);
    expect(await listAgentConnections(recordingClient({ status: 404, body: { detail: 'Not Found' } }).client)).toBeNull();
  });
});

describe('CLI apps', () => {
  it('reads the apps and which a chat can use', async () => {
    const state = await getCliApps(
      recordingClient({
        body: {
          access: { unrestricted: false, exec_denied: false },
          apps: [
            { id: 'pandoc', display_name: 'Pandoc', trust: 'first-party', granted: true, enabled: true, in_catalog: true },
            { id: 'off', granted: true, enabled: false },
            { id: 'locked', granted: false, enabled: false, trust: 'third-party' },
          ],
        },
      }).client,
    );
    expect(state.apps.map((app) => [app.id, app.name, app.toolName, app.firstParty])).toEqual([
      ['pandoc', 'Pandoc', 'cli_pandoc', true],
      ['off', 'off', 'cli_off', true],
      ['locked', 'locked', 'cli_locked', false],
    ]);
    expect(usableCliApps(state).map((app) => app.id)).toEqual(['pandoc']);
    expect(usableCliApps({ ...state, execDenied: true })).toEqual([]);
  });
});
