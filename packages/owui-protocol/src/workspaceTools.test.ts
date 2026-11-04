import { describe, expect, it } from 'vitest';
import { OwuiClient, type FetchLike } from './http';
import { filterTools, getWorkspaceTool, listWorkspaceTools, updateToolValves, type WorkspaceTool } from './workspaceTools';

function recordingClient(...answers: unknown[]) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(answers.shift() ?? null), { status: 200 });
  };
  return { client: new OwuiClient({ baseUrl: 'https://chat.test', token: 't', fetch }), calls };
}

const TOOL = {
  id: 'weather',
  name: 'Weather',
  user_id: 'u1',
  meta: { description: 'Forecasts', manifest: { version: '1.2', author: 'Amy', funding_url: 'https://example.com/fund', requirements: 'requests' }, has_user_valves: true },
  access_grants: [{ principal_type: 'user', principal_id: '*', permission: 'read' }],
  write_access: true,
  user: { name: 'Amy' },
  updated_at: 1_730_000_000,
};

describe('workspace tools', () => {
  it('reads the list with each tool’s header, and its code only when given', async () => {
    const { client } = recordingClient([TOOL, { id: '' }], { ...TOOL, content: 'class Tools: ...' });
    const [tool] = await listWorkspaceTools(client);
    expect(tool).toMatchObject({ id: 'weather', description: 'Forecasts', version: '1.2', author: 'Amy', fundingUrl: 'https://example.com/fund', requirements: 'requests', hasUserValves: true, content: null, ownerId: 'u1', ownerName: 'Amy', writeAccess: true, updatedAt: 1_730_000_000_000 });
    expect(tool?.accessGrants).toHaveLength(1);
    expect((await getWorkspaceTool(client, 'weather')).content).toBe('class Tools: ...');
  });

  it('searches, filters by whose and orders the whole list here', () => {
    const tool = (id: string, name: string, ownerId: string, updatedAt: number): WorkspaceTool => ({ id, name, description: '', manifest: {}, version: '', author: '', fundingUrl: '', requirements: '', hasUserValves: false, content: null, ownerId, ownerName: ownerId === 'me' ? 'Me' : 'Bo', accessGrants: [], writeAccess: false, updatedAt });
    const tools = [tool('a', 'Zebra', 'me', 1), tool('b', 'Apple', 'bo', 3), tool('c', 'Mango', 'me', 2)];
    expect(filterTools(tools, {}).map((item) => item.id)).toEqual(['b', 'c', 'a']);
    expect(filterTools(tools, { byName: true }).map((item) => item.id)).toEqual(['b', 'c', 'a']);
    expect(filterTools(tools, { view: 'created', me: 'me', byName: true }).map((item) => item.id)).toEqual(['c', 'a']);
    expect(filterTools(tools, { view: 'shared', me: 'me' }).map((item) => item.id)).toEqual(['b']);
    expect(filterTools(tools, { query: 'bo' }).map((item) => item.id)).toEqual(['b']);
  });

  it('saves shared valves as given (nulls are defaults)', async () => {
    const { client, calls } = recordingClient({ limit: 5 });
    expect(await updateToolValves(client, 'weather', { limit: 5, api_key: null })).toEqual({ limit: 5 });
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://chat.test/api/v1/tools/id/weather/valves/update', body: { limit: 5, api_key: null } });
  });
});
