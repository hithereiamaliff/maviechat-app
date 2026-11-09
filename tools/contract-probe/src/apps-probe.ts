import { generateKeyPairSync, randomBytes } from 'node:crypto';
import {
  connectApp,
  forEveryone,
  getAdminConfig,
  getApp,
  installApp,
  listApps,
  OwuiHttpError,
  previewAppManifest,
  saveAdminConfig,
  uninstallApp,
  updateApp,
  withEveryone,
  type AppManifest,
  type Capabilities,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

/** One app for every run (uninstalled apps can't be deleted, so the probe reuses its own). */
const SLUG = 'app-probe';
/** An address that never resolves (.invalid): the server's connection fails as it should. */
const URL = 'https://app-probe.invalid/socket';

/**
 * Admin → Apps, the app's way (admins, scratch servers only; Apps are switched on for the run and
 * put back after). Off: listing answers 404. On: reading a manifest over plain HTTP from a private
 * address, or from an address that doesn't resolve, is refused with the server's reason; an app
 * installed by hand (a new Ed25519 key, an address that never resolves) is listed off with its
 * key saved, everyone allowed; renamed, access narrowed and widened, everyone taken off and put
 * back; access it didn't ask for refused; switching it on without connecting refused;
 * connecting fails with the server's reason, and it stays off; uninstalled, it stays listed
 * without its key. On 0.11 there are no Apps, so the app shows none.
 */
export async function probeApps({ client, capabilities, baseUrl }: { client: OwuiClient; capabilities: Capabilities; baseUrl: string }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
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
    steps.push({ name: 'apps', ok: true, note: 'skipped: admins on the scratch servers only' });
    return { steps, fixture };
  }
  const before = await getAdminConfig(client);
  if (!('ENABLE_APPS' in before)) {
    steps.push({ name: 'none on this server, so the app shows none', ok: true, note: 'no ENABLE_APPS in the admin config (0.11)' });
    return { steps, fixture };
  }
  const answer = (run: () => Promise<unknown>) =>
    run().then(
      () => '200',
      (error: unknown) => {
        if (error instanceof OwuiHttpError) return `${error.status}${error.detail ? ` (${error.detail})` : ''}`;
        throw error;
      },
    );
  const wasOn = before.ENABLE_APPS === true;
  fixture.wasOn = wasOn;
  try {
    if (!wasOn) {
      await check('off: listing them answers 404', async () => {
        const status = await answer(() => listApps(client));
        if (!status.startsWith('404')) throw new Error(status);
        return status;
      });
      await saveAdminConfig(client, { ...(await getAdminConfig(client)), ENABLE_APPS: true });
    }

    await check('a manifest over plain HTTP from a private address, or from one that doesn’t resolve, is refused with the reason', async () => {
      const plain = await answer(() => previewAppManifest(client, { url: 'http://172.17.0.1:9/manifest', apiKey: 'probe' }));
      const nowhere = await answer(() => previewAppManifest(client, { url: 'https://app-probe.invalid/manifest', apiKey: 'probe' }));
      fixture.preview = { plain, nowhere };
      if (plain === '200' || nowhere === '200') throw new Error(`answers: ${plain}; ${nowhere}`);
      return `${plain}; ${nowhere}`;
    });

    const publicKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const manifest: AppManifest = { id: SLUG, name: 'APP PROBE app', description: 'APP PROBE', picture: null, publicKey, requestedScopes: ['channels:read', 'channels:mentions:read'] };
    let appId = (await listApps(client)).find((app) => app.slug === SLUG)?.id ?? '';
    const reused = Boolean(appId);
    await check(reused ? 'the probe’s app from an earlier run, installed again by connecting with a key' : 'installed by hand: listed off, its key saved, everyone allowed', async () => {
      if (!appId) {
        const made = await installApp(client, { manifest, url: URL, apiKey: `probe-${randomBytes(8).toString('hex')}`, slug: SLUG, grantedScopes: ['channels:read'], accessGrants: withEveryone([], true) });
        appId = made.id;
        const read = await getApp(client, appId);
        if (read.active || !read.configured || read.grantedScopes.join() !== 'channels:read' || !forEveryone(read.accessGrants)) throw new Error('it isn’t as installed');
        const taken = await answer(() => installApp(client, { manifest, url: URL, apiKey: 'probe', slug: SLUG, grantedScopes: [], accessGrants: [] }));
        if (!taken.startsWith('409')) throw new Error(`a second app with the same short name answered ${taken}`);
        return `off, key saved, may read its channels, everyone allowed; the same short name again refused (${taken})`;
      }
      const status = await answer(() => connectApp(client, appId, `probe-${randomBytes(8).toString('hex')}`));
      const read = await getApp(client, appId);
      if (!read.configured || read.active) throw new Error('its key wasn’t saved, or it came on');
      return `its key saved again; connecting answered ${status}`;
    });
    if (!appId) return { steps, fixture };

    await check('renamed; access narrowed and widened; everyone off and back; access it didn’t ask for refused', async () => {
      await updateApp(client, appId, { name: 'APP PROBE app renamed', grantedScopes: [] });
      let read = await getApp(client, appId);
      if (read.name !== 'APP PROBE app renamed' || read.grantedScopes.length) throw new Error('the rename or the narrowing didn’t take');
      await updateApp(client, appId, { name: 'APP PROBE app', grantedScopes: read.manifest.requestedScopes, accessGrants: withEveryone(read.accessGrants ?? [], false) });
      read = await getApp(client, appId);
      if (forEveryone(read.accessGrants) || read.grantedScopes.length !== read.manifest.requestedScopes.length) throw new Error('the widening or everyone off didn’t take');
      await updateApp(client, appId, { accessGrants: withEveryone(read.accessGrants ?? [], true) });
      const unrequested = await answer(() => updateApp(client, appId, { grantedScopes: ['channels:messages:write'] }));
      read = await getApp(client, appId);
      if (!forEveryone(read.accessGrants)) throw new Error('everyone wasn’t put back');
      if (!unrequested.startsWith('400')) throw new Error(`access it didn’t ask for answered ${unrequested}`);
      return `all as asked; access it didn’t ask for: ${unrequested}`;
    });

    await check('switching it on without connecting is refused; connecting fails with the reason, and it stays off', async () => {
      const on = await answer(() => client.patch<unknown>(`/api/v1/apps/${encodeURIComponent(appId)}`, { is_active: true }));
      const connect = await answer(() => connectApp(client, appId));
      const read = await getApp(client, appId);
      fixture.connect = connect;
      if (!on.startsWith('400')) throw new Error(`switching on answered ${on}`);
      if (connect === '200' || read.active) throw new Error('it connected to an address that doesn’t resolve');
      return `on: ${on}; connect: ${connect}; still off`;
    });

    await check('uninstalled: it stays listed, off and without its key', async () => {
      const gone = await uninstallApp(client, appId);
      const listed = (await listApps(client)).find((app) => app.id === appId);
      if (gone.configured || gone.active || !listed || listed.configured) throw new Error('not as uninstalled');
      return 'listed as uninstalled (one inert record kept for the next run)';
    });
  } finally {
    await check('Apps put back as they were', async () => {
      const now = await getAdminConfig(client);
      if ((now.ENABLE_APPS === true) !== wasOn) await saveAdminConfig(client, { ...now, ENABLE_APPS: wasOn });
      const after = await getAdminConfig(client);
      if ((after.ENABLE_APPS === true) !== wasOn) throw new Error('not put back');
      return wasOn ? 'on, as before' : 'off, as before';
    });
  }
  return { steps, fixture };
}
