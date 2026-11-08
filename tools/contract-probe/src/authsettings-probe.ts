import { getLdapSettings, getOAuthSettings, LDAP_SECTIONS, OAUTH_SECTIONS, oauthLockedWhy, OwuiHttpError, saveLdapSettings, type Capabilities, type OwuiClient } from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

type Tree = Record<string, unknown>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const REQUIRED = ['label', 'host', 'attribute_for_mail', 'attribute_for_username', 'search_base'];

/**
 * Authentication's LDAP and single sign-on settings the app's way (admins, scratch servers only).
 * LDAP: both endpoints read as one page; where the directory isn't set up, switching LDAP on with
 * its empty settings is refused and LDAP stays off (the settings go first); where it is, saving it
 * as it was changes nothing. Single sign-on: read, every field the app shows is there, and whether
 * the server lets it be changed. Nothing is left changed; values (passwords, secrets) never printed.
 */
export async function probeAuthSettings({ client, capabilities, baseUrl }: { client: OwuiClient; capabilities: Capabilities; baseUrl: string }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
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
    steps.push({ name: 'LDAP and single sign-on settings', ok: true, note: 'skipped: admins on the scratch servers only' });
    return { steps, fixture };
  }

  const before = await getLdapSettings(client);
  const shown = LDAP_SECTIONS.flatMap((section) => section.fields).filter((field) => !field.optional);
  fixture.ldap = { on: before.ENABLE_LDAP, fields: Object.keys(before).length };
  await check('LDAP: both endpoints read as one page, with every field the app shows', async () => {
    const missing = shown.filter((field) => !(field.key in before)).map((field) => field.key);
    if (missing.length) throw new Error(`missing ${missing.join(', ')}`);
    return `${Object.keys(before).length} fields, LDAP ${before.ENABLE_LDAP ? 'on' : 'off'}${'default_email_domain' in before ? ' (with 0.12’s default email domain)' : ''}`;
  });

  const configured = REQUIRED.every((key) => typeof before[key] === 'string' && (before[key] as string).trim());
  await check(configured ? 'LDAP: saved as it was, nothing changes' : 'LDAP: switching it on with empty settings is refused, and it stays off', async () => {
    if (configured) {
      const after = await saveLdapSettings(client, before);
      if (!same(after, before)) throw new Error('the settings differ after a save of the same values');
      return 'the same before and after';
    }
    try {
      await saveLdapSettings(client, { ...before, ENABLE_LDAP: true });
    } catch (error) {
      if (!(error instanceof OwuiHttpError) || error.status !== 400) throw error;
      const now = await getLdapSettings(client);
      if (now.ENABLE_LDAP !== before.ENABLE_LDAP) throw new Error('LDAP was switched on anyway');
      if (!same(now, before)) throw new Error('the settings changed');
      return `refused (HTTP 400: ${error.detail ?? 'a required field is empty'}); LDAP still ${before.ENABLE_LDAP ? 'on' : 'off'}, nothing changed`;
    }
    throw new Error('the server took empty required settings');
  });

  await check('single sign-on: read, with every field the app shows, and whether it can be changed here', async () => {
    const oauth: Tree = await getOAuthSettings(client);
    const keys = OAUTH_SECTIONS.flatMap((section) => section.fields).map((field) => field.key);
    const missing = keys.filter((key) => !(key in oauth));
    if (missing.length) throw new Error(`missing ${missing.join(', ')}`);
    fixture.oauth = { fields: keys.length, editable: oauthLockedWhy(oauth) === null };
    return `${keys.length} fields there; ${oauthLockedWhy(oauth) ? 'read only here (the server keeps them in its environment), as on the web' : 'editable here'}`;
  });
  return { steps, fixture };
}
