import {
  createWorkspaceModel,
  deleteWorkspaceModel,
  exportWorkspaceModels,
  getWorkspaceModel,
  listModels,
  listWorkspaceModels,
  modelFormOf,
  OwuiHttpError,
  setWorkspaceModelHidden,
  toggleWorkspaceModel,
  updateWorkspaceModel,
  workspaceModelTags,
  type Capabilities,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import { shapeOf } from './shape';
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
 * M3.1 against a live Open WebUI, as the test account, on its own private model only: the
 * workspace list and tags read; a probe model made on a base model (private), read back, changed
 * (sharing left out, so it stays as it was), switched off and kept off through a save, back on,
 * hidden and shown; export refused without the permission; deleted, and gone.
 */
export async function probeM3Models({ client, capabilities }: { client: OwuiClient; capabilities: Capabilities }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const step = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };

  await step('workspace models: list and tags', async () => {
    const page = await listWorkspaceModels(client, {});
    const tags = await workspaceModelTags(client);
    const raw = await client.get<{ items?: unknown[] }>('/api/v1/models/list', { query: { order_by: 'updated_at', direction: 'desc', page: 1 } });
    fixture.list = { total: page.total, item: shapeOf(raw.items?.[0], 3), tags: tags.length };
    return `${page.total} models readable; ${tags.length} tags`;
  });

  if (!capabilities.can('workspace.models')) {
    steps.push({ name: 'workspace models: make one', ok: true, note: 'skipped: this account may not make models' });
    return { steps, fixture };
  }
  const id = `mc-probe-${Date.now().toString(36)}`;
  let made = false;
  try {
    await step('workspace models: a private probe model made, changed, off and on, hidden and shown, deleted', async () => {
      const base = (await listModels(client)).find((model) => !(model.info as { base_model_id?: unknown } | null | undefined)?.base_model_id && model.connection_type !== 'direct' && !String(model.id).startsWith('arena'));
      if (!base) throw new Error('no base model to build on');
      const created = await createWorkspaceModel(client, { id, baseModelId: base.id, name: 'APP PROBE model', meta: { description: 'APP PROBE', tags: [{ name: 'mc-probe' }] }, params: { system: 'APP PROBE: answer in one word.' }, isActive: true });
      made = true;
      if (created.accessGrants.length) throw new Error('a new model wasn’t private');
      let model = await getWorkspaceModel(client, id);
      if (!model.writeAccess || model.baseModelId !== base.id || model.params.system !== 'APP PROBE: answer in one word.') throw new Error('the model didn’t read back as made');
      model = await updateWorkspaceModel(client, { ...modelFormOf(model), meta: { ...model.meta, description: 'APP PROBE, changed' } });
      if (model.description !== 'APP PROBE, changed' || !model.tags.includes('mc-probe')) throw new Error('the change didn’t keep the rest');
      model = await toggleWorkspaceModel(client, id);
      if (model.isActive) throw new Error('switching it off didn’t take');
      model = await updateWorkspaceModel(client, { ...modelFormOf(await getWorkspaceModel(client, id)), meta: { ...model.meta, description: 'APP PROBE, saved while off' } });
      if (model.isActive) throw new Error('a save switched it back on');
      model = await toggleWorkspaceModel(client, id);
      if (!model.isActive) throw new Error('switching it back on didn’t take');
      model = await setWorkspaceModelHidden(client, id, true);
      const picker = (await listModels(client)).find((item) => item.id === id);
      fixture.hiddenInPicker = picker ? (picker.info?.meta?.hidden === true ? 'listed, marked hidden' : 'listed, not marked') : 'not listed';
      if (!model.hidden) throw new Error('hiding it didn’t take');
      model = await setWorkspaceModelHidden(client, id, false);
      if (model.hidden) throw new Error('showing it again didn’t take');
      return `${base.id} as the base; a save while off kept it off; hidden: ${String(fixture.hiddenInPicker)}`;
    });
    await step('workspace models: export needs its permission', async () => {
      const status = await statusOf(() => exportWorkspaceModels(client));
      fixture.export = status;
      if (capabilities.can('workspace.models_export')) return `allowed (${status})`;
      if (status === 200) throw new Error('export worked without the permission');
      return `refused (${status})`;
    });
  } finally {
    if (made) await deleteWorkspaceModel(client, id).catch(() => undefined);
  }
  await step('workspace models: the probe model is gone', async () => {
    const status = await statusOf(() => getWorkspaceModel(client, id));
    if (status === 200) throw new Error('the probe model is still there');
    fixture.afterDelete = status;
    return `reading it gives ${status}`;
  });
  return { steps, fixture };
}
