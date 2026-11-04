import {
  createWorkspacePrompt,
  createWorkspaceSkill,
  deletePromptVersion,
  deleteWorkspacePrompt,
  deleteWorkspaceSkill,
  exportWorkspaceSkills,
  getWorkspacePrompt,
  getWorkspaceSkill,
  listPromptVersions,
  listWorkspacePrompts,
  listWorkspaceSkills,
  makePromptVersionLive,
  OwuiHttpError,
  saveWorkspacePromptVersion,
  skillsFromImport,
  toggleWorkspacePrompt,
  toggleWorkspaceSkill,
  updateWorkspacePromptMeta,
  updateWorkspaceSkill,
  type Capabilities,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

async function statusOf(run: () => Promise<unknown>): Promise<number> {
  try {
    await run();
    return 200;
  } catch (error) {
    if (error instanceof OwuiHttpError) return error.status;
    throw error;
  }
}

/**
 * M3.4: prompts and skills. Where the account may make them (an admin on the scratch instance),
 * a probe prompt through its versions (live, not live, an older one made live again, one deleted),
 * a command clash, renamed, off and on, deleted; a probe skill kept off through a save, a name
 * clash, deleted. Where it may not (the test account on production), the lists read and making
 * one refused.
 */
export async function probeM3Text({ client, capabilities }: { client: OwuiClient; capabilities: Capabilities }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const step = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };
  const stamp = Date.now().toString(36);
  const canPrompts = capabilities.isAdmin || capabilities.can('workspace.prompts');
  const canSkills = capabilities.isAdmin || capabilities.can('workspace.skills');

  await step('prompts and skills: lists read', async () => {
    const prompts = await listWorkspacePrompts(client, {});
    const skills = await listWorkspaceSkills(client, {});
    fixture.counts = { prompts: prompts.total, skills: skills.total };
    return `${prompts.total} prompts, ${skills.total} skills readable`;
  });

  if (!canPrompts) {
    await step('prompts: making one refused without the permission', async () => {
      const status = await statusOf(() => createWorkspacePrompt(client, { command: `mc-probe-${stamp}`, name: 'APP PROBE', content: 'x', tags: [] }));
      if (status === 200) throw new Error('a prompt was made without workspace.prompts');
      return `refused (${status})`;
    });
  } else {
    let id = '';
    try {
      await step('prompts: versions, a clash, renamed, off and on, deleted', async () => {
        const made = await createWorkspacePrompt(client, { command: `mc-probe-${stamp}`, name: 'APP PROBE prompt', content: 'Version A about {{topic}}', tags: ['mc-probe'] });
        id = made.id;
        let prompt = await saveWorkspacePromptVersion(client, await getWorkspacePrompt(client, id), { content: 'Version B', commitMessage: 'B, live', live: true });
        prompt = await saveWorkspacePromptVersion(client, await getWorkspacePrompt(client, id), { content: 'Version C', commitMessage: 'C, not live', live: false });
        const afterNotLive = await getWorkspacePrompt(client, id);
        fixture.notLiveChangesText = afterNotLive.content === 'Version C';
        const versions = await listPromptVersions(client, id);
        fixture.versions = versions.length;
        // Found by its text: versions saved in the same second tie on time.
        const first = versions.find((version) => version.content === 'Version A about {{topic}}');
        if (!first) throw new Error('the first version wasn’t listed');
        prompt = await makePromptVersionLive(client, id, first.id);
        if (prompt.content !== 'Version A about {{topic}}') throw new Error(`making the first version live gave "${prompt.content}"`);
        const notLive = versions.find((version) => version.id !== prompt.versionId && version.id !== first.id);
        if (notLive) await deletePromptVersion(client, id, notLive.id);
        fixture.liveDelete = await statusOf(() => deletePromptVersion(client, id, prompt.versionId));
        const clash = await statusOf(() => createWorkspacePrompt(client, { command: `mc-probe-${stamp}`, name: 'APP PROBE clash', content: 'x', tags: [] }));
        if (clash !== 400) throw new Error(`a taken command gave ${clash}, not 400`);
        prompt = await updateWorkspacePromptMeta(client, id, { name: 'APP PROBE prompt, renamed', command: `mc-probe-${stamp}-b`, tags: [] });
        if (prompt.command !== `mc-probe-${stamp}-b`) throw new Error('the new command didn’t take');
        prompt = await toggleWorkspacePrompt(client, id);
        if (prompt.isActive) throw new Error('switching it off didn’t take');
        prompt = await toggleWorkspacePrompt(client, id);
        return `${fixture.versions} versions; a not-live save ${fixture.notLiveChangesText ? 'still changed the text (as 0.11.3 does)' : 'left the text'}; the first made live again; the live one can't be deleted (${String(fixture.liveDelete)}); a taken command 400; renamed; off and on`;
      });
    } finally {
      if (id) await deleteWorkspacePrompt(client, id).catch(() => undefined);
    }
    if (id) {
      await step('prompts: the probe prompt is gone', async () => {
        const status = await statusOf(() => getWorkspacePrompt(client, id));
        if (status === 200) throw new Error('still there');
        return `reading it gives ${status}`;
      });
    }
  }

  if (!canSkills) {
    await step('skills: making one refused without the permission', async () => {
      const status = await statusOf(() => createWorkspaceSkill(client, { id: `mc-probe-${stamp}`, name: `APP PROBE ${stamp}`, description: '', content: '# x', tags: [], isActive: true }));
      if (status === 200) throw new Error('a skill was made without workspace.skills');
      return `refused (${status})`;
    });
  } else {
    let id = '';
    try {
      await step('skills: made, kept off through a save, a name clash, deleted', async () => {
        const made = await createWorkspaceSkill(client, { id: `mc-probe-skill-${stamp}`, name: `APP PROBE skill ${stamp}`, description: 'APP PROBE', content: '---\nname: probe\n---\n\n# Probe', tags: ['mc-probe'], isActive: true });
        id = made.id;
        let skill = await getWorkspaceSkill(client, id);
        if (!skill.content?.includes('# Probe')) throw new Error('the text didn’t read back');
        skill = await toggleWorkspaceSkill(client, id);
        if (skill.isActive) throw new Error('switching it off didn’t take');
        const full = await getWorkspaceSkill(client, id);
        await updateWorkspaceSkill(client, { id, name: full.name, description: 'APP PROBE, changed', content: full.content ?? '', tags: full.tags, isActive: full.isActive, meta: full.meta });
        skill = await getWorkspaceSkill(client, id);
        if (skill.isActive || skill.description !== 'APP PROBE, changed') throw new Error('a save switched it back on, or lost the change');
        const clash = await statusOf(() => createWorkspaceSkill(client, { id: `mc-probe-skill-${stamp}-b`, name: `APP PROBE skill ${stamp}`, description: '', content: '# x', tags: [], isActive: true }));
        fixture.skillNameClash = clash;
        if (clash === 200) {
          await deleteWorkspaceSkill(client, `mc-probe-skill-${stamp}-b`).catch(() => undefined);
          throw new Error('a taken name was accepted');
        }
        return `kept off through a save; a taken name refused (${clash})`;
      });
      if (id && (capabilities.isAdmin || capabilities.can('workspace.skills_export'))) {
        await step('skills: an export imports again as a new skill', async () => {
          // The web's export file, read the way the app imports it, then made again under a new id and name.
          const found = skillsFromImport(await exportWorkspaceSkills(client)).skills.find((skill) => skill.id === id);
          if (!found) throw new Error('the probe skill wasn’t in the export');
          if (!found.content.includes('# Probe') || found.isActive || !found.tags.includes('mc-probe')) throw new Error('the export lost its text, its off switch or its tags');
          const copyId = `${id}-import`;
          try {
            await createWorkspaceSkill(client, { ...found, id: copyId, name: `${found.name} import` });
            const copy = await getWorkspaceSkill(client, copyId);
            if (copy.isActive || !copy.content?.includes('# Probe') || copy.accessGrants.length) throw new Error('the imported copy came in on, without its text, or shared');
          } finally {
            await deleteWorkspaceSkill(client, copyId).catch(() => undefined);
          }
          return 'read back with its text, off and tagged; made again private, then deleted';
        });
      }
    } finally {
      if (id) await deleteWorkspaceSkill(client, id).catch(() => undefined);
    }
  }
  return { steps, fixture };
}
