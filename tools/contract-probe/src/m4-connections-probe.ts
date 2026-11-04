import {
  connectionKindOn,
  connectionsOf,
  getConnectionConfig,
  getConnectionSwitches,
  OwuiHttpError,
  saveConnectionConfig,
  withConnectionAdded,
  withConnectionChange,
  withConnectionRemoved,
  withKindOn,
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

/** Model ids the server lists right now (no provider is asked for a connection with a fixed list). */
async function modelIds(client: OwuiClient): Promise<string[]> {
  const body = await client.get<{ data?: { id?: unknown }[] }>('/api/models', { query: { refresh: true } });
  return (body.data ?? []).flatMap((model) => (typeof model.id === 'string' ? [model.id] : []));
}

/**
 * M4.3: admin connections. A non-admin is refused the connection config. Only on the scratch
 * instance: with the kind on and every existing connection off (so no outside provider is asked),
 * a connection to a closed local port with a fixed model list added, its model listed with its
 * prefix, switched off (its model gone), taken out; then the config put back exactly as it was.
 */
export async function probeM4Connections({ client, capabilities, allowWrites }: { client: OwuiClient; capabilities: Capabilities; allowWrites: boolean }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
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
    await step('admin connections: refused to a non-admin', async () => {
      const status = await statusOf(() => getConnectionConfig(client, 'openai'));
      if (status === 200) throw new Error('a non-admin read the connections');
      return `refused (${status})`;
    });
    return { steps, fixture };
  }

  await step('admin connections: both kinds and the switches read', async () => {
    const openai = await getConnectionConfig(client, 'openai');
    const ollama = await getConnectionConfig(client, 'ollama');
    const switches = await getConnectionSwitches(client);
    fixture.counts = { openai: connectionsOf(openai, 'openai').length, ollama: connectionsOf(ollama, 'ollama').length, openaiOn: connectionKindOn(openai, 'openai'), ollamaOn: connectionKindOn(ollama, 'ollama'), ...switches };
    return `${connectionsOf(openai, 'openai').length} OpenAI-compatible (${connectionKindOn(openai, 'openai') ? 'on' : 'off'}), ${connectionsOf(ollama, 'ollama').length} Ollama (${connectionKindOn(ollama, 'ollama') ? 'on' : 'off'})`;
  });

  if (!allowWrites) return { steps, fixture };

  const before = await getConnectionConfig(client, 'openai');
  const probeUrl = 'http://127.0.0.1:9/v1';
  try {
    await step('admin connections: an offline connection added, switched off, taken out; the config as it was', async () => {
      // The kind on, every connection already there off: listing models then asks no outside provider.
      let start = withKindOn(before, 'openai', true);
      for (const connection of connectionsOf(before, 'openai')) start = withConnectionChange(start, 'openai', connection.index, { settings: { enable: false } });
      await saveConnectionConfig(client, 'openai', start);
      await saveConnectionConfig(client, 'openai', withConnectionAdded(await getConnectionConfig(client, 'openai'), 'openai', { url: probeUrl, key: 'not-a-real-key', settings: { model_ids: ['probe-model'], prefix_id: 'appprobe', tags: [{ name: 'probe' }] } }));
      const added = await getConnectionConfig(client, 'openai');
      const mine = connectionsOf(added, 'openai').find((connection) => connection.url === probeUrl);
      if (!mine || mine.key !== 'not-a-real-key' || mine.config.prefix_id !== 'appprobe') throw new Error('it didn’t read back as added');
      const listed = (await modelIds(client)).includes('appprobe.probe-model');
      fixture.listedWithPrefix = listed;
      if (!listed) throw new Error('its fixed model wasn’t listed with its prefix');
      await saveConnectionConfig(client, 'openai', withConnectionChange(added, 'openai', mine.index, { settings: { enable: false } }));
      const off = await getConnectionConfig(client, 'openai');
      if (connectionsOf(off, 'openai')[mine.index]?.enabled !== false) throw new Error('switching it off didn’t take');
      const gone = !(await modelIds(client)).includes('appprobe.probe-model');
      fixture.goneWhenOff = gone;
      const removed = withConnectionRemoved(off, 'openai', mine.index);
      if (JSON.stringify(removed.OPENAI_API_BASE_URLS) !== JSON.stringify(start.OPENAI_API_BASE_URLS)) throw new Error('taking it out left a different list');
      await saveConnectionConfig(client, 'openai', removed);
      await saveConnectionConfig(client, 'openai', before);
      const after = await getConnectionConfig(client, 'openai');
      const differs = Object.keys({ ...before, ...after }).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
      fixture.leftAfterRestore = differs;
      if (differs.length) throw new Error(`after putting it back these differ: ${differs.join(', ')}`);
      return `added: its fixed model listed as appprobe.probe-model; off: ${gone ? 'gone from the list' : 'still listed'}; taken out; the config put back exactly`;
    });
  } finally {
    const now = await getConnectionConfig(client, 'openai').catch(() => null);
    if (now && JSON.stringify(now) !== JSON.stringify(before)) await saveConnectionConfig(client, 'openai', before).catch(() => undefined);
  }
  return { steps, fixture };
}
