import { describe, expect, it } from 'vitest';
import { OwuiClient, type FetchLike } from './http';
import { commandFromName, commandProblem, getPromptVersion, listPromptVersions, listWorkspacePrompts, promptsExport, promptsFromImport, saveWorkspacePromptVersion } from './workspacePrompts';
import { createWorkspaceSkill, skillDraftFromMarkdown, skillFrontMatter, skillIdFromName, skillIdProblem, skillsFromImport, updateWorkspaceSkill } from './workspaceSkills';

function recordingClient(...answers: unknown[]) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(answers.shift() ?? {}), { status: 200 });
  };
  return { client: new OwuiClient({ baseUrl: 'https://chat.test', token: 't', fetch }), calls };
}

const PROMPT = { id: 'p1', command: '/summary', name: 'Summary', content: 'Sum up {{topic}}', tags: ['work'], data: null, meta: null, is_active: true, version_id: 'v2', access_grants: [], write_access: true, updated_at: 1_730_000_000, user: { name: 'Amy' } };

describe('workspace prompts', () => {
  it('reads prompts without the slash, and saves a version without sharing', async () => {
    const { client, calls } = recordingClient({ items: [PROMPT], total: 1 }, PROMPT);
    const [prompt] = (await listWorkspacePrompts(client, { query: 'sum' })).items;
    expect(prompt).toMatchObject({ id: 'p1', command: 'summary', tags: ['work'], versionId: 'v2', ownerName: 'Amy' });
    await saveWorkspacePromptVersion(client, prompt!, { content: 'Sum up {{topic}} in 3 lines', commitMessage: ' shorter ', live: false });
    expect(calls[1]).toMatchObject({ method: 'POST', url: 'https://chat.test/api/v1/prompts/id/p1/update', body: { command: 'summary', name: 'Summary', content: 'Sum up {{topic}} in 3 lines', commit_message: 'shorter', is_production: false, tags: ['work'] } });
    expect(calls[1]?.body).not.toHaveProperty('access_grants');
  });

  it('reads versions newest first', async () => {
    const versions = await listPromptVersions(recordingClient([{ id: 'v2', snapshot: { content: 'B', name: 'Summary', tags: ['work', { name: 'old' }] }, commit_message: 'shorter', user: { name: 'Amy' }, created_at: 1_730_000_100 }, { snapshot: {} }]).client, 'p1');
    expect(versions).toEqual([{ id: 'v2', content: 'B', name: 'Summary', tags: ['work', 'old'], commitMessage: 'shorter', author: 'Amy', createdAt: 1_730_000_100_000 }]);
  });

  it('reads one version on its own', async () => {
    const { client, calls } = recordingClient({ id: 'v 1', prompt_id: 'p1', snapshot: { content: 'A', name: 'Summary' }, commit_message: null, created_at: 1_730_000_000 });
    expect(await getPromptVersion(client, 'p1', 'v 1')).toEqual({ id: 'v 1', content: 'A', name: 'Summary', tags: [], commitMessage: '', author: '', createdAt: 1_730_000_000_000 });
    expect(calls[0]?.url).toBe('https://chat.test/api/v1/prompts/id/p1/history/v%201');
    await expect(getPromptVersion(recordingClient({ detail: 'x' }).client, 'p1', 'v9')).rejects.toThrow();
  });

  it('makes commands from names, and checks them as the web does', () => {
    expect(commandFromName('  Weekly Summary! ')).toBe('weekly-summary');
    expect(commandProblem('ok_cmd-1')).toBeNull();
    expect(commandProblem('no spaces')).not.toBeNull();
    expect(JSON.parse(promptsExport([{ id: 'p1', command: 'summary', name: 'Summary', content: 'Sum up {{topic}}', tags: ['work'], data: null, meta: null, isActive: true, versionId: 'v2', accessGrants: [], ownerName: '', writeAccess: true, updatedAt: 0 }]))).toEqual([{ command: 'summary', name: 'Summary', content: 'Sum up {{topic}}', tags: ['work'] }]);
  });
});

