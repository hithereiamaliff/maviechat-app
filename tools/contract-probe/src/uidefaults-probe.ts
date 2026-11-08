import { getAdminConfig, getConfig, interfaceDefaultsOf, OwuiHttpError, saveAdminConfig, saveInterfaceDefaults, uiValue, type Capabilities, type OwuiClient } from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

type Tree = Record<string, unknown>;

const isTree = (value: unknown): value is Tree => typeof value === 'object' && value !== null && !Array.isArray(value);
const withoutDefaults = (config: Tree) => JSON.stringify(Object.fromEntries(Object.entries(config).filter(([key]) => key !== 'DEFAULT_INTERFACE_SETTINGS').sort(([a], [b]) => a.localeCompare(b))));

/**
 * Everyone's Interface defaults the app's way (admins), put back exactly after: three set over
 * the admin config as read, the rest of the config untouched; the server's public settings and
 * your own settings (where you haven't chosen) follow them; one taken away; all cleared; then the
 * defaults as they were. For a non-admin, the refusal. Prints counts and names, never values of
 * other settings.
 */
export async function probeUiDefaults({ client, capabilities }: { client: OwuiClient; capabilities: Capabilities }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };

  if (!capabilities.isAdmin) {
    await check('refused for a non-admin', async () => {
      try {
        await getAdminConfig(client);
      } catch (error) {
        if (error instanceof OwuiHttpError && (error.status === 401 || error.status === 403)) return `skipped: HTTP ${error.status}`;
        throw error;
      }
      throw new Error('a non-admin read the admin config');
    });
    return { steps, fixture };
  }

  const before = await getAdminConfig(client);
  const original = interfaceDefaultsOf(before);
  fixture.before = { defaults: Object.keys(original).length };
  try {
    await check('three set over the admin config as read; the rest of it untouched', async () => {
      const kept = await saveInterfaceDefaults(client, { chatBubble: false, 'title.auto': false, copyFormatted: true });
      const after = await getAdminConfig(client);
      if (kept.chatBubble !== false || uiValue(kept, 'title.auto') !== false || kept.copyFormatted !== true) throw new Error('the server didn’t keep them');
      for (const key of Object.keys(original)) if (!['chatBubble', 'title', 'copyFormatted'].includes(key) && JSON.stringify(kept[key]) !== JSON.stringify(original[key])) throw new Error(`the default ${key} changed`);
      if (withoutDefaults(after) !== withoutDefaults(before)) throw new Error('another admin setting changed');
      return `kept, with ${Object.keys(kept).length} defaults in all; the other admin settings as they were`;
    });

    await check('the public settings, and yours where you haven’t chosen, follow them', async () => {
      const config = await getConfig(client);
      const published = (config as { ui?: { default_interface_settings?: unknown } }).ui?.default_interface_settings;
      if (!isTree(published) || published.chatBubble !== false || published.copyFormatted !== true) throw new Error('/api/config doesn’t carry them');
      const raw = await client.get<{ ui?: unknown } | null>('/api/v1/users/user/settings', { query: { raw: true } });
      const merged = await client.get<{ ui?: unknown } | null>('/api/v1/users/user/settings');
      const own = isTree(raw?.ui) ? raw.ui : {};
      const seen = isTree(merged?.ui) ? merged.ui : {};
      const followed = ['chatBubble', 'title.auto', 'copyFormatted'].filter((path) => uiValue(own, path) === undefined);
      for (const path of followed) {
        const expected = path === 'copyFormatted' ? true : false;
        if (uiValue(seen, path) !== expected) throw new Error(`your settings don’t follow the default ${path}`);
      }
      const chosen = ['chatBubble', 'title.auto', 'copyFormatted'].filter((path) => uiValue(own, path) !== undefined);
      for (const path of chosen) if (JSON.stringify(uiValue(seen, path)) !== JSON.stringify(uiValue(own, path))) throw new Error(`your own ${path} didn’t win`);
      fixture.followed = { followed: followed.length, ownChoice: chosen.length };
      return `in /api/config; your settings follow ${followed.length} of 3${chosen.length ? `, your own choice winning for ${chosen.length}` : ''}`;
    });

    await check('one taken away; then all cleared', async () => {
      const less = await saveInterfaceDefaults(client, { 'title.auto': undefined });
      if (uiValue(less, 'title.auto') !== undefined || less.chatBubble !== false) throw new Error('the wrong one went');
      if ('title' in less) throw new Error('an empty group was left');
      const none = await saveInterfaceDefaults(client, {}, { clear: true });
      if (Object.keys(none).length) throw new Error('not cleared');
      return 'title.auto gone (no empty group left), the others kept; then none';
    });
  } finally {
    const now = await getAdminConfig(client).catch(() => null);
    if (now) await saveAdminConfig(client, { ...now, DEFAULT_INTERFACE_SETTINGS: original }).catch(() => undefined);
  }

  await check('put back exactly', async () => {
    const after = await getAdminConfig(client);
    if (JSON.stringify(interfaceDefaultsOf(after)) !== JSON.stringify(original)) throw new Error('the defaults differ from before');
    if (withoutDefaults(after) !== withoutDefaults(before)) throw new Error('another admin setting differs from before');
    return Object.keys(original).length ? `the ${Object.keys(original).length} earlier defaults, the rest as before` : 'no defaults, as before; the rest as before';
  });

  return { steps, fixture };
}
