import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createExternalSource,
  deleteWorkspaceKnowledge,
  externalFormOf,
  getWorkspaceKnowledge,
  listExternalConnections,
  listExternalSources,
  newExternalForm,
  OwuiHttpError,
  setExternalConnectionEnabled,
  testExternalSource,
  updateAccess,
  updateExternalSource,
  withExternalProvider,
  type Capabilities,
  type ExternalForm,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

/** Docker's bridge on this machine: where the scratch containers reach the host (ufw lets docker0 in). */
const BRIDGE = '172.17.0.1';
const COLLECTION = 'app-probe-tides';
const EMPTY = 'app-probe-empty';

/**
 * A stand-in for Qdrant's HTTP API, only what Open WebUI's Qdrant client asks: the server's
 * version, then a points query. Two passages for the probe's collection, none for an empty one,
 * and Qdrant's own "not found" for any other. It remembers the key and collection each query
 * came with (keys are compared, never printed).
 */
async function fakeQdrant() {
  const seen: { key: string; collection: string; limit: number; dims: number }[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    request.on('end', () => {
      const send = (status: number, value: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(value));
      };
      const url = request.url ?? '/';
      if (request.method === 'GET' && (url === '/' || url.startsWith('/?'))) return send(200, { title: 'qdrant - vector search engine', version: '1.18.0' });
      const match = /^\/collections\/([^/?]+)\/points\/query(?:\?|$)/.exec(url);
      if (request.method !== 'POST' || !match) return send(404, { status: { error: 'Not found' }, time: 0 });
      const collection = decodeURIComponent(match[1] ?? '');
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(body || '{}') as Record<string, unknown>;
      } catch {
        // an unreadable body counts as no vector
      }
      const query = parsed.query;
      const vector = Array.isArray(query) ? query : Array.isArray((query as { nearest?: unknown } | undefined)?.nearest) ? ((query as { nearest: unknown[] }).nearest as unknown[]) : [];
      seen.push({ key: String(request.headers['api-key'] ?? ''), collection, limit: Number(parsed.limit ?? 0), dims: vector.length });
      if (collection === EMPTY) return send(200, { result: { points: [] }, status: 'ok', time: 0.0001 });
      if (collection !== COLLECTION) return send(404, { status: { error: `Not found: Collection \`${collection}\` doesn't exist!` }, time: 0 });
      return send(200, {
        result: {
          points: [
            { id: 1, version: 0, score: 0.91, payload: { text: 'APP PROBE passage about tides.', metadata: { source: 'app-probe' } } },
            { id: 2, version: 0, score: 0.72, payload: { text: 'APP PROBE passage about the moon.', metadata: { source: 'app-probe' } } },
          ],
        },
        status: 'ok',
        time: 0.0001,
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, BRIDGE, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return { url: `http://${BRIDGE}:${port}`, seen, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/**
 * Admin → External Knowledge, the app's way (admins, scratch servers only). The server's own
 * refusals: an unknown database, Milvus without a vector field, no text field. Then against a
 * Qdrant stand-in on Docker's bridge, up only while the probe runs: a test finds two passages
 * (with the key, the collection, five asked for, and a query vector); a new source is saved
 * private, listed with "key saved" and the key itself nowhere in the list; switched off and on,
 * its key kept; changed without retyping the key (the server still sends the saved one), a change
 * to an empty collection refused with nothing changed, a new key taken; its sharing kept through
 * a change; deleted, and its connection gone with it.
 */
export async function probeExternalKnowledge({ client, capabilities, baseUrl }: { client: OwuiClient; capabilities: Capabilities; baseUrl: string }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
      return true;
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
      return false;
    }
  };
  if (!capabilities.isAdmin || !/^http:\/\/127\.0\.0\.1:(3013|3014)\/?$/.test(baseUrl)) {
    steps.push({ name: 'external knowledge', ok: true, note: 'skipped: admins on the scratch servers only' });
    return { steps, fixture };
  }
  const statusOf = (run: () => Promise<unknown>) =>
    run().then(
      () => 200,
      (error: unknown) => {
        if (error instanceof OwuiHttpError) return `${error.status}${error.detail ? ` (${error.detail})` : ''}`;
        throw error;
      },
    );
  const stamp = Date.now().toString(36);
  const question = 'What do the tides do?';

  await check('the server’s own refusals: an unknown database, Milvus without a vector field, no text field', async () => {
    const base: ExternalForm = { ...newExternalForm(), name: `APP PROBE refused ${stamp}`, endpoint: 'http://127.0.0.1:9', collection: COLLECTION };
    const unknown = await statusOf(() => testExternalSource(client, { ...base, provider: 'weaviate' as ExternalForm['provider'] }, question));
    const milvus = await statusOf(() => testExternalSource(client, { ...withExternalProvider(base, 'milvus'), vectorField: '' }, question));
    const noText = await statusOf(() => testExternalSource(client, { ...base, contentField: '' }, question));
    fixture.refusals = { unknown, milvus, noText };
    if ([unknown, milvus, noText].some((status) => !String(status).startsWith('400'))) throw new Error(`answers: ${unknown}; ${milvus}; ${noText}`);
    return `each refused: ${unknown}; ${milvus}; ${noText}`;
  });

  let fake: Awaited<ReturnType<typeof fakeQdrant>> | null = null;
  try {
    fake = await fakeQdrant();
  } catch (error) {
    steps.push({ name: 'a Qdrant stand-in on Docker’s bridge', ok: false, note: `couldn’t listen there: ${error instanceof Error ? error.message : String(error)}` });
    return { steps, fixture };
  }
  const stand = fake;
  const firstKey = `probe-${randomBytes(9).toString('hex')}`;
  const secondKey = `probe-${randomBytes(9).toString('hex')}`;
  const form: ExternalForm = { ...newExternalForm(), name: `APP PROBE external ${stamp}`, description: 'APP PROBE', endpoint: stand.url, key: firstKey, collection: COLLECTION };
  let knowledgeId = '';
  try {
    const tested = await check('a test finds the passages, sent with the key, the collection, five asked for and a query vector', async () => {
      const result = await testExternalSource(client, form, question);
      const asked = stand.seen.at(-1);
      if (result.passages.length !== 2 || !result.passages.every((passage) => passage.text.includes('APP PROBE'))) throw new Error(`${result.passages.length} passages`);
      if (!asked || asked.key !== firstKey || asked.collection !== COLLECTION || asked.limit !== 5 || asked.dims < 8) throw new Error('the query didn’t come as expected');
      fixture.queryDims = asked.dims;
      return `2 passages (distances ${result.passages.map((passage) => passage.distance?.toFixed(2) ?? 'none').join(', ')}); the key matched; a ${asked.dims}-number query vector`;
    });
    if (!tested) return { steps, fixture };

    await check('saved: private, listed with “key saved”, and the key itself nowhere in the list', async () => {
      knowledgeId = await createExternalSource(client, form, question);
      if (!knowledgeId) throw new Error('no knowledge base came back');
      const { sources, connections } = await listExternalSources(client);
      const source = sources.find((item) => item.knowledge.id === knowledgeId);
      const connection = connections.find((item) => item.id === source?.connectionId);
      if (!source || !connection) throw new Error('it isn’t listed with its connection');
      if (!connection.keySaved || !connection.enabled || connection.endpoint !== stand.url) throw new Error('the connection isn’t as saved');
      if (source.knowledge.accessGrants.length) throw new Error('it was shared');
      const raw = JSON.stringify(await client.get<unknown>('/api/v1/knowledge/external/connections'));
      if (raw.includes(firstKey)) throw new Error('the key came back in the list');
      const form2 = externalFormOf(source, connection);
      if (form2.key !== '' || form2.collection !== COLLECTION || form2.contentField !== 'payload.text') throw new Error('the form doesn’t read back');
      return 'a connected collection (Qdrant), private, on, key saved and never sent back';
    });

    await check('switched off and on again, its key kept', async () => {
      const before = (await listExternalConnections(client)).find((item) => item.endpoint === stand.url);
      if (!before) throw new Error('no connection');
      const off = await setExternalConnectionEnabled(client, before, false);
      const offListed = (await listExternalConnections(client)).find((item) => item.id === before.id);
      if (off.enabled || offListed?.enabled !== false || !offListed.keySaved) throw new Error('it didn’t switch off as expected');
      const source = (await listExternalSources(client)).sources.find((item) => item.knowledge.id === knowledgeId);
      const whileOff = source ? await statusOf(() => testExternalSource(client, externalFormOf(source, offListed), question, offListed)) : 'no source';
      const on = await setExternalConnectionEnabled(client, offListed, true);
      if (!on.enabled || !on.keySaved) throw new Error('it didn’t switch on with its key');
      fixture.testWhileOff = whileOff;
      if (whileOff === 200) throw new Error('an off source still answered a test');
      return `off (a test is refused: ${whileOff}), then on; the key stayed saved`;
    });

    await check('changed without retyping the key: the server still sends the saved one', async () => {
      await updateAccess(client, 'knowledge', knowledgeId, [{ principal_type: 'user', principal_id: '*', permission: 'read' }], form.name);
      const { sources, connections } = await listExternalSources(client);
      const source = sources.find((item) => item.knowledge.id === knowledgeId);
      const connection = connections.find((item) => item.id === source?.connectionId);
      if (!source || !connection) throw new Error('not listed');
      const before = stand.seen.length;
      const change = { ...externalFormOf(source, connection), name: `${form.name} renamed`, description: 'APP PROBE changed' };
      await updateExternalSource(client, knowledgeId, change, question, connection);
      const keys = stand.seen.slice(before).map((item) => item.key);
      if (!keys.length || keys.some((key) => key !== firstKey)) throw new Error('the server didn’t send the saved key');
      const after = await getWorkspaceKnowledge(client, knowledgeId);
      if (after.name !== change.name) throw new Error('the name didn’t change');
      if (!after.accessGrants.some((grant) => grant.principal_id === '*')) throw new Error('its sharing was lost');
      return 'renamed; the saved key went with the server’s test; its sharing (everyone may read) kept';
    });

    await check('a change to an empty collection is refused, and nothing changes', async () => {
      const { sources, connections } = await listExternalSources(client);
      const source = sources.find((item) => item.knowledge.id === knowledgeId);
      const connection = connections.find((item) => item.id === source?.connectionId);
      if (!source || !connection) throw new Error('not listed');
      const empty = await statusOf(() => updateExternalSource(client, knowledgeId, { ...externalFormOf(source, connection), collection: EMPTY }, question, connection));
      const unknown = await statusOf(() => testExternalSource(client, { ...externalFormOf(source, connection), collection: 'app-probe-missing' }, question, connection));
      const now = (await listExternalSources(client)).sources.find((item) => item.knowledge.id === knowledgeId);
      fixture.emptyChange = empty;
      if (empty === 200) throw new Error('the server saved a source that finds nothing');
      if (now?.collection !== COLLECTION) throw new Error('the collection changed anyway');
      return `refused (${empty}); an unknown collection’s test: ${unknown}; still the old collection`;
    });

    await check('a new key typed: the server uses it from then on', async () => {
      const { sources, connections } = await listExternalSources(client);
      const source = sources.find((item) => item.knowledge.id === knowledgeId);
      const connection = connections.find((item) => item.id === source?.connectionId);
      if (!source || !connection) throw new Error('not listed');
      await updateExternalSource(client, knowledgeId, { ...externalFormOf(source, connection), key: secondKey }, question, connection);
      const before = stand.seen.length;
      const fresh = (await listExternalConnections(client)).find((item) => item.id === connection.id);
      if (!fresh) throw new Error('the connection is gone');
      await testExternalSource(client, externalFormOf(source, fresh), question, fresh);
      const keys = stand.seen.slice(before).map((item) => item.key);
      if (!keys.length || keys.some((key) => key !== secondKey)) throw new Error('the new key wasn’t used');
      return 'the new key was saved and sent';
    });
  } finally {
    await check('deleted, and its connection gone with it', async () => {
      if (knowledgeId) await deleteWorkspaceKnowledge(client, knowledgeId);
      // Anything left pointing at the stand-in (a run cut short) goes too.
      for (const connection of await listExternalConnections(client)) {
        if (connection.endpoint === stand.url) await client.delete<unknown>(`/api/v1/knowledge/external/connections/${encodeURIComponent(connection.id)}`).catch(() => undefined);
      }
      const left = (await listExternalConnections(client)).filter((connection) => connection.endpoint === stand.url);
      const stillThere = knowledgeId ? await statusOf(() => getWorkspaceKnowledge(client, knowledgeId)) : 'none made';
      if (left.length) throw new Error(`${left.length} connections left`);
      if (stillThere === 200) throw new Error('the knowledge base is still there');
      return `the knowledge base (${stillThere}) and its connection gone`;
    });
    await stand.close();
  }
  return { steps, fixture };
}
