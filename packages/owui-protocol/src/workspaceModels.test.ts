import { describe, expect, it } from 'vitest';
import { OwuiClient, type FetchLike } from './http';
import {
  cloneForm,
  createWorkspaceModel,
  getWorkspaceModel,
  importWorkspaceModel,
  listAllWorkspaceModels,
  listParams,
  listWorkspaceModels,
  modelFormBody,
  modelFormOf,
  modelsFromImport,
  modelIdFromName,
  promptVariables,
  pruneEmpty,
  setWorkspaceModelActive,
  setWorkspaceModelHidden,
  toggleWorkspaceModel,
  updateWorkspaceModel,
} from './workspaceModels';

function recordingClient(...answers: unknown[]) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(answers.shift() ?? {}), { status: 200 });
  };
  return { client: new OwuiClient({ baseUrl: 'https://chat.test', token: 't', fetch }), calls };
}

const MODEL = {
  id: 'tutor',
  name: 'Tutor',
  base_model_id: 'gpt-x',
  user_id: 'u1',
  meta: { description: 'Patient', tags: [{ name: 'study' }, 'math'], profile_image_url: '/static/favicon.png', capabilities: { vision: true }, hidden: false },
  params: { system: 'Be patient. Ask {{chat.variables.level | select:options=["a","b"]}} and greet {{user.variables.nickname}}.', temperature: 0.4 },
  access_grants: [{ principal_type: 'group', principal_id: 'g1', permission: 'read' }, { principal_type: 'robot', principal_id: 'x', permission: 'read' }],
  is_active: false,
  updated_at: 1_730_000_000,
  user: { name: 'Amy' },
  write_access: true,
};

