import {
  getBanners,
  movedInList,
  pinnedNotesOrderOf,
  saveBanners,
  saveUiSettings,
  shortcutChoices,
  uiPatch,
  updateUserSettings,
  withPinnedModelsOrder,
  withShortcuts,
  type Capabilities,
  type OwuiClient,
  type UserSettings,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const rawSettings = (client: OwuiClient) => client.get<UserSettings | null>('/api/v1/users/user/settings?raw=true').then((settings) => settings ?? {});

/**
 * The orders the web drags, saved the app's way: your sidebar's pinned models (pins of models you
 * can't see kept after), pinned notes (`ui.pinnedNotesOrder`) and shortcuts (chosen and ordered,
 * `ui.pinnedMenuItems`), with every other setting kept, then your settings put back exactly; and,
 * for admins on the scratch servers only, two throwaway banners moved through the app's save, with
 * what else they carry (0.12's translations) kept, then the banners put back exactly.
 */
export async function probeOrders({ client, capabilities, baseUrl }: { client: OwuiClient; capabilities: Capabilities; baseUrl: string }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };

  if (!capabilities.isAdmin && !capabilities.can('settings.interface', true)) {
    steps.push({ name: 'sidebar orders', ok: true, note: 'skipped: this account may not change its settings' });
  } else {
    const original = await rawSettings(client);
    const keysBefore = Object.keys(original.ui ?? {}).sort();
    fixture.settings = { uiKeys: keysBefore.length };
    try {
      await check('pinned models, pinned notes and shortcuts saved in a new order; every other setting kept', async () => {
        const ui = record(original.ui);
        const models = withPinnedModelsOrder(['app-probe-a', 'app-probe-away', 'app-probe-b'], ['app-probe-b', 'app-probe-a']);
        const notes = ['app-probe-note-2', 'app-probe-note-1'];
        const choices = shortcutChoices(capabilities, ui.pinnedMenuItems);
        const order = [...choices.order].reverse();
        const menu = withShortcuts(capabilities, ui.pinnedMenuItems, order, order.slice(0, 1));
        await saveUiSettings(client, { pinnedModels: models, pinnedNotesOrder: notes, pinnedMenuItems: menu });
        const after = record((await rawSettings(client)).ui);
        if (!same(after.pinnedModels, ['app-probe-b', 'app-probe-a', 'app-probe-away'])) throw new Error('the pinned models came back in another order');
        if (!same(pinnedNotesOrderOf(after), notes)) throw new Error('the pinned notes order came back differently');
        if (!same(after.pinnedMenuItems, menu)) throw new Error('the shortcuts came back differently');
        for (const key of keysBefore.filter((key) => !['pinnedModels', 'pinnedNotesOrder', 'pinnedMenuItems'].includes(key))) if (!same(after[key], ui[key])) throw new Error(`the setting ${key} changed`);
        return `kept: ${menu.length} shortcut(s) pinned of ${choices.order.length} this account may use; ${keysBefore.length} other settings untouched`;
      });
    } finally {
      await check('your settings put back as they were', async () => {
        // Keys the probe added go with null: 0.12 keeps a key that's left out.
        await updateUserSettings(client, { ...original, ui: uiPatch((await rawSettings(client)).ui, original.ui ?? {}) });
        const now = await rawSettings(client);
        if (!same(now.ui ?? {}, original.ui ?? {})) throw new Error('the settings differ from before');
        return 'identical';
      });
    }
  }

  if (!capabilities.isAdmin || !/^http:\/\/127\.0\.0\.1:(3013|3014)\/?$/.test(baseUrl)) {
    steps.push({ name: 'banners', ok: true, note: 'skipped: admins on the scratch servers only' });
    return { steps, fixture };
  }
  const before = list(await client.get<unknown>('/api/v1/configs/banners'));
  fixture.banners = before.length;
  try {
    await check('banners moved through the app’s save, what else they carry (0.12’s translations) kept', async () => {
      const stamp = Math.floor(new Date().getTime() / 1000);
      const probe = ['1', '2'].map((n) => ({ id: `app-probe-banner-${n}`, type: 'info', title: `APP PROBE ${n}`, content: `banner ${n}`, dismissible: true, timestamp: stamp, i18n: { ms: { content: `sepanduk ${n}` } } }));
      await client.post<unknown>('/api/v1/configs/banners', { banners: [...before, ...probe] });
      const read = await getBanners(client);
      const translated = Boolean(read.find((banner) => banner.id === 'app-probe-banner-1')?.extra?.i18n);
      const first = read.findIndex((banner) => banner.id === 'app-probe-banner-1');
      const second = read.findIndex((banner) => banner.id === 'app-probe-banner-2');
      await saveBanners(client, movedInList(read, second, first));
      const raw = list(await client.get<unknown>('/api/v1/configs/banners')).map(record);
      const ids = raw.map((banner) => banner.id);
      if (ids.indexOf('app-probe-banner-2') !== first || ids.indexOf('app-probe-banner-1') !== first + 1) throw new Error('not in the new order');
      if (translated && !raw.filter((banner) => String(banner.id).startsWith('app-probe-banner-')).every((banner) => record(banner.i18n).ms)) throw new Error('the translations were lost');
      return `the second banner went up${translated ? '; their translations kept' : ' (this version keeps no translations)'}`;
    });
  } finally {
    await check('the banners put back as they were', async () => {
      await client.post<unknown>('/api/v1/configs/banners', { banners: before });
      const now = list(await client.get<unknown>('/api/v1/configs/banners'));
      if (!same(now, before)) throw new Error('they differ from before');
      return `as before (${before.length})`;
    });
  }
  return { steps, fixture };
}
