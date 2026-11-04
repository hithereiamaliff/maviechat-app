import { describe, expect, it } from 'vitest';
import { accessRights, accessStateOf, droppedGrants, grantsFromState, updateAccess } from './access';
import type { Capabilities } from './capabilities';
import { OwuiClient, type FetchLike } from './http';

function recordingClient(answer: unknown) {
  const calls: { url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(answer), { status: 200 });
  };
  return { client: new OwuiClient({ baseUrl: 'https://chat.test', token: 't', fetch }), calls };
}

describe('sharing a Workspace item', () => {
  it('reads grants as everyone and each person or group, write beside read', () => {
    const state = accessStateOf([
      { principal_type: 'user', principal_id: '*', permission: 'read' },
      { principal_type: 'group', principal_id: 'g1', permission: 'read' },
      { principal_type: 'group', principal_id: 'g1', permission: 'write' },
      { principal_type: 'user', principal_id: 'u2', permission: 'read' },
      { principal_type: 'anyone', principal_id: '*', permission: 'read' },
    ]);
    expect(state).toEqual({ everyone: 'read', entries: [{ type: 'group', id: 'g1', write: true }, { type: 'user', id: 'u2', write: false }] });
    expect(grantsFromState({ everyone: 'write', entries: [{ type: 'user', id: 'u2', write: true }] })).toEqual([
      { principal_type: 'user', principal_id: '*', permission: 'read' },
      { principal_type: 'user', principal_id: '*', permission: 'write' },
      { principal_type: 'user', principal_id: 'u2', permission: 'read' },
      { principal_type: 'user', principal_id: 'u2', permission: 'write' },
    ]);
    expect(grantsFromState({ everyone: 'none', entries: [] })).toEqual([]);
  });

  it('knows what this account may grant', () => {
    const can = (granted: string[]) => ({ isAdmin: false, can: (path: string, fallback = false) => (granted.includes(path) ? true : fallback) }) as unknown as Capabilities;
    expect(accessRights(can(['sharing.models']), 'models')).toEqual({ list: true, everyone: false, people: true, groups: true });
    expect(accessRights({ isAdmin: true } as unknown as Capabilities, 'tools')).toEqual({ list: true, everyone: true, people: true, groups: true });
  });

  it('saves through each area’s own address, and spots what wasn’t kept', async () => {
    const sent = [
      { principal_type: 'user' as const, principal_id: '*', permission: 'read' as const },
      { principal_type: 'user' as const, principal_id: 'u2', permission: 'read' as const },
    ];
    const { client, calls } = recordingClient({ id: 'm', access_grants: [sent[1]] });
    const kept = await updateAccess(client, 'models', 'm', sent);
    expect(calls[0]).toEqual({ url: 'https://chat.test/api/v1/models/model/access/update', body: { id: 'm', access_grants: sent } });
    expect(droppedGrants(sent, kept)).toEqual([sent[0]]);
    const other = recordingClient({ access_grants: [] });
    await updateAccess(other.client, 'prompts', 'p 1', []);
    expect(other.calls[0]?.url).toBe('https://chat.test/api/v1/prompts/id/p%201/access/update');
  });
});