describe('workspace models', () => {
  it('lists a page with the order always given', async () => {
    const { client, calls } = recordingClient({ items: [MODEL, { name: 'no id' }], total: 31 });
    const page = await listWorkspaceModels(client, { query: ' tut ', view: 'created', tag: 'study', page: 2 });
    expect(calls[0]?.url).toBe('https://chat.test/api/v1/models/list?order_by=updated_at&direction=desc&page=2&query=tut&view_option=created&tag=study');
    expect(page.total).toBe(31);
    expect(page.items[0]).toMatchObject({ id: 'tutor', baseModelId: 'gpt-x', description: 'Patient', tags: ['study', 'math'], isActive: false, hidden: false, ownerName: 'Amy', writeAccess: true, updatedAt: 1_730_000_000_000 });
    expect(page.items[0]?.accessGrants).toEqual([{ principal_type: 'group', principal_id: 'g1', permission: 'read' }]);
    expect(listParams({})).toEqual({ order_by: 'updated_at', direction: 'desc', page: 1 });
  });

  it('saves whole, keeping it off, without touching its sharing', async () => {
    const { client, calls } = recordingClient(MODEL, { ...MODEL, meta: { ...MODEL.meta, hidden: true } });
    await setWorkspaceModelHidden(client, 'tutor', true);
    expect(calls[0]?.url).toBe('https://chat.test/api/v1/models/model?id=tutor');
    const body = calls[1]?.body as Record<string, unknown>;
    expect(calls[1]?.url).toBe('https://chat.test/api/v1/models/model/update');
    expect(body).toMatchObject({ id: 'tutor', base_model_id: 'gpt-x', name: 'Tutor', is_active: false, meta: { hidden: true, description: 'Patient' }, params: { temperature: 0.4 } });
    expect(body).not.toHaveProperty('access_grants');
  });

  it('makes new ones private, and sends sharing only when it changed', async () => {
    const { client, calls } = recordingClient(MODEL, MODEL, MODEL);
    const model = await getWorkspaceModel(client, 'tutor');
    await createWorkspaceModel(client, { ...cloneForm(model), accessGrants: undefined });
    expect(calls[1]?.body).toMatchObject({ id: 'tutor-clone', name: 'Tutor (Clone)', access_grants: [] });
    await updateWorkspaceModel(client, { ...modelFormOf(model), accessGrants: [{ principal_type: 'user', principal_id: '*', permission: 'read' }] });
    expect((calls[2]?.body as Record<string, unknown>).access_grants).toEqual([{ principal_type: 'user', principal_id: '*', permission: 'read' }]);
  });

  it('switches a model on or off', async () => {
    const { client, calls } = recordingClient({ ...MODEL, is_active: true });
    expect((await toggleWorkspaceModel(client, 'a b')).isActive).toBe(true);
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://chat.test/api/v1/models/model/toggle?id=a+b' });
  });

  it('drops empty values, makes ids from names, and finds a prompt’s variables', () => {
    expect(pruneEmpty({ a: '', b: [], c: {}, d: null, e: false, f: 0, g: 'x' })).toEqual({ e: false, f: 0, g: 'x' });
    expect(modelIdFromName('  My Tutor_v2! ')).toBe('my-tutorv2');
    expect(promptVariables(MODEL.params.system)).toEqual({ chat: ['level'], user: ['nickname'] });
  });

  it('switches a model on only when it is off, after reading it', async () => {
    const off = recordingClient(MODEL, { ...MODEL, is_active: true });
    await setWorkspaceModelActive(off.client, 'tutor', true);
    expect(off.calls.map((call) => `${call.method} ${call.url}`)).toEqual(['GET https://chat.test/api/v1/models/model?id=tutor', 'POST https://chat.test/api/v1/models/model/toggle?id=tutor']);
    const on = recordingClient({ ...MODEL, is_active: true });
    await setWorkspaceModelActive(on.client, 'tutor', true);
    expect(on.calls).toHaveLength(1);
  });

  it('gathers every page the list finds, with its search', async () => {
    const page = (ids: string[], total: number) => ({ items: ids.map((id) => ({ ...MODEL, id })), total });
    const { client, calls } = recordingClient(page(['a', 'b'], 3), page(['c'], 3));
    const all = await listAllWorkspaceModels(client, { query: 'tu', tag: 'study' });
    expect(all.map((model) => model.id)).toEqual(['a', 'b', 'c']);
    expect(calls.map((call) => new URL(call.url).searchParams.get('page'))).toEqual(['1', '2']);
    expect(new URL(calls[0]?.url ?? '').searchParams.get('query')).toBe('tu');
  });

  it('reads import files as the web does: rows are made private; older `info` rows change a model you have', () => {
    const file = [
      { id: 'tutor', name: 'Tutor', base_model_id: 'gpt-x', meta: { description: 'd' }, params: { temperature: 0.3 }, is_active: false, access_grants: [{ principal_type: 'user', principal_id: '*', permission: 'read' }] },
      { id: 'mine', info: { id: 'mine', name: 'Mine', base_model_id: 'gpt-x', meta: {}, params: {} } },
      { id: 'other', info: { name: 'Other', base_model_id: 'gpt-x' } },
      { id: 'no-name' },
      'junk',
    ];
    const { models, skipped } = modelsFromImport(file, new Set(['mine', 'tutor']));
    expect(skipped).toBe(2);
    expect(models.map((item) => [item.id, item.update])).toEqual([
      ['tutor', false],
      ['mine', true],
      ['other', false],
    ]);
    expect(models[0]?.form).toEqual({ id: 'tutor', baseModelId: 'gpt-x', name: 'Tutor', meta: { description: 'd' }, params: { temperature: 0.3 }, isActive: false, accessGrants: [] });
    expect(models[1]?.form.accessGrants).toBeUndefined();
    expect(modelsFromImport({ id: 'one', name: 'One' }, new Set()).models).toHaveLength(1);
  });

  it('imports by making new models or changing the one you have', async () => {
    const { models } = modelsFromImport([{ id: 'n', name: 'N', base_model_id: 'b' }, { id: 'mine', info: { id: 'mine', name: 'Mine', meta: { a: 1 }, params: {} } }], new Set(['mine']));
    const { client, calls } = recordingClient({ ...MODEL, id: 'n' }, { ...MODEL, id: 'mine' });
    for (const item of models) await importWorkspaceModel(client, item);
    expect(calls.map((call) => call.url)).toEqual(['https://chat.test/api/v1/models/create', 'https://chat.test/api/v1/models/model/update']);
    expect(calls[0]?.body).toMatchObject({ id: 'n', base_model_id: 'b', access_grants: [] });
    expect(calls[1]?.body).not.toHaveProperty('access_grants');
    expect(modelFormBody({ id: 'x', baseModelId: '', name: ' X ', meta: { description: '' }, params: {}, isActive: true })).toEqual({ id: 'x', base_model_id: null, name: 'X', meta: {}, params: {}, is_active: true });
  });
});
