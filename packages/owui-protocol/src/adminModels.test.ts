import { describe, expect, it } from 'vitest';
import { OwuiClient, type FetchLike } from './http';
import { idsOf, listAdminModels, saveModelsConfig, setAdminModelActive, withListedModel } from './adminModels';

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
});
