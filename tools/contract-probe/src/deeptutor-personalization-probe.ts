import {
  connectAgent,
  createPersona,
  createSkill,
  createSkillTag,
  deletePersona,
  deleteSkill,
  deleteSkillTag,
  disconnectAgent,
  DtHttpError,
  getAuthStatus,
  getCliApps,
  getPersona,
  getSkill,
  joinFrontMatter,
  listAgentConnections,
  listKnowledgeBases,
  listKnowledgeCenter,
  listPersonas,
  listSkills,
  listSkillTags,
  renameSkillTag,
  setCliAppEnabled,
  skillUsage,
  splitFrontMatter,
  updatePersona,
  updateSkill,
  type DtClient,
} from '@maviechat/deeptutor-protocol';

/** The HTTP status a call ends with (200 when it works). */
async function statusOf(run: () => Promise<unknown>): Promise<number> {
  try {
    await run();
    return 200;
  } catch (error) {
    if (error instanceof DtHttpError) return error.status;
    throw error;
  }
}

/**
 * B7.1 against a live DeepTutor, in the test account, its own data only: personas (the presets
 * read-only; one made, a duplicate and a bad name refused, changed, renamed, deleted), skills
 * (built-ins read-only; one made with a probe tag; a setting in its header kept through a body
 * edit; description and tags changed without touching the file; the tag renamed and deleted on it;
 * renamed; deleted), an agent connection (no folder, nothing runs) kept out of both knowledge-base
 * lists, then deleted; CLI apps read, and switching an unknown one refused. Nothing outside
 * DeepTutor is contacted and no model is used.
 */
