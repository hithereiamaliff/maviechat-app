import { describe, expect, it } from 'vitest';
import { appScopeLabel, appSlugFrom, appSlugProblem, connectApp, forEveryone, getApp, installApp, listApps, manifestChanged, manifestProblem, previewAppManifest, uninstallApp, updateApp, withEveryone, type AppManifest } from './apps';
import { OwuiClient, type FetchLike } from './http';

function server(routes: Record<string, unknown>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    const path = new URL(url).pathname;
    calls.push({ method, path, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(routes[`${method} ${path}`] ?? {}), { status: 200 });
  };
  return { client: new OwuiClient({ baseUrl: 'https://chat.test', token: 't', fetch }), calls };
}

const KEY = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA\n-----END PUBLIC KEY-----\n';
const MANIFEST = { id: 'Weather.Bot', name: 'Weather', description: 'Forecasts', profile_image_url: null, public_key: KEY, requested_scopes: ['channels:read', 'channels:messages:write'] };
const APP = { id: 'a1', slug: 'weather-bot', name: 'Weather', is_active: true, configured: true, connection_status: 'connecting', data: { url: 'https://weather.test/app', manifest: MANIFEST, granted_scopes: ['channels:read'], settings: {} }, created_at: 1 };

describe('apps', () => {
  it('lists apps with their state, and reads one with who may use it', async () => {
    const { client } = server({ 'GET /api/v1/apps': [APP, {}], 'GET /api/v1/apps/a1': { ...APP, access_grants: [{ principal_type: 'user', principal_id: '*', permission: 'read' }] } });
    const [app] = await listApps(client);
    expect(app).toMatchObject({ id: 'a1', slug: 'weather-bot', active: true, configured: true, connection: 'connecting', url: 'https://weather.test/app', grantedScopes: ['channels:read'], accessGrants: null });
    expect(app?.manifest).toEqual({ id: 'Weather.Bot', name: 'Weather', description: 'Forecasts', picture: null, publicKey: KEY, requestedScopes: ['channels:read', 'channels:messages:write'] });
    expect(forEveryone((await getApp(client, 'a1')).accessGrants)).toBe(true);
  });

  it('reads a manifest with a key, or an installed app’s saved one', async () => {
    const { client, calls } = server({ 'POST /api/v1/apps/manifest/preview': MANIFEST });
    expect((await previewAppManifest(client, { url: ' https://weather.test/app ', apiKey: ' k ' })).name).toBe('Weather');
    expect(calls[0]?.body).toEqual({ url: 'https://weather.test/app', api_key: 'k' });
    await previewAppManifest(client, { url: 'https://weather.test/app', appId: 'a1' });
    expect(calls[1]?.body).toEqual({ url: 'https://weather.test/app', app_id: 'a1' });
  });

  it('installs, changes, connects and uninstalls the server’s way', async () => {
    const { client, calls } = server({ 'POST /api/v1/apps': APP, 'PATCH /api/v1/apps/a1': APP, 'POST /api/v1/apps/a1/connect': APP, 'DELETE /api/v1/apps/a1': { ...APP, is_active: false, configured: false } });
    const manifest: AppManifest = { id: 'Weather.Bot', name: ' Weather ', description: '', picture: null, publicKey: KEY, requestedScopes: ['channels:read'] };
    await installApp(client, { manifest, url: 'https://weather.test/app', apiKey: ' k ', slug: 'weather-bot', grantedScopes: ['channels:read'], accessGrants: [] });
    expect(calls[0]?.body).toEqual({ manifest: { id: 'Weather.Bot', name: 'Weather', description: '', profile_image_url: null, public_key: KEY.trim(), requested_scopes: ['channels:read'] }, url: 'https://weather.test/app', api_key: 'k', slug: 'weather-bot', granted_scopes: ['channels:read'], access_grants: [] });
    await updateApp(client, 'a1', { name: 'Weather 2', grantedScopes: [], off: true });
    expect(calls[1]).toMatchObject({ method: 'PATCH', body: { is_active: false, name: 'Weather 2', granted_scopes: [] } });
    await connectApp(client, 'a1');
    expect(calls[2]?.body).toEqual({});
    await connectApp(client, 'a1', ' new ');
    expect(calls[3]?.body).toEqual({ api_key: 'new' });
    expect(await uninstallApp(client, 'a1')).toMatchObject({ active: false, configured: false });
  });

  it('makes a short name as the web does, and checks one', () => {
    expect(appSlugFrom('Weather.Bot')).toBe('weather-bot');
    expect(appSlugFrom('42 Tools!')).toBe('tools-');
    expect(appSlugFrom('___')).toBe('app');
    expect(appSlugProblem('weather-bot')).toBeNull();
    expect(appSlugProblem('Weather')).not.toBeNull();
    expect(appSlugProblem('1x')).not.toBeNull();
  });

  it('keeps others while sharing with everyone or not', () => {
    const group = { principal_type: 'group' as const, principal_id: 'g1', permission: 'read' as const };
    expect(withEveryone([group], true)).toEqual([group, { principal_type: 'user', principal_id: '*', permission: 'read' }]);
    expect(withEveryone(withEveryone([group], true), false)).toEqual([group]);
  });

  it('checks a manifest typed by hand, and tells a changed one', () => {
    const manifest: AppManifest = { id: 'w', name: 'W', description: '', picture: null, publicKey: KEY, requestedScopes: ['channels:read'] };
    expect(manifestProblem(manifest)).toBeNull();
    expect(manifestProblem({ ...manifest, publicKey: 'abc' })).toMatch(/public key/);
    expect(manifestProblem({ ...manifest, requestedScopes: [] })).toMatch(/asks for/);
    expect(manifestChanged(manifest, { ...manifest })).toBe(false);
    expect(manifestChanged(manifest, { ...manifest, requestedScopes: ['channels:read', 'channels:messages:read'] })).toBe(true);
    expect(appScopeLabel('channels:messages:write')).toMatch(/Send messages/);
    expect(appScopeLabel('channels:unknown')).toBe('channels:unknown');
  });
});
