import {
  AUTHENTICATION_SECTIONS,
  GENERAL_SECTIONS,
  getAdminConfig,
  getBanners,
  OwuiHttpError,
  saveAdminConfig,
  saveBanners,
  settingChanges,
  settingsPayload,
  type Capabilities,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

async function statusOf(run: () => Promise<unknown>): Promise<number> {
  try {
    await run();
    return 200;
  } catch (error) {
    if (error instanceof OwuiHttpError) return error.status;
    throw error;
  }
}

const FIELDS = [...GENERAL_SECTIONS, ...AUTHENTICATION_SECTIONS].flatMap((section) => section.fields);

/** The keys whose values differ between two reads of the config. */
const differing = (a: Record<string, unknown>, b: Record<string, unknown>) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]));

/**
 * M4.2: the admin settings form on General and Authentication. A non-admin is refused the admin
 * config. Only on the scratch instance: no edits make no request; one edit, laid over a fresh
 * read, changes that key alone (any other key the server rewrites is reported); putting it back
 * leaves the config as it was; an invalid sign-in duration is silently not saved by the server
 * (why the app checks it first); a probe banner added and the list put back exactly.
 */
export async function probeM4Settings({ client, capabilities, allowWrites }: { client: OwuiClient; capabilities: Capabilities; allowWrites: boolean }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const step = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };

  if (!capabilities.isAdmin) {
    await step('admin settings: the admin config refused to a non-admin', async () => {
      const status = await statusOf(() => getAdminConfig(client));
      if (status === 200) throw new Error('a non-admin read the admin config');
      return `refused (${status})`;
    });
    return { steps, fixture };
  }

  const before = await getAdminConfig(client);
  fixture.keys = Object.keys(before).sort();
  await step('admin settings: every field the app shows is in the config', async () => {
    const missing = FIELDS.filter((field) => !(field.key in before)).map((field) => field.key);
    if (missing.length) throw new Error(`not in this server’s config: ${missing.join(', ')}`);
    if (settingChanges(FIELDS, before, {}).length) throw new Error('no edits still found changes');
    return `${FIELDS.length} fields, all there; no edits, no request`;
  });

  if (!allowWrites) return { steps, fixture };

  const original = before.RESPONSE_WATERMARK;
  try {
    await step('admin settings: one edit changes one key, and putting it back restores the config', async () => {
      const edits = { RESPONSE_WATERMARK: 'APP PROBE watermark' };
      await saveAdminConfig(client, settingsPayload(FIELDS, await getAdminConfig(client), before, edits));
      const changed = await getAdminConfig(client);
      const what = differing(before, changed);
      fixture.rewritten = what.filter((key) => key !== 'RESPONSE_WATERMARK');
      if (!what.includes('RESPONSE_WATERMARK')) throw new Error('the edit didn’t take');
      await saveAdminConfig(client, settingsPayload(FIELDS, await getAdminConfig(client), changed, { RESPONSE_WATERMARK: typeof original === 'string' ? original : '' }));
      const after = await getAdminConfig(client);
      const left = differing(before, after);
      fixture.leftAfterRestore = left;
      if (left.length) throw new Error(`after putting it back these differ: ${left.join(', ')}`);
      return `only the watermark changed${(fixture.rewritten as string[]).length ? ` (the server also rewrote ${(fixture.rewritten as string[]).join(', ')})` : ''}; put back exactly`;
    });

    await step('admin settings: an invalid sign-in duration is silently not saved', async () => {
      const fresh = await getAdminConfig(client);
      const status = await statusOf(() => saveAdminConfig(client, { ...fresh, JWT_EXPIRES_IN: 'forever' }));
      const after = await getAdminConfig(client);
      fixture.invalidJwt = { status, kept: after.JWT_EXPIRES_IN === fresh.JWT_EXPIRES_IN };
      if (after.JWT_EXPIRES_IN !== fresh.JWT_EXPIRES_IN) throw new Error('the server stored it');
      return `answered ${status}, kept “${String(fresh.JWT_EXPIRES_IN)}” (the app refuses it before saving)`;
    });
  } finally {
    const now = await getAdminConfig(client).catch(() => null);
    if (now && now.RESPONSE_WATERMARK !== original) await saveAdminConfig(client, { ...now, RESPONSE_WATERMARK: original ?? null }).catch(() => undefined);
  }

  const banners = await getBanners(client);
  try {
    await step('admin settings: a banner added, then the list put back exactly', async () => {
      const probe = { id: `app-probe-${Date.now().toString(36)}`, type: 'warning' as const, title: '', content: 'APP PROBE banner', dismissible: true, timestamp: Math.floor(Date.now() / 1000) };
      await saveBanners(client, [...banners, probe]);
      const added = await getBanners(client);
      if (!added.some((banner) => banner.id === probe.id && banner.title === '' && banner.type === 'warning')) throw new Error('the banner didn’t come back as sent');
      await saveBanners(client, banners);
      const after = await getBanners(client);
      if (JSON.stringify(after) !== JSON.stringify(banners)) throw new Error('the list didn’t come back as it was');
      return `added and read back (no title as none); ${banners.length} banners as before`;
    });
  } finally {
    const now = await getBanners(client).catch(() => null);
    if (now && JSON.stringify(now) !== JSON.stringify(banners)) await saveBanners(client, banners).catch(() => undefined);
  }
  return { steps, fixture };
}
