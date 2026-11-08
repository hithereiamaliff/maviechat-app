import { describe, expect, it } from 'vitest';
import { OwuiClient, type FetchLike } from './http';
import {
  defaultSuggestionsOf,
  exportAdminModel,
  exportAdminModels,
  fullModelOrder,
  idsOf,
  importAdminModels,
  inModelOrder,
  listAdminModels,
  modelDefaultsChanges,
  modelDefaultsOf,
  movedInList,
  rowsFromImport,
  saveDefaultSuggestions,
  saveModelsConfig,
  sameSuggestions,
  setAdminModelActive,
  translatedLanguages,
  withListedModel,
  withListedOrder,
  withModelDefaults,
  withModelOrder,
} from './adminModels';

function routedClient(routes: Record<string, unknown>) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    const path = new URL(url).pathname;
    return new Response(JSON.stringify(routes[`${init?.method ?? 'GET'} ${path}`] ?? {}), { status: 200 });
  };
  return { client: new OwuiClient({ baseUrl: 'https://chat.test', token: 't', fetch }), calls };
}

describe('admin models', () => {
  it('lists every model once: in use, then the providers’ own, with saved rows laid over', async () => {
    const { client } = routedClient({
      'GET /api/models': { data: [{ id: 'gpt-a', name: 'GPT A', owned_by: 'openai' }, { id: 'tutor', name: 'Tutor', info: { base_model_id: 'gpt-a', meta: { hidden: true } } }] },
      'GET /api/models/base': { data: [{ id: 'gpt-a', name: 'GPT A' }, { id: 'gpt-off', name: 'GPT Off', owned_by: 'openai' }] },
      'GET /api/v1/models/base': [{ id: 'gpt-off', name: 'GPT Off (saved)', is_active: false, meta: {}, access_grants: [] }],
    });
    const models = await listAdminModels(client);
    expect(models.map((model) => [model.id, model.hasRow, model.isActive, model.preset, model.hidden])).toEqual([
      ['gpt-a', false, true, false, false],
      ['tutor', true, true, true, true],
      ['gpt-off', true, false, false, false],
    ]);
    expect(models[2]?.name).toBe('GPT Off (saved)');
  });

  it('makes a row for a provider model switched for the first time, else flips only if needed', async () => {
    const fresh = routedClient({ 'GET /api/v1/models/model': { id: 'gpt-b', is_active: false } });
    await setAdminModelActive(fresh.client, { id: 'gpt-a', name: 'GPT A', ownedBy: 'openai', preset: false, hasRow: false, isActive: true, hidden: false, accessGrants: [] }, false);
    expect(fresh.calls[0]).toMatchObject({ method: 'POST', url: 'https://chat.test/api/v1/models/create', body: { id: 'gpt-a', base_model_id: null, is_active: false, access_grants: [] } });
    await setAdminModelActive(fresh.client, { id: 'gpt-b', name: 'GPT B', ownedBy: 'openai', preset: false, hasRow: true, isActive: true, hidden: false, accessGrants: [] }, false);
    expect(fresh.calls.slice(1).map((call) => call.method)).toEqual(['GET']);
  });

  it('adds or takes a model off the defaults, keeping the other four settings as read', async () => {
    const config = { DEFAULT_MODELS: 'gpt-a,gpt-b', DEFAULT_PINNED_MODELS: null, MODEL_ORDER_LIST: ['gpt-b'], DEFAULT_MODEL_METADATA: { capabilities: { vision: true } }, DEFAULT_MODEL_PARAMS: null };
    expect(withListedModel(config, 'DEFAULT_MODELS', 'gpt-a', false).DEFAULT_MODELS).toBe('gpt-b');
    expect(withListedModel(config, 'DEFAULT_PINNED_MODELS', 'gpt-a', true).DEFAULT_PINNED_MODELS).toBe('gpt-a');
    expect(withListedModel({ ...config, DEFAULT_PINNED_MODELS: 'x' }, 'DEFAULT_PINNED_MODELS', 'x', false).DEFAULT_PINNED_MODELS).toBe('');
    expect(withListedModel(config, 'DEFAULT_PINNED_MODELS', 'zzz', false).DEFAULT_PINNED_MODELS).toBeNull();
    expect(idsOf(' a , ,b')).toEqual(['a', 'b']);
    const { client, calls } = routedClient({});
    await saveModelsConfig(client, withListedModel(config, 'DEFAULT_MODELS', 'gpt-c', true));
    expect(calls[0]?.body).toEqual({ ...config, DEFAULT_MODELS: 'gpt-a,gpt-b,gpt-c' });
  });

  describe('order', () => {
    it('keeps the saved order (once each, unlisted ones too), then adds listed models it lacks by id', () => {
      const order = fullModelOrder({ MODEL_ORDER_LIST: ['b', 'gone', 'b', 'a'] }, ['a', 'b', 'd', 'c', 'c']);
      expect(order).toEqual(['b', 'gone', 'a', 'c', 'd']);
      expect(fullModelOrder({ MODEL_ORDER_LIST: null }, ['z', 'y'])).toEqual(['y', 'z']);
    });

    it('sorts models by place, then by name', () => {
      const models = [
        { id: 'x', name: 'Zed' },
        { id: 'y', name: 'Alpha' },
        { id: 'b', name: 'Beta' },
        { id: 'a', name: 'Gamma' },
      ];
      expect(inModelOrder(models, ['b', 'a']).map((model) => model.id)).toEqual(['b', 'a', 'y', 'x']);
    });

    it('puts the listed models in their new sequence, ids not listed staying in place', () => {
      expect(withListedOrder(['a', 'gone', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'gone', 'a', 'b']);
      expect(withModelOrder({ DEFAULT_MODELS: 'a', MODEL_ORDER_LIST: ['a'] }, ['b', 'a'])).toEqual({ DEFAULT_MODELS: 'a', MODEL_ORDER_LIST: ['b', 'a'] });
    });

    it('moves one item, clamped to the ends', () => {
      expect(movedInList(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
      expect(movedInList(['a', 'b', 'c'], 0, 99)).toEqual(['b', 'c', 'a']);
      expect(movedInList(['a', 'b', 'c'], 1, 0)).toEqual(['b', 'a', 'c']);
      expect(movedInList(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
    });
  });

  describe('defaults for every model', () => {
    const saved = {
      DEFAULT_MODELS: 'a',
      DEFAULT_PINNED_MODELS: null,
      MODEL_ORDER_LIST: ['a'],
      DEFAULT_MODEL_METADATA: { capabilities: { vision: false }, defaultFeatureIds: ['web_search'], builtinTools: { memory: false }, futureKey: 1 },
      DEFAULT_MODEL_PARAMS: { temperature: 0.4, custom_params: { top_k: '20' } },
    };

    it('reads them as the web starts its panel: all on but usage where nothing is saved', () => {
      const none = modelDefaultsOf({});
      expect(none.capabilities.vision).toBe(true);
      expect(none.capabilities.usage).toBe(false);
      expect(none.featureIds).toEqual([]);
      expect(none.params).toEqual({});
      const read = modelDefaultsOf(saved);
      expect(read.capabilities.vision).toBe(false);
      expect(read.featureIds).toEqual(['web_search']);
      expect(read.builtinTools.memory).toBe(false);
      expect(read.builtinTools.time).toBe(true);
      expect(read.params).toEqual({ temperature: 0.4 });
      expect(read.custom).toEqual([{ name: 'top_k', value: '20' }]);
    });

    it('writes only what changed, over the config as read now, keeping the rest and the other keys', () => {
      const before = modelDefaultsOf(saved);
      const after = { ...before, capabilities: { ...before.capabilities, usage: true }, params: { ...before.params, max_tokens: 500 } };
      // Meanwhile someone else switched vision back on and changed the temperature.
      const now = { ...saved, DEFAULT_MODEL_METADATA: { ...saved.DEFAULT_MODEL_METADATA, capabilities: { vision: true } }, DEFAULT_MODEL_PARAMS: { temperature: 0.9, custom_params: { top_k: '20' } } };
      const next = withModelDefaults(now, before, after);
      const meta = next.DEFAULT_MODEL_METADATA as Record<string, unknown>;
      const capabilities = meta.capabilities as Record<string, boolean>;
      expect(capabilities.usage).toBe(true);
      expect(capabilities.vision).toBe(true);
      expect(meta.futureKey).toBe(1);
      expect(meta.defaultFeatureIds).toEqual(['web_search']);
      expect(next.DEFAULT_MODEL_PARAMS).toEqual({ temperature: 0.9, max_tokens: 500, custom_params: { top_k: '20' } });
      expect(next.MODEL_ORDER_LIST).toEqual(['a']);
    });

    it('leaves the metadata alone when only parameters change, and the reverse', () => {
      const before = modelDefaultsOf({});
      const params = withModelDefaults({ DEFAULT_MODEL_METADATA: {}, DEFAULT_MODEL_PARAMS: null }, before, { ...before, params: { temperature: 0.2 } });
      expect(params.DEFAULT_MODEL_METADATA).toEqual({});
      expect(params.DEFAULT_MODEL_PARAMS).toEqual({ temperature: 0.2 });
      const meta = withModelDefaults({ DEFAULT_MODEL_METADATA: {}, DEFAULT_MODEL_PARAMS: null }, before, { ...before, builtinTools: { ...before.builtinTools, notes: false } });
      expect(meta.DEFAULT_MODEL_METADATA).toEqual({ builtinTools: { notes: false } });
      expect(meta.DEFAULT_MODEL_PARAMS).toBeNull();
    });

    it('drops features whose capability is off, empties lists, and takes a parameter back to Default', () => {
      const before = modelDefaultsOf(saved);
      const off = { ...before, capabilities: { ...before.capabilities, web_search: false }, featureIds: ['web_search', 'code_interpreter'], builtinTools: { ...before.builtinTools, memory: true }, params: {}, custom: [] };
      const next = withModelDefaults(saved, before, off);
      const meta = next.DEFAULT_MODEL_METADATA as Record<string, unknown>;
      expect(meta.defaultFeatureIds).toEqual(['code_interpreter']);
      expect(meta.builtinTools).toBeUndefined();
      expect(next.DEFAULT_MODEL_PARAMS).toEqual({});
    });

    it('lists the changes in the sheet’s words', () => {
      const before = modelDefaultsOf(saved);
      const after = { ...before, capabilities: { ...before.capabilities, vision: true }, featureIds: [], builtinTools: { ...before.builtinTools, notes: false }, params: { temperature: 0.4, top_p: 0.9 }, custom: [] };
      expect(modelDefaultsChanges(before, after)).toEqual([
        { label: 'Vision', from: 'off', to: 'on' },
        { label: 'Web search in new chats', from: 'on', to: 'off' },
        { label: 'Built-in tool: Notes', from: 'on', to: 'off' },
        { label: 'Top P', from: 'Default', to: '0.9' },
        { label: 'Custom parameters', from: 'top_k = 20', to: 'none' },
      ]);
    });
  });

  describe('prompt suggestions for everyone', () => {
    const prompt = { title: 'Plan', subtitle: 'a trip', content: 'Plan a trip' };

    it('reads 0.11’s list, and 0.12’s list or built-in ones with their translations', () => {
      expect(defaultSuggestionsOf({ default_prompt_suggestions: [{ title: ['Plan', 'a trip'], content: 'Plan a trip' }] })).toEqual({ prompts: [prompt], translations: null });
      expect(defaultSuggestionsOf({})).toEqual({ prompts: [], translations: null });
      const twelve = defaultSuggestionsOf({ default_prompt_suggestions: null, default_prompt_suggestions_i18n: { ms: { suggestion_prompts: [] }, fr: {} } });
      expect(twelve).toEqual({ prompts: null, translations: { ms: { suggestion_prompts: [] }, fr: {} } });
      expect(translatedLanguages(twelve)).toEqual(['ms']);
    });

    it('saves 0.11’s as a list, and 0.12’s with the translations as read', async () => {
      const eleven = routedClient({ 'POST /api/v1/configs/suggestions': [{ title: ['Plan', 'a trip'], content: 'Plan a trip' }] });
      expect(await saveDefaultSuggestions(eleven.client, { prompts: [prompt, { title: '', subtitle: '', content: ' ' }], translations: null })).toEqual([prompt]);
      expect(eleven.calls[0]?.body).toEqual({ suggestions: [{ content: 'Plan a trip', title: ['Plan', 'a trip'] }] });
      const twelve = routedClient({ 'POST /api/v1/configs/suggestions': { suggestions: null, i18n: { ms: {} } } });
      expect(await saveDefaultSuggestions(twelve.client, { prompts: null, translations: { ms: {} } })).toBeNull();
      expect(twelve.calls[0]?.body).toEqual({ suggestions: null, i18n: { ms: {} } });
    });

    it('compares lists as the save keeps them', () => {
      expect(sameSuggestions([prompt], [prompt, { title: 'x', subtitle: '', content: '' }])).toBe(true);
      expect(sameSuggestions([prompt], null)).toBe(false);
    });
  });

  describe('import and export', () => {
    it('takes one or a list, unwraps an older export, and leaves out entries without an id or a name', () => {
      expect(rowsFromImport({ id: 'a', name: 'A', access_grants: [{ principal_id: '*' }] })).toEqual({ rows: [{ id: 'a', name: 'A', access_grants: [{ principal_id: '*' }] }], skipped: 0 });
      const found = rowsFromImport([{ id: 'b', info: { name: 'B', meta: { hidden: true } } }, { id: 'c' }, { name: 'D' }, 'nonsense']);
      expect(found.rows).toEqual([{ id: 'b', name: 'B', meta: { hidden: true } }]);
      expect(found.skipped).toBe(3);
    });

    it('imports through the server and fails unless it says so', async () => {
      const ok = routedClient({ 'POST /api/v1/models/import': true });
      await importAdminModels(ok.client, [{ id: 'a', name: 'A' }]);
      expect(ok.calls[0]?.body).toEqual({ models: [{ id: 'a', name: 'A' }] });
      const refused = routedClient({ 'POST /api/v1/models/import': false });
      await expect(importAdminModels(refused.client, [{ id: 'a', name: 'A' }])).rejects.toThrow();
    });

    it('exports every saved model: the server’s own with settings, then workspace ones', async () => {
      const { client } = routedClient({ 'GET /api/v1/models/base': [{ id: 'gpt-a', base_model_id: null }], 'GET /api/v1/models/export': [{ id: 'tutor', base_model_id: 'gpt-a' }] });
      expect((await exportAdminModels(client)).map((row) => row.id)).toEqual(['gpt-a', 'tutor']);
    });

    it('exports one saved model from the right list, picking it out where 0.11 sends them all', async () => {
      const { client, calls } = routedClient({ 'GET /api/v1/models/export': [{ id: 'other' }, { id: 'a', name: 'A' }], 'GET /api/v1/models/base': [{ id: 'gpt-a', name: 'GPT A' }] });
      expect(await exportAdminModel(client, { id: 'a', preset: true })).toEqual({ id: 'a', name: 'A' });
      expect(calls[0]?.url).toBe('https://chat.test/api/v1/models/export?ids=a');
      expect(await exportAdminModel(client, { id: 'gpt-a', preset: false })).toEqual({ id: 'gpt-a', name: 'GPT A' });
      await expect(exportAdminModel(client, { id: 'missing', preset: false })).rejects.toThrow();
    });
  });
});
