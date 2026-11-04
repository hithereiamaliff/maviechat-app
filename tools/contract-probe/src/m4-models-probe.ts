import {
  connectionsOf,
  deleteWorkspaceModel,
  getConnectionConfig,
  getModelsConfig,
  idsOf,
  listAdminModels,
  OwuiHttpError,
  saveConnectionConfig,
  saveModelsConfig,
  setAdminModelActive,
  setAdminModelHidden,
  withConnectionAdded,
  withConnectionChange,
  withKindOn,
  withListedModel,
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

const inUse = async (client: OwuiClient) => ((await client.get<{ data?: { id?: unknown }[] }>('/api/models', { query: { refresh: true } })).data ?? []).map((model) => model.id);
const same = (a: Record<string, unknown>, b: Record<string, unknown>) => JSON.stringify(a) === JSON.stringify(b);

/**
 * M4.4: admin models. A non-admin is refused the admin model list. Only on the scratch instance,
 * with an offline connection giving one model (no provider asked): the model listed without a
 * saved row; switched off (a row made, as the web does; it leaves the list in use), back on,
 * hidden and shown; made a default and pinned for everyone, then the models settings put back
 * exactly; its row deleted and the connections put back exactly.
 */
export async function probeM4Models({ client, capabilities, allowWrites }: { client: OwuiClient; capabilities: Capabilities; allowWrites: boolean }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const step = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };

  if (!capabilities.isAdmin) {
    await step('admin models: the models settings refused to a non-admin', async () => {
      const status = await statusOf(() => getModelsConfig(client));
      if (status === 200) throw new Error('a non-admin read the models settings');
      return `refused (${status})`;
    });
    return { steps, fixture };
  }
  if (!allowWrites) return { steps, fixture };

  const connections = await getConnectionConfig(client, 'openai');
  const modelsConfig = await getModelsConfig(client);
  const id = 'appprobe.probe-model';
  try {
    let start = withKindOn(connections, 'openai', true);
    for (const connection of connectionsOf(connections, 'openai')) start = withConnectionChange(start, 'openai', connection.index, { settings: { enable: false } });
    await saveConnectionConfig(client, 'openai', withConnectionAdded(start, 'openai', { url: 'http://127.0.0.1:9/v1', key: '', settings: { model_ids: ['probe-model'], prefix_id: 'appprobe' } }));

    await step('admin models: listed, switched off and on, hidden and shown', async () => {
      const find = async () => (await listAdminModels(client)).find((model) => model.id === id);
      const first = await find();
      if (!first || first.hasRow || !first.isActive) throw new Error('the probe model wasn’t listed as on, without a row');
      await setAdminModelActive(client, first, false);
      const off = await find();
      if (!off || !off.hasRow || off.isActive) throw new Error('switching it off didn’t make an off row');
      if ((await inUse(client)).includes(id)) throw new Error('an off model was still in use');
      await setAdminModelActive(client, off, true);
      if (!(await inUse(client)).includes(id)) throw new Error('switching it back on didn’t take');
      await setAdminModelActive(client, off, true);
      if (!(await find())?.isActive) throw new Error('switching on twice flipped it');
      const on = await find();
      if (!on) throw new Error('it went missing');
      await setAdminModelHidden(client, on, true);
      if (!(await find())?.hidden) throw new Error('hiding didn’t take');
      await setAdminModelHidden(client, on, false);
      if ((await find())?.hidden || !(await find())?.isActive) throw new Error('showing it again changed something else');
      return 'listed without a row; off made a row and took it out of use; on again (twice is still on); hidden and shown, still on';
    });

    await step('admin models: a default and pinned for everyone, then the settings put back exactly', async () => {
      await saveModelsConfig(client, withListedModel(withListedModel(await getModelsConfig(client), 'DEFAULT_MODELS', id, true), 'DEFAULT_PINNED_MODELS', id, true));
      const changed = await getModelsConfig(client);
      if (!idsOf(changed.DEFAULT_MODELS).includes(id) || !idsOf(changed.DEFAULT_PINNED_MODELS).includes(id)) throw new Error('it wasn’t made a default and pinned');
      const others = ['MODEL_ORDER_LIST', 'DEFAULT_MODEL_METADATA', 'DEFAULT_MODEL_PARAMS'].filter((key) => JSON.stringify(changed[key]) !== JSON.stringify(modelsConfig[key]));
      if (others.length) throw new Error(`these changed too: ${others.join(', ')}`);
      await saveModelsConfig(client, modelsConfig);
      if (!same(await getModelsConfig(client), modelsConfig)) throw new Error('putting them back left a difference');
      return 'made a default and pinned, the other three settings untouched; put back exactly';
    });
  } finally {
    await deleteWorkspaceModel(client, id).catch(() => undefined);
    if (!same(await getModelsConfig(client).catch(() => modelsConfig), modelsConfig)) await saveModelsConfig(client, modelsConfig).catch(() => undefined);
    await saveConnectionConfig(client, 'openai', connections).catch(() => undefined);
  }
  await step('admin models: the probe’s row and connection are gone', async () => {
    const now = await getConnectionConfig(client, 'openai');
    if (!same(now, connections)) throw new Error('the connections weren’t put back exactly');
    const row = await statusOf(() => client.get<unknown>('/api/v1/models/model', { query: { id } }));
    if (row === 200) throw new Error('its saved row is still there');
    return `connections as before; its row reads ${row}`;
  });
  return { steps, fixture };
}
