import { describe, expect, it } from 'vitest';
import {
  addressHasPassword,
  createExternalSource,
  externalFormOf,
  externalFormProblem,
  listExternalSources,
  maskedAddress,
  newExternalForm,
  setExternalConnectionEnabled,
  testExternalSource,
  updateExternalSource,
  withExternalProvider,
  type ExternalConnection,
} from './externalKnowledge';
import { OwuiClient, type FetchLike } from './http';

function server(routes: Record<string, unknown>) {
  const calls: { method: string; path: string; query: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    const parsed = new URL(url);
    const method = init?.method ?? 'GET';
    calls.push({ method, path: parsed.pathname, query: parsed.search, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(routes[`${method} ${parsed.pathname}`] ?? {}), { status: 200 });
  };
  return { client: new OwuiClient({ baseUrl: 'https://chat.test', token: 't', fetch }), calls };
}

const CONNECTION = { id: 'c1', name: 'Research', provider: 'qdrant', endpoint: 'https://qdrant.test', config: { timeout: 12 }, capabilities: { retrieve: true }, enabled: true, auth_configured: true };
const KNOWLEDGE = { id: 'k1', name: 'Research', description: 'Papers', meta: { source: 'external', external: { connection_id: 'c1', provider: 'qdrant', source: { type: 'collection', name: 'papers', config: { content_field: 'payload.body' } } } }, access_grants: [] };

describe('external knowledge', () => {
  it('lists the sources with their connections, saved keys only as a yes or no', async () => {
    const { client, calls } = server({ 'GET /api/v1/knowledge/external/connections': { items: [CONNECTION], total: 1 }, 'GET /api/v1/knowledge/search': { items: [KNOWLEDGE], total: 1 } });
    const { sources, connections } = await listExternalSources(client);
    expect(connections).toEqual([{ id: 'c1', name: 'Research', provider: 'qdrant', endpoint: 'https://qdrant.test', config: { timeout: 12 }, capabilities: { retrieve: true }, enabled: true, keySaved: true }]);
    expect(sources[0]).toMatchObject({ connectionId: 'c1', collection: 'papers', fields: { content_field: 'payload.body' } });
    expect(calls.find((call) => call.path === '/api/v1/knowledge/search')?.query).toContain('source=external');
  });

  it('fills the form from a saved source, its key left empty, defaults where nothing was saved', async () => {
    const { client } = server({ 'GET /api/v1/knowledge/external/connections': { items: [CONNECTION] }, 'GET /api/v1/knowledge/search': { items: [KNOWLEDGE], total: 1 } });
    const { sources, connections } = await listExternalSources(client);
    expect(externalFormOf(sources[0]!, connections[0]!)).toEqual({ name: 'Research', description: 'Papers', provider: 'qdrant', endpoint: 'https://qdrant.test', key: '', timeout: '12', database: '', collection: 'papers', contentField: 'payload.body', vectorField: '', metadataField: 'payload.metadata', documentIdField: 'id', table: 'document_chunk', collectionField: 'collection_name' });
  });

  it('tests a new source with its typed key, and a saved one keeping its key unless another is typed', async () => {
    const answer = { documents: ['A passage', 'Another'], distances: [0.1], metadatas: [{}, {}] };
    const { client, calls } = server({ 'POST /api/v1/knowledge/external/source/test': answer });
    const form = { ...newExternalForm(), name: 'Research', endpoint: ' https://qdrant.test ', key: ' secret ', collection: 'papers' };
    expect(await testExternalSource(client, form, ' tides? ')).toEqual({ passages: [{ text: 'A passage', distance: 0.1 }, { text: 'Another', distance: null }] });
    expect(calls[0]?.body).toEqual({
      connection: { name: 'Research', provider: 'qdrant', endpoint: 'https://qdrant.test', auth_config: { type: 'bearer', api_key: 'secret' }, config: { timeout: 30 }, capabilities: { retrieve: true }, enabled: true },
      source: { type: 'collection', name: 'papers', config: { content_field: 'payload.text', metadata_field: 'payload.metadata', document_id_field: 'id' } },
      query: 'tides?',
      count: 5,
    });
    const saved: ExternalConnection = { id: 'c1', name: 'Research', provider: 'qdrant', endpoint: 'https://qdrant.test', config: {}, capabilities: {}, enabled: false, keySaved: true };
    await testExternalSource(client, { ...form, key: '' }, 'tides?', saved);
    expect(calls[1]?.body).toMatchObject({ connection_id: 'c1', connection: { auth_config: null, enabled: false } });
    await testExternalSource(client, { ...form, key: '' }, 'tides?');
    expect(calls[2]?.body).toMatchObject({ connection: { auth_config: {} } });
  });

  it('sends Milvus its database and pgvector its table, never a key for pgvector', async () => {
    const { client, calls } = server({});
    await testExternalSource(client, { ...withExternalProvider(newExternalForm(), 'milvus'), endpoint: 'http://milvus.test:19530', key: 'k', database: 'docs', collection: 'papers', timeout: '' }, 'q');
    expect(calls[0]?.body).toMatchObject({ connection: { provider: 'milvus', config: { timeout: 30, db_name: 'docs' }, auth_config: { type: 'bearer', api_key: 'k' } }, source: { config: { content_field: 'data.text', vector_field: 'vector', metadata_field: 'metadata' } } });
    await testExternalSource(client, { ...withExternalProvider(newExternalForm(), 'pgvector'), endpoint: 'postgresql://u:p@db:5432/x', key: 'ignored', collection: 'papers' }, 'q');
    expect(calls[1]?.body).toMatchObject({ connection: { provider: 'pgvector', auth_config: {}, config: { timeout: 30 } }, source: { config: { content_field: 'text', vector_field: 'vector', metadata_field: 'vmetadata', table_name: 'document_chunk', collection_field: 'collection_name' } } });
  });

  it('creates a source private, and updates one without touching its sharing', async () => {
    const { client, calls } = server({ 'POST /api/v1/knowledge/external/source/create': { id: 'k9' } });
    const form = { ...newExternalForm(), name: ' Research ', description: ' Papers ', endpoint: 'https://qdrant.test', collection: 'papers' };
    expect(await createExternalSource(client, form, 'q')).toBe('k9');
    expect(calls[0]?.body).toMatchObject({ name: 'Research', description: 'Papers', access_grants: [], test_query: 'q', test_count: 5 });
    const saved: ExternalConnection = { id: 'c1', name: 'Research', provider: 'qdrant', endpoint: 'https://qdrant.test', config: {}, capabilities: {}, enabled: true, keySaved: true };
    await updateExternalSource(client, 'k 1', form, 'q', saved);
    expect(calls[1]).toMatchObject({ method: 'PATCH', path: '/api/v1/knowledge/external/source/k%201' });
    expect(calls[1]?.body).not.toHaveProperty('access_grants');
    expect(calls[1]?.body).toMatchObject({ connection: { auth_config: null } });
  });

  it('switches a connection on or off, keeping its key', async () => {
    const { client, calls } = server({ 'PATCH /api/v1/knowledge/external/connections/c1': { ...CONNECTION, enabled: false } });
    const saved: ExternalConnection = { id: 'c1', name: 'Research', provider: 'qdrant', endpoint: 'https://qdrant.test', config: { timeout: 12 }, capabilities: {}, enabled: true, keySaved: true };
    expect(await setExternalConnectionEnabled(client, saved, false)).toMatchObject({ enabled: false, keySaved: true });
    expect(calls[0]?.body).toEqual({ name: 'Research', provider: 'qdrant', endpoint: 'https://qdrant.test', auth_config: null, config: { timeout: 12 }, capabilities: { retrieve: true }, enabled: false });
  });

  it('says what a form still needs', () => {
    const ready = { ...newExternalForm(), name: 'R', endpoint: 'https://q.test', collection: 'papers' };
    expect(externalFormProblem(ready, 'q', true)).toBeNull();
    expect(externalFormProblem({ ...ready, name: '' }, 'q')).toBeNull();
    expect(externalFormProblem({ ...ready, name: '' }, 'q', true)).toMatch(/name/);
    expect(externalFormProblem(ready, ' ')).toMatch(/test question/);
    expect(externalFormProblem({ ...ready, timeout: 'soon' }, 'q')).toMatch(/seconds/);
    expect(externalFormProblem(withExternalProvider(ready, 'milvus'), 'q')).toBeNull();
    expect(externalFormProblem({ ...withExternalProvider(ready, 'milvus'), vectorField: '' }, 'q')).toMatch(/vectors/);
    expect(externalFormProblem({ ...withExternalProvider(ready, 'pgvector'), table: '' }, 'q')).toMatch(/table/);
  });

  it('hides a password in an address', () => {
    expect(addressHasPassword('postgresql://amy:s3cret@db.test:5432/x')).toBe(true);
    expect(maskedAddress('postgresql://amy:s3cret@db.test:5432/x')).toBe('postgresql://amy:•••@db.test:5432/x');
    expect(addressHasPassword('https://qdrant.test')).toBe(false);
    expect(maskedAddress('https://qdrant.test:6333')).toBe('https://qdrant.test:6333');
  });
});
