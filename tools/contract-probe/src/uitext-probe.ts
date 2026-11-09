import { getAdminConfig, getConfig, interfaceTextOf, OwuiHttpError, saveAdminConfig, saveInterfaceText, type Capabilities, type OwuiClient } from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});

/**
 * Admin → General's interface text, the app's way (admins, scratch servers only: it changes what
 * every browser shows, for a moment). On 0.11 the server has none, so the app shows nothing. On
 * 0.12: two texts saved over what's there (one with a placeholder), read back, and handed to
 * browsers in `/api/config`; a replacement that drops a placeholder is refused by the server too,
 * and changes nothing; then the setting is put back exactly as it was.
 */
export async function probeInterfaceText({ client, anonymous, capabilities, baseUrl }: { client: OwuiClient; anonymous: OwuiClient; capabilities: Capabilities; baseUrl: string }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };
  if (!capabilities.isAdmin || !/^http:\/\/127\.0\.0\.1:(3013|3014)\/?$/.test(baseUrl)) {
    steps.push({ name: 'interface text', ok: true, note: 'skipped: admins on the scratch servers only' });
    return { steps, fixture };
  }
  const before = await getAdminConfig(client);
  const rows = interfaceTextOf(before);
  if (rows === null) {
    steps.push({ name: 'none on this server, so the app shows nothing', ok: true, note: 'no I18N in the admin config (0.11)' });
    return { steps, fixture };
  }
  const original = before.I18N;
  const stamp = Date.now().toString(36);
  const plain = `APP PROBE plain ${stamp}`;
  const named = `APP PROBE hello {{name}} ${stamp}`;
  fixture.rows = rows.length;
  try {
    await check('two texts saved over what’s there, read back, and sent to browsers', async () => {
      const saved = await saveInterfaceText(client, [...rows, { original: plain, replacements: { 'en-US': 'APP PROBE replaced' } }, { original: named, replacements: { 'de-DE': 'APP PROBE hallo {{ name }}' } }]);
      if (saved.length !== rows.length + 2) throw new Error(`${saved.length} rows came back`);
      const read = interfaceTextOf(await getAdminConfig(client)) ?? [];
      if (read.find((row) => row.original === named)?.replacements['de-DE'] !== 'APP PROBE hallo {{ name }}') throw new Error('the placeholder text didn’t read back');
      const signedIn = record(record(await getConfig(client)).ui).i18n ?? record(await getConfig(client)).i18n;
      const anyone = record(await getConfig(anonymous)).i18n;
      const sent = record(record(signedIn ?? anyone)['en-US'])[plain];
      fixture.sentTo = { signedIn: signedIn !== undefined, anyone: anyone !== undefined };
      if (sent !== 'APP PROBE replaced') throw new Error('browsers don’t get it in /api/config');
      return `saved and read back (with the existing ${rows.length}); /api/config hands them out${anyone !== undefined ? ', signed out too' : ' to signed-in browsers'}`;
    });

    await check('a replacement that drops a placeholder is refused by the server, and nothing changes', async () => {
      const now = await getAdminConfig(client);
      const status = await saveAdminConfig(client, { ...now, I18N: { ...record(now.I18N), 'fr-FR': { [named]: 'APP PROBE bonjour' } } }).then(
        () => 200,
        (error: unknown) => {
          if (error instanceof OwuiHttpError) return error.status;
          throw error;
        },
      );
      const after = await getAdminConfig(client);
      fixture.placeholderRefused = status;
      if (status === 200) throw new Error('the server took it');
      if (JSON.stringify(after.I18N) !== JSON.stringify(now.I18N)) throw new Error('the setting changed anyway');
      return `refused (${status}); the setting as it was`;
    });
  } finally {
    await check('put back exactly as it was', async () => {
      const now = await getAdminConfig(client);
      await saveAdminConfig(client, { ...now, I18N: original });
      const back = await getAdminConfig(client);
      if (JSON.stringify(back.I18N) !== JSON.stringify(original)) throw new Error('it differs from before');
      return `${rows.length} ${rows.length === 1 ? 'text' : 'texts'}, as before`;
    });
  }
  return { steps, fixture };
}