export async function probePersonalization(client: DtClient): Promise<{ note: string; fixture: Record<string, unknown> }> {
  const fixture: Record<string, unknown> = {};
  const auth = await getAuthStatus(client);
  if (auth.learning_policy) throw new Error('the test account is a learner, so DeepTutor refuses every Personalization call');
  const stamp = Date.now().toString(36);

  // ── Personas ──
  const personas = await listPersonas(client);
  const presets = personas.filter((persona) => persona.preset);
  if (presets.some((preset) => !preset.readOnly)) throw new Error('a preset persona came back editable');
  fixture.personas = { count: personas.length, presets: presets.map((preset) => preset.name) };
  if (presets[0]) {
    const file = splitFrontMatter((await getPersona(client, presets[0].name)).content);
    fixture.presetFile = { header: Boolean(file.header), body: file.body.length > 0 };
    fixture.presetEdit = await statusOf(() => updatePersona(client, presets[0]!.name, { description: 'APP PROBE' }));
    if (fixture.presetEdit === 200) throw new Error('the test account could change a preset persona');
  }
  const personaFirst = `mc-probe-${stamp}`;
  let persona = '';
  try {
    persona = (await createPersona(client, { name: personaFirst, description: 'APP PROBE persona', content: '# Probe\n\nAnswer in one short sentence.' })).name;
    fixture.personaDuplicate = await statusOf(() => createPersona(client, { name: personaFirst, description: '', content: '' }));
    if (fixture.personaDuplicate !== 409) throw new Error(`a second persona of the same name gave ${String(fixture.personaDuplicate)}, not 409`);
    fixture.personaBadName = await statusOf(() => createPersona(client, { name: 'Bad Name', description: '', content: '' }));
    if (fixture.personaBadName === 200) throw new Error('a persona named "Bad Name" was accepted');
    const made = await getPersona(client, persona);
    if (!made.content.includes('Answer in one short sentence.') || !splitFrontMatter(made.content).header.includes('APP PROBE persona')) throw new Error('the new persona did not read back with its header and body');
    await updatePersona(client, persona, { description: 'APP PROBE persona, changed', content: '# Probe\n\nChanged.' });
    persona = (await updatePersona(client, persona, { renameTo: `${personaFirst}-b` })).name;
    if (persona !== `${personaFirst}-b`) throw new Error('renaming the persona did not take');
    const changed = await getPersona(client, persona);
    if (changed.description !== 'APP PROBE persona, changed' || !changed.content.includes('Changed.')) throw new Error('the changed persona did not read back');
  } finally {
    if (persona) await deletePersona(client, persona).catch(() => undefined);
  }
  if ((await listPersonas(client)).some((row) => row.name.startsWith('mc-probe-'))) throw new Error('a probe persona was left behind');

  // ── Skills and tags ──
  const skills = await listSkills(client);
  fixture.skills = { count: skills.length, builtin: skills.filter((skill) => skill.source === 'builtin').map((skill) => skill.name), assigned: skills.filter((skill) => skill.assigned).length };
  const builtin = skills.find((skill) => skill.name === 'skill-creator') ?? skills.find((skill) => skill.source === 'builtin');
  if (builtin) {
    const file = splitFrontMatter((await getSkill(client, builtin.name)).content);
    fixture.builtinFile = { header: Boolean(file.header), body: file.body.length };
    fixture.builtinEdit = await statusOf(() => updateSkill(client, builtin.name, { description: 'APP PROBE' }));
    if (fixture.builtinEdit === 200) throw new Error('a built-in skill could be changed');
  }
  let tag = '';
  let skill = '';
  try {
    tag = await createSkillTag(client, `mc probe ${stamp}`);
    if (!(await listSkillTags(client)).includes(tag)) throw new Error('the new tag was not listed');
    skill = (await createSkill(client, { name: `mc-probe-skill-${stamp}`, description: 'APP PROBE skill', content: '# Probe skill\n\nNothing to do.', tags: [tag] })).name;
    let file = await getSkill(client, skill);
    if (!file.tags.includes(tag) || !splitFrontMatter(file.content).header) throw new Error('the new skill did not read back with its tag and a header');
    const first = splitFrontMatter(file.content);
    await updateSkill(client, skill, { content: joinFrontMatter({ header: first.header.replace(/\r?\n---[ \t]*\r?\n?$/, '\nmc_probe_setting: kept\n---\n'), body: first.body }) });
    const again = splitFrontMatter((await getSkill(client, skill)).content);
    await updateSkill(client, skill, { content: joinFrontMatter({ header: again.header, body: '# Probe skill\n\nChanged.' }) });
    file = await getSkill(client, skill);
    if (!file.content.includes('mc_probe_setting: kept') || !file.content.includes('Changed.')) throw new Error('a setting in the header did not survive an edit of the body');
    await updateSkill(client, skill, { description: 'APP PROBE skill, changed', tags: [] });
    file = await getSkill(client, skill);
    if (file.tags.length || file.description !== 'APP PROBE skill, changed' || !file.content.includes('mc_probe_setting: kept')) throw new Error('changing only the description and tags touched more');
    await updateSkill(client, skill, { tags: [tag] });
    const renamedTag = `${tag} b`;
    tag = await renameSkillTag(client, tag, renamedTag);
    if (!(await getSkill(client, skill)).tags.includes(renamedTag)) throw new Error('renaming the tag did not reach the skill');
    fixture.usage = (await skillUsage(client, skill)).length;
    skill = (await updateSkill(client, skill, { renameTo: `${skill}-b` })).name;
    if (!skill.endsWith('-b')) throw new Error('renaming the skill did not take');
    await deleteSkillTag(client, tag);
    tag = '';
    if ((await getSkill(client, skill)).tags.length) throw new Error('deleting the tag left it on the skill');
  } finally {
    if (skill) await deleteSkill(client, skill).catch(() => undefined);
    if (tag) await deleteSkillTag(client, tag).catch(() => undefined);
  }
  if ((await listSkills(client)).some((row) => row.name.startsWith('mc-probe-'))) throw new Error('a probe skill was left behind');
  if ((await listSkillTags(client)).some((row) => row.startsWith('mc probe'))) throw new Error('a probe tag was left behind');

  // ── An agent connection is not a knowledge base ──
  const connections = await listAgentConnections(client);
  fixture.connections = connections === null ? 'knowledge module off' : connections.length;
  if (connections !== null) {
    const agent = `mc-probe-agent-${stamp}`;
    let made = false;
    try {
      await connectAgent(client, { name: agent, kind: 'codex' });
      made = true;
      const raw = await client.get<unknown>('/api/knowledge-bases');
      if (!(Array.isArray(raw) && raw.some((row) => (row as { name?: unknown }).name === agent))) throw new Error('the connection is not among the raw knowledge bases, so the filter went untested');
      if ((await listKnowledgeBases(client)).some((kb) => kb.name === agent)) throw new Error("a connected agent showed up in the chat's knowledge bases");
      if ((await listKnowledgeCenter(client)).some((kb) => kb.name === agent)) throw new Error('a connected agent showed up in the Knowledge Center');
      if (!(await listAgentConnections(client))?.some((row) => row.name === agent && row.kind === 'codex')) throw new Error('the connection was not listed');
    } finally {
      if (made) await disconnectAgent(client, agent).catch(() => undefined);
    }
    if ((await listAgentConnections(client))?.some((row) => row.name === agent)) throw new Error('the probe connection was left behind');
  }

  // ── CLI apps ──
  const cli = await getCliApps(client);
  fixture.cliApps = { apps: cli.apps.length, unrestricted: cli.unrestricted, execDenied: cli.execDenied };
  fixture.cliUnknown = await statusOf(() => setCliAppEnabled(client, `mc-probe-${stamp}`, false));
  if (fixture.cliUnknown !== 404) throw new Error(`switching an unknown CLI app gave ${String(fixture.cliUnknown)}, not 404`);

  const note = `${personas.length} personas (${presets.length} presets, read-only); one made, refused twice, changed, renamed, deleted; ${skills.length} skills (${(fixture.skills as { builtin: string[] }).builtin.length} built-in, read-only); one made with a probe tag, a header setting kept through a body edit, tag renamed and deleted on it, renamed, deleted; a codex connection kept out of both knowledge-base lists, then deleted; ${cli.apps.length} CLI apps, an unknown one refused`;
  return { note, fixture };
}
