import {
  defaultSuggestionsOf,
  deleteWorkspaceModel,
  exportAdminModel,
  exportAdminModels,
  exportWorkspaceModels,
  fullModelOrder,
  getConfig,
  getModelsConfig,
  importAdminModels,
  listAdminModels,
  modelDefaultsOf,
  OwuiHttpError,
  rowsFromImport,
  saveDefaultSuggestions,
  saveModelsConfig,
  sameSuggestions,
  translatedLanguages,
  withListedOrder,
  withModelDefaults,
  withModelOrder,
  type Capabilities,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

type Tree = Record<string, unknown>;

const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const MODEL_KEYS = ['DEFAULT_MODELS', 'DEFAULT_PINNED_MODELS', 'MODEL_ORDER_LIST', 'DEFAULT_MODEL_METADATA', 'DEFAULT_MODEL_PARAMS'];
const modelSettings = (config: Tree) => JSON.stringify(MODEL_KEYS.map((key) => config[key] ?? null));

/**
 * Admin → Models' extras the app's way (admins; scratch servers, since they change everyone's
 * settings): the order over the config as read (ids not listed kept in place) and the pickers
 * following it; the defaults for every model (only what changed written, the rest as read) and
 * the models showing them; everyone's prompt suggestions (0.12's translations kept); importing a
 * throwaway model, changing it by a second import, exporting it, deleting it. The models settings
 * and the suggestions are put back exactly. Prints counts, never other settings' values.
 */
export async function probeAdminModels({ client, capabilities }: { client: OwuiClient; capabilities: Capabilities }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };

  if (!capabilities.isAdmin) {
    await check('refused for a non-admin', async () => {
      try {
        await getModelsConfig(client);
      } catch (error) {
        if (error instanceof OwuiHttpError && (error.status === 401 || error.status === 403)) return `skipped: HTTP ${error.status}`;
        throw error;
      }
      throw new Error('a non-admin read the models settings');
    });
    return { steps, fixture };
  }

  const before = await getModelsConfig(client);
  const suggestionsBefore = defaultSuggestionsOf(record(await getConfig(client)));
  const stamp = Date.now().toString(36);
  // With fewer than two models the pickers' order can't be seen: two throwaway workspace models on
  // the first one make it visible (and give a workspace model to export alone). Deleted after.
  const madeForOrder: string[] = [];
  const first = (await listAdminModels(client))[0];
  if (first && (await listAdminModels(client)).length < 2) {
    const presets = ['a', 'b'].map((letter) => ({ id: `app-probe-order-${letter}-${stamp}`, name: `APP PROBE order ${letter}`, base_model_id: first.id, meta: { description: 'made by the probe' }, params: {}, access_grants: [] }));
    await importAdminModels(client, presets);
    madeForOrder.push(...presets.map((preset) => preset.id));
  }
  const models = await listAdminModels(client);
  const ids = models.map((model) => model.id);
  fixture.before = { madeForOrder: madeForOrder.length, models: models.length, ordered: list(before.MODEL_ORDER_LIST).length, suggestions: suggestionsBefore.prompts?.length ?? 'built-in', translations: suggestionsBefore.translations === null ? '0.11 (none)' : translatedLanguages(suggestionsBefore).length };
  let changedSettings = false;
  let changedSuggestions = false;
  const importId = `app-probe-import-${stamp}`;
  let imported = false;

  try {
    await check('order: saved over the config as read, an id not listed kept in place, the pickers follow', async () => {
      // A made-up id stands for a model whose connection is away; the listed ones go in reverse.
      const ghost = `app-probe-away-${stamp}`;
      const fresh = await getModelsConfig(client);
      const order = fullModelOrder({ ...fresh, MODEL_ORDER_LIST: [ghost, ...list(fresh.MODEL_ORDER_LIST)] }, ids);
      const listed = order.filter((id) => ids.includes(id));
      const reversed = [...listed].reverse();
      changedSettings = true;
      const saved = await saveModelsConfig(client, withModelOrder(fresh, withListedOrder(order, reversed)));
      const kept = list(saved.MODEL_ORDER_LIST);
      if (kept[0] !== ghost) throw new Error('the id not listed lost its place');
      if (!same(kept.filter((id) => ids.includes(String(id))), reversed)) throw new Error('the listed models aren’t in the new order');
      for (const key of MODEL_KEYS.filter((key) => key !== 'MODEL_ORDER_LIST')) if (!same(saved[key] ?? null, fresh[key] ?? null)) throw new Error(`${key} changed`);
      if (reversed.length < 2) return `kept (${reversed.length} listed model${reversed.length === 1 ? '' : 's'}: the pickers’ order can’t be seen)`;
      const picker = list(record(await client.get<unknown>('/api/models')).data).map((item) => String(record(item).id));
      const inPicker = picker.filter((id) => reversed.includes(id));
      const expected = reversed.filter((id) => inPicker.includes(id));
      if (!same(inPicker, expected)) throw new Error('/api/models doesn’t follow the order');
      return `kept with ${kept.length} ids; /api/models follows it for ${inPicker.length}`;
    });

    await check('defaults: only the changed ones written over the config as read; the models show them', async () => {
      const fresh = await getModelsConfig(client);
      const was = modelDefaultsOf(fresh);
      const next = { ...was, capabilities: { ...was.capabilities, usage: !was.capabilities.usage }, builtinTools: { ...was.builtinTools, notes: !(was.builtinTools.notes !== false) }, params: { ...was.params, temperature: 0.31 } };
      changedSettings = true;
      const saved = await saveModelsConfig(client, withModelDefaults(fresh, was, next));
      const meta = record(saved.DEFAULT_MODEL_METADATA);
      if (record(meta.capabilities).usage !== next.capabilities.usage) throw new Error('the capability wasn’t kept');
      if ((record(meta.builtinTools).notes === false) === next.builtinTools.notes) throw new Error('the built-in tool wasn’t kept');
      if (record(saved.DEFAULT_MODEL_PARAMS).temperature !== 0.31) throw new Error('the parameter wasn’t kept');
      for (const key of ['DEFAULT_MODELS', 'DEFAULT_PINNED_MODELS', 'MODEL_ORDER_LIST']) if (!same(saved[key] ?? null, fresh[key] ?? null)) throw new Error(`${key} changed`);
      const again = modelDefaultsOf(saved);
      if (again.capabilities.usage !== next.capabilities.usage || again.params.temperature !== 0.31) throw new Error('read back differently');
      const live = list(record(await client.get<unknown>('/api/models')).data).map(record);
      const showing = live.filter((item) => record(record(record(item.info).meta).capabilities).usage === next.capabilities.usage);
      const own = live.filter((item) => typeof record(record(record(item.info).meta).capabilities).usage === 'boolean');
      if (live.length && !showing.length) throw new Error('no model shows the default');
      return `kept; ${showing.length} of ${live.length} models show it (${own.length} with a usage setting after the merge)`;
    });

    await check('everyone’s prompt suggestions: saved, read back, translations untouched', async () => {
      const probe = { title: 'APP PROBE', subtitle: 'suggestion', content: 'APP PROBE: say hello' };
      changedSuggestions = true;
      const kept = await saveDefaultSuggestions(client, { prompts: [probe], translations: suggestionsBefore.translations });
      if (!sameSuggestions(kept, [probe])) throw new Error('the server kept something else');
      const after = defaultSuggestionsOf(record(await getConfig(client)));
      if (!sameSuggestions(after.prompts, [probe])) throw new Error('/api/config doesn’t carry them');
      if (!same(after.translations, suggestionsBefore.translations)) throw new Error('the translations changed');
      return `kept and in /api/config; translations ${suggestionsBefore.translations === null ? 'not on this version' : `for ${translatedLanguages(after).length} languages unchanged`}`;
    });

    await check('import: a new model, then a second import changing it (its other settings kept)', async () => {
      const first = rowsFromImport([{ id: importId, name: 'APP PROBE import', base_model_id: null, meta: { description: 'made by the probe', hidden: true }, params: { temperature: 0.2 }, access_grants: [] }, { name: 'no id' }]);
      if (first.rows.length !== 1 || first.skipped !== 1) throw new Error('the file was read wrongly');
      await importAdminModels(client, first.rows);
      imported = true;
      const made = record(await client.get<unknown>('/api/v1/models/model', { query: { id: importId } }));
      if (made.name !== 'APP PROBE import' || record(made.meta).hidden !== true) throw new Error('not made as in the file');
      const second = rowsFromImport({ id: importId, info: { name: 'APP PROBE import 2', meta: { description: 'changed' }, params: {} } });
      await importAdminModels(client, second.rows);
      const changed = record(await client.get<unknown>('/api/v1/models/model', { query: { id: importId } }));
      if (changed.name !== 'APP PROBE import 2' || record(changed.meta).description !== 'changed') throw new Error('the second import didn’t change it');
      if (record(changed.meta).hidden !== true) throw new Error('its other meta wasn’t kept');
      return 'made; then renamed with its description changed, hidden kept (an older export unwrapped)';
    });

    await check('export: all saved models, and one alone', async () => {
      const all = await exportAdminModels(client);
      if (!all.some((row) => row.id === importId)) throw new Error('the export lacks the imported model');
      const presets = (await exportWorkspaceModels(client)).length;
      const one = await exportAdminModel(client, { id: importId, preset: false });
      if (one.name !== 'APP PROBE import 2') throw new Error('exported the wrong one');
      const preset = all.find((row) => typeof row.base_model_id === 'string' && row.base_model_id);
      if (preset && (await exportAdminModel(client, { id: String(preset.id), preset: true })).id !== preset.id) throw new Error('a workspace model exported wrongly');
      return `${all.length} saved models (${presets} workspace ones); the imported one alone${preset ? ', and a workspace one alone' : ''}`;
    });
  } finally {
    if (imported) {
      await check('the imported model deleted', async () => {
        await deleteWorkspaceModel(client, importId);
        const left = await exportAdminModels(client);
        if (left.some((row) => row.id === importId)) throw new Error('it’s still there');
        return 'gone';
      });
    }
    if (madeForOrder.length) {
      await check('the two workspace models for the order deleted', async () => {
        for (const id of madeForOrder) await deleteWorkspaceModel(client, id);
        const left = await exportAdminModels(client);
        if (left.some((row) => madeForOrder.includes(String(row.id)))) throw new Error('one is still there');
        return 'gone';
      });
    }
    if (changedSettings) {
      await check('the models settings put back exactly', async () => {
        const back = await saveModelsConfig(client, before);
        if (modelSettings(back) !== modelSettings(before)) throw new Error('they differ from before');
        return 'as before';
      });
    }
    if (changedSuggestions) {
      await check('the prompt suggestions put back exactly', async () => {
        const kept = await saveDefaultSuggestions(client, suggestionsBefore);
        const after = defaultSuggestionsOf(record(await getConfig(client)));
        if (!sameSuggestions(kept, suggestionsBefore.prompts) || !sameSuggestions(after.prompts, suggestionsBefore.prompts) || !same(after.translations, suggestionsBefore.translations)) throw new Error('they differ from before');
        return `as before (${suggestionsBefore.prompts === null ? 'built-in' : suggestionsBefore.prompts.length})`;
      });
    }
  }
  return { steps, fixture };
}
