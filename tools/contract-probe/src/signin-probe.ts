import { getConfig, ldapSignIn, OwuiHttpError, signInOptionsOf, signInWithToken, ssoStartUrl, type Capabilities, type OwuiClient } from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});

/**
 * The sign-in screen's other ways in: the server's public sign-in options (before signing in);
 * where SSO starts for each provider (a redirect to it, or 404 for one the server hasn't got);
 * a session token turned into its account (how an SSO sign-in finishes); and, for admins on the
 * scratch servers only, LDAP switched on for a moment: the app's LDAP request reaches the directory
 * check (refused, with no directory here), then LDAP is switched back. Prints counts and statuses.
 */
export async function probeSignIn({ client, anonymous, capabilities, baseUrl, token, userId }: { client: OwuiClient; anonymous: OwuiClient; capabilities: Capabilities; baseUrl: string; token: string; userId: string }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };
  const statusOf = async (work: () => Promise<unknown>): Promise<string> => {
    try {
      await work();
      return 'ok';
    } catch (error) {
      if (error instanceof OwuiHttpError) return `HTTP ${error.status}${error.detail ? `: ${error.detail}` : ''}`;
      throw error;
    }
  };

  const options = signInOptionsOf(record(await getConfig(anonymous)));
  fixture.options = { passwordForm: options.passwordForm, ldap: options.ldap, providers: options.providers.length };

  await check('the public sign-in options, before signing in', async () => `password form ${options.passwordForm ? 'on' : 'off'}, LDAP ${options.ldap ? 'on' : 'off'}, ${options.providers.length} SSO provider(s)`);

  await check('where SSO starts: a redirect to each provider, 404 for one the server hasn’t got', async () => {
    const start = async (provider: string) => (await fetch(ssoStartUrl(baseUrl, provider), { redirect: 'manual' })).status;
    const missing = await start('app-probe-none');
    if (missing !== 404) throw new Error(`an unknown provider answered ${missing}`);
    const statuses: string[] = [];
    for (const provider of options.providers) {
      const status = await start(provider.id);
      if (status < 300 || status >= 400) throw new Error(`${provider.name} answered ${status}, not a redirect`);
      statuses.push(`${provider.name} ${status}`);
    }
    return `unknown provider 404${statuses.length ? `; ${statuses.join(', ')}` : ''}`;
  });

  await check('a session token becomes its account (how SSO finishes)', async () => {
    const result = await signInWithToken(anonymous, token);
    if (result.kind === 'mfa') throw new Error('asked for a second step');
    if (!result.session || result.session.id !== userId || result.session.token !== token) throw new Error('not the same account');
    return `${result.kind === 'session' ? 'signed in' : 'pending'} as the same account; a wrong token: ${await statusOf(() => signInWithToken(anonymous, `${token}x`))}`;
  });

  if (!capabilities.isAdmin || !/^http:\/\/127\.0\.0\.1:(3013|3014)\/?$/.test(baseUrl)) {
    steps.push({ name: 'LDAP switched on for a moment', ok: true, note: 'skipped: admins on the scratch servers only' });
    return { steps, fixture };
  }

  const before = record(await client.get<unknown>('/api/v1/auths/admin/config/ldap')).ENABLE_LDAP === true;
  fixture.ldapBefore = before;
  try {
    await check('LDAP: the app’s request, refused while off, reaching the directory check once on', async () => {
      if (before) return 'skipped: LDAP is on here already';
      const off = await statusOf(() => ldapSignIn(anonymous, 'app-probe-ldap', 'not-a-password'));
      if (!/^HTTP 400.*not enabled/i.test(off)) throw new Error(`while off: ${off}`);
      await client.post<unknown>('/api/v1/auths/admin/config/ldap', { enable_ldap: true });
      const shown = signInOptionsOf(record(await getConfig(anonymous))).ldap;
      if (!shown) throw new Error('/api/config doesn’t show LDAP on');
      const on = await statusOf(() => ldapSignIn(anonymous, 'app-probe-ldap', 'not-a-password'));
      if (on === 'ok' || /^HTTP 422/.test(on) || /not enabled/i.test(on)) throw new Error(`once on: ${on}`);
      return `off: ${off}; on: shown in /api/config, and the request reached the directory check (${on.split(':')[0]})`;
    });
  } finally {
    await check('LDAP put back as it was', async () => {
      await client.post<unknown>('/api/v1/auths/admin/config/ldap', { enable_ldap: before });
      const now = record(await client.get<unknown>('/api/v1/auths/admin/config/ldap')).ENABLE_LDAP === true;
      if (now !== before) throw new Error('it differs from before');
      if (signInOptionsOf(record(await getConfig(anonymous))).ldap !== before) throw new Error('/api/config differs from before');
      return before ? 'on, as before' : 'off, as before';
    });
  }
  return { steps, fixture };
}
