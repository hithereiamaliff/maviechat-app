import { describe, expect, it } from 'vitest';
import { OwuiClient, type FetchLike } from './http';
import { listAdminFunctions, setFunctionActive, setFunctionGlobal, updateSharedValves } from './adminFunctions';

function routedClient(routes: Record<string, unknown>) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(routes[`${init?.method ?? 'GET'} ${new URL(url).pathname}`] ?? {}), { status: 200 });
  };
  return { client: new OwuiClient({ baseUrl: 'https://chat.test', token: 't', fetch }), calls };
}

describe('admin functions', () => {
  it('reads each function’s kind, header and switches', async () => {
    const { client } = routedClient({ 'GET /api/v1/functions/list': [{ id: 'image_ocr', name: 'Image OCR', type: 'filter', is_active: true, is_global: false, meta: { description: 'Reads pictures', manifest: { author: 'Amy', version: '1.0', funding_url: 'https://fund.test' } }, updated_at: 1_730_000_000 }, { id: '' }] });
    expect(await listAdminFunctions(client)).toEqual([{ id: 'image_ocr', name: 'Image OCR', type: 'filter', description: 'Reads pictures', author: 'Amy', version: '1.0', fundingUrl: 'https://fund.test', isActive: true, isGlobal: false, content: null, updatedAt: 1_730_000_000_000 }]);
  });

  it('flips a switch only when it isn’t already where asked', async () => {
    const { client, calls } = routedClient({ 'GET /api/v1/functions/id/f1': { id: 'f1', is_active: true, is_global: false } });
    await setFunctionActive(client, 'f1', true);
    await setFunctionGlobal(client, 'f1', true);
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual(['GET /api/v1/functions/id/f1', 'GET /api/v1/functions/id/f1', 'POST /api/v1/functions/id/f1/toggle/global']);
  });

  it('leaves settings at their default out, never sending null', async () => {
    const { client, calls } = routedClient({});
    await updateSharedValves(client, 'functions', 'f1', { api_key: null, limit: 3, tags: undefined });
    expect(calls[0]).toMatchObject({ url: 'https://chat.test/api/v1/functions/id/f1/valves/update', body: { limit: 3 } });
  });
});
