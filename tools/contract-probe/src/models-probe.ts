import {
  createWorkspaceModel,
  customParamsOf,
  deleteWorkspaceModel,
  exportWorkspaceModels,
  getUserSettings,
  getWorkspaceModel,
  importWorkspaceModel,
  listAllWorkspaceModels,
  listModels,
  listServerVoices,
  listTerminals,
  modelFormOf,
  modelsFromImport,
  pinnedModelIds,
  saveUiSettings,
  setWorkspaceModelActive,
  setWorkspaceModelHidden,
  terminalIdOf,
  togglePinnedModel,
  ttsVoiceOf,
  updateUserSettings,
  updateWorkspaceModel,
  uiPatch,
  uuidv4,
  withCustomParams,
  withTerminalAndVoice,
  type Capabilities,
  type OwuiClient,
  type UserSettings,
  type WorkspaceModel,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

const rawSettings = (client: OwuiClient) => client.get<UserSettings | null>('/api/v1/users/user/settings?raw=true').then((settings) => settings ?? {});

/**
 * The Workspace models slice, as the test account, on its own private probe models only (made
 * here, all deleted afterwards): a model's terminal and voice saved the web's way and cleared;
 * the server's voices and the account's terminals counted; the "… All" actions (on, off, shown,
 * hidden) on just the probe models, found by a made-up word as the list's search finds them;
 * import from the app's export, the server's export (made private) and an older `{id, info}`
 * export (changing the model it names), and one whose id is taken refused; Keep in Sidebar and
 * custom parameters in your settings, put back as they were.
 */
export async function probeModels({ client, capabilities }: { client: OwuiClient; capabilities: Capabilities }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };

  await check('what the editor offers: terminals and the server’s voices', async () => {
    const terminals = await listTerminals(client);
    let voices: number | string;
    try {
      voices = (await listServerVoices(client)).length;
    } catch (error) {
      voices = `none (${error instanceof Error ? error.message : String(error)})`;
    }
    fixture.offers = { terminals: terminals.length, voices };
    return `${terminals.length} terminal${terminals.length === 1 ? '' : 's'}; voices: ${voices}`;
  });

  if (!capabilities.isAdmin && !capabilities.can('workspace.models')) {
    steps.push({ name: 'probe models', ok: true, note: 'skipped: this account may not make models' });
    return { steps, fixture };
  }

  const word = `mcprobe${uuidv4().replace(/-/g, '').slice(0, 8)}`;
  const made = new Set<string>();
  const ids = { a: `${word}-a`, b: `${word}-b`, c: `${word}-c`, d: `${word}-d` };
  let original: UserSettings | null = null;
  // A model to build on. A server without connections has none: an admin's model may then name a
  // made-up one (one with no base at all isn't a workspace model, and the list leaves it out).
  const base = (await listModels(client)).find((model) => !(model.info as { base_model_id?: unknown } | null | undefined)?.base_model_id && model.connection_type !== 'direct' && !String(model.id).startsWith('arena'));
  if (!base && !capabilities.isAdmin) {
    steps.push({ name: 'probe models', ok: true, note: 'skipped: this account sees no model to build on' });
    return { steps, fixture };
  }
  fixture.base = base ? 'a base model' : 'a made-up one (admin, no models)';
  try {
    for (const [key, id] of [['A', ids.a], ['B', ids.b]] as const) {
      await createWorkspaceModel(client, { id, baseModelId: base?.id ?? 'mc-probe-base', name: `APP PROBE ${word} ${key}`, meta: { description: 'APP PROBE' }, params: {}, isActive: true, accessGrants: [] });
      made.add(id);
    }

    await check('a model’s terminal and voice saved as the web saves them, then cleared', async () => {
      const terminal = (await listTerminals(client))[0]?.id ?? 'mc-probe-terminal';
      const model = await getWorkspaceModel(client, ids.a);
      await updateWorkspaceModel(client, { ...modelFormOf(model), meta: withTerminalAndVoice({ ...model.meta, tts: { speed: 1 } }, terminal, 'alloy') });
      const back = await getWorkspaceModel(client, ids.a);
      if (terminalIdOf(back.meta) !== terminal || ttsVoiceOf(back.meta) !== 'alloy') throw new Error(`read back ${JSON.stringify({ terminalId: back.meta.terminalId, tts: back.meta.tts })}`);
      await updateWorkspaceModel(client, { ...modelFormOf(back), meta: withTerminalAndVoice(back.meta, '', '') });
      const cleared = await getWorkspaceModel(client, ids.a);
      fixture.clearedTts = cleared.meta.tts ?? null;
      if ('terminalId' in cleared.meta || ttsVoiceOf(cleared.meta)) throw new Error('clearing them left them');
      if (JSON.stringify(cleared.meta.tts) !== JSON.stringify({ speed: 1 })) throw new Error(`the other speech setting wasn’t kept (${JSON.stringify(cleared.meta.tts)})`);
      return `kept and read back; cleared, with the model’s other speech setting kept`;
    });

    await check('the “… All” actions on the models the list’s search finds', async () => {
      const found = await listAllWorkspaceModels(client, { query: word });
      const probes = found.filter((model) => model.id === ids.a || model.id === ids.b);
      fixture.bulkFound = { found: found.length, probes: probes.length };
      if (probes.length !== 2 || found.length !== 2) throw new Error(`the search found ${found.length} (${probes.length} probe models)`);
      const all = async () => (await listAllWorkspaceModels(client, { query: word })).filter((model) => made.has(model.id));
      const each = async (run: (model: WorkspaceModel) => Promise<unknown>) => {
        for (const model of await all()) await run(model);
      };
      await each((model) => setWorkspaceModelActive(client, model.id, false));
      if ((await all()).some((model) => model.isActive)) throw new Error('Turn All Off left one on');
      await each((model) => setWorkspaceModelActive(client, model.id, false));
      if ((await all()).some((model) => model.isActive)) throw new Error('turning off what was off switched it on');
      await each((model) => setWorkspaceModelActive(client, model.id, true));
      if ((await all()).some((model) => !model.isActive)) throw new Error('Turn All On left one off');
      await each((model) => setWorkspaceModelHidden(client, model.id, true));
      if ((await all()).some((model) => !model.hidden)) throw new Error('Hide All left one shown');
      await each((model) => setWorkspaceModelHidden(client, model.id, false));
      const after = await all();
      if (after.some((model) => model.hidden || !model.isActive)) throw new Error('Show All left one hidden');
      if (after.some((model) => model.accessGrants.length)) throw new Error('a probe model got shared');
      return 'found both (and nothing else) by the word; off (twice, still off), on, hidden and shown; still private';
    });

    await check('import: the app’s export and the server’s, each made new and private', async () => {
      const a = await getWorkspaceModel(client, ids.a);
      const appRow = { id: ids.c, base_model_id: a.baseModelId, name: `APP PROBE ${word} C`, meta: { ...a.meta, description: 'APP PROBE imported' }, params: { temperature: 0.4 }, is_active: true };
      let serverRow: Record<string, unknown> | null = null;
      if (capabilities.isAdmin || capabilities.can('workspace.models_export')) {
        const exported = (await exportWorkspaceModels(client)).find((row) => (row as { id?: unknown }).id === ids.b) as Record<string, unknown> | undefined;
        if (!exported) throw new Error('the server’s export left out a probe model');
        serverRow = { ...exported, id: ids.d, name: `APP PROBE ${word} D`, access_grants: [{ principal_type: 'user', principal_id: '*', permission: 'read' }] };
      }
      const { models, skipped } = modelsFromImport([appRow, ...(serverRow ? [serverRow] : []), { id: 'no-name' }], new Set());
      if (skipped !== 1 || models.some((item) => item.update)) throw new Error(`read ${models.length} (${skipped} left out)`);
      for (const item of models) {
        await importWorkspaceModel(client, item);
        made.add(item.id);
      }
      const c = await getWorkspaceModel(client, ids.c);
      if (c.description !== 'APP PROBE imported' || c.params.temperature !== 0.4 || c.baseModelId !== a.baseModelId) throw new Error('the app’s export didn’t come in as it was');
      if (c.accessGrants.length) throw new Error('an imported model wasn’t private');
      if (serverRow) {
        const d = await getWorkspaceModel(client, ids.d);
        if (d.accessGrants.length) throw new Error('the file’s sharing came in with it');
        if (d.name !== `APP PROBE ${word} D`) throw new Error('the server’s export didn’t come in');
      }
      return `made ${models.length} (${serverRow ? 'the app’s and the server’s exports' : 'the app’s export; this account may not export'}), private; an entry without a name left out`;
    });

    await check('import: an older `{id, info}` export changes the model it names; a taken id is refused', async () => {
      const a = await getWorkspaceModel(client, ids.a);
      const older = { id: ids.a, info: { id: ids.a, base_model_id: a.baseModelId, name: `APP PROBE ${word} A, imported`, meta: { ...a.meta, description: 'APP PROBE from an older export' }, params: {}, is_active: true } };
      const taken = { id: ids.b, name: 'APP PROBE taken', base_model_id: a.baseModelId, meta: {}, params: {} };
      const { models } = modelsFromImport([older, taken], new Set([ids.a]));
      if (!models[0]?.update || models[1]?.update) throw new Error('the older row wasn’t read as a change');
      await importWorkspaceModel(client, models[0]);
      const changed = await getWorkspaceModel(client, ids.a);
      if (changed.name !== `APP PROBE ${word} A, imported` || changed.description !== 'APP PROBE from an older export') throw new Error('the model wasn’t changed');
      if (changed.accessGrants.length) throw new Error('its sharing changed');
      let refused = '';
      try {
        await importWorkspaceModel(client, models[1] as (typeof models)[number]);
      } catch (error) {
        refused = error instanceof Error ? error.message : String(error);
      }
      fixture.takenRefusal = refused ? 'refused' : 'made';
      if (!refused) throw new Error('a model whose id is taken was made');
      if ((await getWorkspaceModel(client, ids.b)).name !== `APP PROBE ${word} B`) throw new Error('the taken model was changed');
      return 'the named model took the file’s version, sharing kept; the taken id was refused, the model left as it was';
    });

    original = await rawSettings(client);
    await check('Keep in Sidebar, and custom parameters in your settings', async () => {
      const before = pinnedModelIds(await getUserSettings(client), undefined);
      await saveUiSettings(client, { pinnedModels: togglePinnedModel(before, ids.a) });
      const kept = pinnedModelIds(await getUserSettings(client), undefined);
      if (!kept.includes(ids.a) || kept.length !== before.length + 1) throw new Error('the model wasn’t kept in the sidebar');
      await saveUiSettings(client, { pinnedModels: togglePinnedModel(kept, ids.a) });
      if (pinnedModelIds(await getUserSettings(client), undefined).includes(ids.a)) throw new Error('Hide from Sidebar didn’t take it out');
      const params = ((await getUserSettings(client)).ui?.params ?? {}) as Record<string, unknown>;
      await saveUiSettings(client, { params: withCustomParams(params, [{ name: 'mc_probe_param', value: '{"x":1}' }]) });
      const custom = customParamsOf(((await getUserSettings(client)).ui?.params ?? {}) as Record<string, unknown>);
      if (!custom.some((item) => item.name === 'mc_probe_param' && item.value === '{"x":1}')) throw new Error(`custom parameters read back as ${JSON.stringify(custom.map((item) => item.name))}`);
      return `kept and taken out again (${before.length} pinned before); a custom parameter saved and read back`;
    });
  } finally {
    if (original) {
      await check('settings put back as they were', async () => {
        const saved = original as UserSettings;
        await updateUserSettings(client, { ...saved, ui: uiPatch((await rawSettings(client)).ui, saved.ui ?? {}) });
        const now = await rawSettings(client);
        if (JSON.stringify(now.ui ?? {}) !== JSON.stringify(saved.ui ?? {})) throw new Error('the settings differ from before');
        return 'identical';
      });
    }
    for (const id of made) await deleteWorkspaceModel(client, id).catch(() => undefined);
  }

  await check('the probe models are gone', async () => {
    const left = (await listAllWorkspaceModels(client, { query: word })).length;
    fixture.left = left;
    if (left) throw new Error(`${left} left`);
    return `all ${made.size} deleted`;
  });
  return { steps, fixture };
}