describe('workspace skills', () => {
  it('saves a skill as it is (on or off), new ones private', async () => {
    const answer = { id: 'tidy', name: 'Tidy', is_active: false };
    const { client, calls } = recordingClient(answer, answer);
    await createWorkspaceSkill(client, { id: 'tidy', name: ' Tidy ', description: 'Tidies', content: '# Tidy', tags: ['style'], isActive: true });
    expect(calls[0]?.body).toEqual({ id: 'tidy', name: 'Tidy', description: 'Tidies', content: '# Tidy', meta: { tags: ['style'] }, is_active: true, access_grants: [] });
    await updateWorkspaceSkill(client, { id: 'tidy', name: 'Tidy', description: '', content: '# Tidy', tags: [], isActive: false, meta: { extra: 1 } });
    expect(calls[1]).toMatchObject({ url: 'https://chat.test/api/v1/skills/id/tidy/update', body: { is_active: false, meta: { extra: 1, tags: [] } } });
    expect(calls[1]?.body).not.toHaveProperty('access_grants');
  });

  it('makes ids and reads a Markdown file’s header', () => {
    expect(skillIdFromName('Essay Feedback 2')).toBe('essay-feedback-2');
    expect(skillIdProblem('Bad Id')).not.toBeNull();
    expect(skillFrontMatter('---\nname: "Essay feedback"\ndescription: Marks essays\n---\n\nBody')).toEqual({ name: 'Essay feedback', description: 'Marks essays' });
    expect(skillFrontMatter('# No header')).toEqual({ name: '', description: '' });
  });
});

describe('workspace imports', () => {
  it('reads prompts from the web’s export and the app’s, skipping empty ones', () => {
    expect(promptsFromImport([{ command: '/summary', title: 'Summary', content: 'Sum up' }, { command: 'tone', name: 'Tone', content: 'Be kind', tags: ['work', { name: 'x' }] }, { command: '', content: 'no command' }, { command: 'blank', content: '  ' }])).toEqual({
      prompts: [
        { command: 'summary', name: 'Summary', content: 'Sum up', tags: [] },
        { command: 'tone', name: 'Tone', content: 'Be kind', tags: ['work', 'x'] },
      ],
      skipped: 2,
    });
    expect(promptsFromImport({ command: 'one', content: 'Just one' }).prompts).toEqual([{ command: 'one', name: 'one', content: 'Just one', tags: [] }]);
  });

  it('makes a skill draft from a Markdown file', () => {
    const markdown = '---\nname: essay-feedback\ndescription: "Marks essays"\n---\n# Steps';
    expect(skillDraftFromMarkdown(markdown)).toEqual({ name: 'Essay Feedback', id: 'essay-feedback', description: 'Marks essays', content: markdown });
    expect(skillDraftFromMarkdown('# Steps only', 'code_review.md')).toMatchObject({ name: 'Code Review', id: 'code_review', description: '' });
  });

  it('reads skills from an export, keeping on or off and settings, leaving sharing behind', () => {
    const { skills, skipped } = skillsFromImport([
      { id: 'Essay Feedback', name: 'Essay feedback', content: '# Steps', is_active: false, meta: { tags: ['school'], extra: 1 }, access_grants: [{ principal_type: 'user', principal_id: '*', permission: 'read' }] },
      { id: 'bad!', name: '', content: 'x' },
    ]);
    expect(skipped).toBe(1);
    expect(skills).toEqual([{ id: 'essay-feedback', name: 'Essay feedback', description: '', content: '# Steps', tags: ['school'], isActive: false, meta: { tags: ['school'], extra: 1 } }]);
  });

  it('reads a 0.12 export’s files, and sends a package’s other files along', async () => {
    const { skills } = skillsFromImport([{ id: 'grader', name: 'Grader', files: [{ path: 'SKILL.md', content: '# Grade' }, { path: 'rubric.md', content: 'A–F' }], meta: {}, is_active: true }]);
    expect(skills[0]).toMatchObject({ content: '# Grade', files: [{ path: 'SKILL.md', content: '# Grade' }, { path: 'rubric.md', content: 'A–F' }] });
    const { client, calls } = recordingClient({ id: 'grader', name: 'Grader' });
    await createWorkspaceSkill(client, { ...(skills[0] as NonNullable<(typeof skills)[0]>), content: '# Grade v2' });
    expect((calls[0]?.body as { files?: unknown }).files).toEqual([{ path: 'rubric.md', content: 'A–F' }, { path: 'SKILL.md', content: '# Grade v2' }]);
    expect(skillsFromImport([{ id: 'only', name: 'Only', files: [{ path: 'SKILL.md', content: '# One' }] }]).skills[0]).not.toHaveProperty('files');
  });
});
