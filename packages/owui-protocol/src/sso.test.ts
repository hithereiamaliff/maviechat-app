import { describe, expect, it } from 'vitest';
import { OwuiClient, type FetchLike } from './http';
import { ldapSignIn, signInOptionsOf, signInWithToken, ssoStartUrl, ssoStepOf, ssoTokenOf, ssoTokenScript } from './sso';

function routedClient(routes: Record<string, unknown>) {
  const calls: { method: string; url: string; body: unknown; auth: string | null }[] = [];
  const fetch: FetchLike = async (url, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ method: init?.method ?? 'GET', url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined, auth: headers.get('Authorization') });
    const path = new URL(url).pathname;
    return new Response(JSON.stringify(routes[`${init?.method ?? 'GET'} ${path}`] ?? {}), { status: 200 });
  };
  return { client: new OwuiClient({ baseUrl: 'https://chat.test', fetch }), calls };
}

const user = { id: 'u1', name: 'Ada', role: 'user', email: 'ada@example.com' };

describe('sign-in options', () => {
  it('reads the password form, LDAP and the providers, with the web’s names', () => {
    expect(signInOptionsOf({})).toEqual({ passwordForm: true, ldap: false, providers: [] });
    const options = signInOptionsOf({
      features: { enable_login_form: false, enable_ldap: true },
      oauth: { providers: { google: 'google', oidc: 'Authentik', github: 'github', custom: 'My SSO', plain: 'plain' } },
    });
    expect(options.passwordForm).toBe(false);
    expect(options.ldap).toBe(true);
    expect(options.providers).toEqual([
      { id: 'google', name: 'Google' },
      { id: 'oidc', name: 'Authentik' },
      { id: 'github', name: 'GitHub' },
      { id: 'custom', name: 'My SSO' },
      { id: 'plain', name: 'plain' },
    ]);
    expect(signInOptionsOf({ oauth: { providers: { oidc: 'oidc' } } }).providers).toEqual([{ id: 'oidc', name: 'SSO' }]);
  });
});

describe('LDAP', () => {
  it('signs in with a username, and passes on a second step', async () => {
    const done = routedClient({ 'POST /api/v1/auths/ldap': { ...user, token: 't', token_type: 'Bearer' } });
    expect((await ldapSignIn(done.client, 'ada', 'secret')).kind).toBe('session');
    expect(done.calls[0]).toMatchObject({ method: 'POST', url: 'https://chat.test/api/v1/auths/ldap', body: { user: 'ada', password: 'secret' } });
    const twoStep = routedClient({ 'POST /api/v1/auths/ldap': { next_step: 'verify', challenge_token: 'c', expires_in: 300 } });
    expect(await ldapSignIn(twoStep.client, 'ada', 'secret')).toEqual({ kind: 'mfa', step: 'verify', challengeToken: 'c', expiresIn: 300 });
  });
});

describe('single sign-on', () => {
  it('starts at the provider’s login on the server', () => {
    expect(ssoStartUrl('https://chat.test/', 'oidc')).toBe('https://chat.test/oauth/oidc/login');
    expect(ssoStartUrl('https://chat.test/owui', 'my sso')).toBe('https://chat.test/owui/oauth/my%20sso/login');
  });

  it('follows the way back: the callback, then the server’s /auth and what it says', () => {
    const base = 'https://chat.test';
    expect(ssoStepOf('https://login.example.com/realms/x/protocol/openid-connect/auth?client_id=y', base, false)).toEqual({ kind: 'on-the-way', sawCallback: false });
    expect(ssoStepOf('https://chat.test/oauth/oidc/callback?code=1&state=2', base, false)).toEqual({ kind: 'on-the-way', sawCallback: true });
    expect(ssoStepOf('https://chat.test/auth', base, true)).toEqual({ kind: 'back' });
    expect(ssoStepOf('https://chat.test/auth?error=Email%20taken', base, true)).toEqual({ kind: 'error', text: 'Email taken' });
    expect(ssoStepOf('https://chat.test/auth?pending=1', base, true)).toEqual({ kind: 'pending' });
    expect(ssoStepOf('https://chat.test/auth?mfa=1', base, true)).toEqual({ kind: 'second-step' });
    expect(ssoStepOf('http://localhost:8080/auth', base, true)).toEqual({ kind: 'elsewhere', origin: 'http://localhost:8080' });
    expect(ssoStepOf('http://localhost:8080/auth', base, false)).toEqual({ kind: 'on-the-way', sawCallback: false });
    expect(ssoStepOf('maviechat://x', base, true)).toEqual({ kind: 'on-the-way', sawCallback: true });
    expect(ssoStepOf('https://example.com/owui/auth', 'https://example.com/owui', true)).toEqual({ kind: 'back' });
    expect(ssoStepOf('https://example.com/auth', 'https://example.com/owui', false)).toEqual({ kind: 'on-the-way', sawCallback: false });
  });

  /** Runs the page script against a pretend page; returns what it posted, and a way to tick its timer. */
  function runScript(origin: string, page: { origin: string; cookie: string; stored?: string | null }) {
    const posted: string[] = [];
    let tick: (() => void) | null = null;
    const storage = { value: page.stored ?? null };
    const window = { location: { origin: page.origin }, localStorage: { getItem: (key: string) => (key === 'token' ? storage.value : null) }, ReactNativeWebView: { postMessage: (text: string) => posted.push(text) } };
    const document = { cookie: page.cookie };
    const setInterval = (run: () => void) => {
      tick = run;
      return 1;
    };
    const clearInterval = () => {
      tick = null;
    };
    new Function('window', 'document', 'setInterval', 'clearInterval', ssoTokenScript(origin))(window, document, setInterval, clearInterval);
    return { posted, tick: () => tick?.(), storage, ticking: () => tick !== null };
  }

  it('hands over the session cookie on the server’s pages, and nothing elsewhere', () => {
    const ours = runScript('https://chat.test', { origin: 'https://chat.test', cookie: 'a=1; token=abc%20d; b=2' });
    expect(ours.posted.map(ssoTokenOf)).toEqual(['abc d']);
    expect(ours.ticking()).toBe(false);
    const theirs = runScript('https://chat.test', { origin: 'https://login.example.com', cookie: 'token=not-ours' });
    expect(theirs.posted).toEqual([]);
    expect(theirs.ticking()).toBe(false);
  });

  it('waits for the session the server’s page keeps after a second step', () => {
    const page = runScript('https://chat.test', { origin: 'https://chat.test', cookie: 'other=1' });
    expect(page.posted).toEqual([]);
    page.tick();
    expect(page.posted).toEqual([]);
    page.storage.value = 'after-mfa';
    page.tick();
    expect(page.posted.map(ssoTokenOf)).toEqual(['after-mfa']);
    expect(page.ticking()).toBe(false);
  });

  it('reads only its own messages', () => {
    expect(ssoTokenOf('{"maviechat":"sso","token":"t"}')).toBe('t');
    expect(ssoTokenOf('{"token":"t"}')).toBeNull();
    expect(ssoTokenOf('not json')).toBeNull();
  });

  it('signs in with the token: the account it belongs to, read with it', async () => {
    const { client, calls } = routedClient({ 'GET /api/v1/auths/': user });
    const result = await signInWithToken(client, 'tok');
    expect(calls[0]?.auth).toBe('Bearer tok');
    expect(result).toEqual({ kind: 'session', session: { ...user, token: 'tok', token_type: 'Bearer' } });
    const waiting = routedClient({ 'GET /api/v1/auths/': { ...user, role: 'pending' } });
    expect((await signInWithToken(waiting.client, 'tok')).kind).toBe('pending');
  });
});
