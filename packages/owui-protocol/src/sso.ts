import { getSessionUser, interpretSignIn, type SignInResult } from './auth';
import { OwuiClient } from './http';

/*
 * The other ways into an Open WebUI server (0.11.3 and 0.12.5): LDAP, a username and password the
 * server checks against its directory, and single sign-on (OAuth/OIDC), where the server sends you
 * to your provider and back. SSO ends on the server's own /auth page with your session in a
 * `token` cookie (or there's a reason in `?error=`; on 0.12, `?pending=1` for an account awaiting
 * approval, and `?mfa=1` when the server's own page asks for a second step, then keeps the session
 * in its page storage). The app follows it in a private web view and picks the token up there.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});

/** The ways a server lets people sign in, from its public config (`/api/config`, before signing in). */
export interface SignInOptions {
  /** Email and password: the web hides the form when the admin turned it off. */
  passwordForm: boolean;
  /** LDAP: a username and password checked against the server's directory. */
  ldap: boolean;
  /** Single sign-on: each provider's id (in `/oauth/{id}/login`) and the name to show. */
  providers: { id: string; name: string }[];
}

/** The web's own words for the providers it knows (its config lists them by id); OIDC carries the admin's name for it. */
const NAMES: Record<string, string> = { google: 'Google', microsoft: 'Microsoft', github: 'GitHub', feishu: 'Feishu' };

export function signInOptionsOf(config: Tree): SignInOptions {
  const features = record(config.features);
  const providers = Object.entries(record(record(config.oauth).providers)).map(([id, value]) => {
    const named = typeof value === 'string' && value.trim() && value.trim() !== id ? value.trim() : '';
    return { id, name: NAMES[id] ?? (named || (id === 'oidc' ? 'SSO' : id)) };
  });
  return { passwordForm: features.enable_login_form !== false, ldap: features.enable_ldap === true, providers };
}

/** Signs in with an LDAP username and password; answers like the password sign-in (0.12 may ask for a second step). */
export async function ldapSignIn(client: OwuiClient, user: string, password: string): Promise<SignInResult> {
  return interpretSignIn(await client.post<unknown>('/api/v1/auths/ldap', { user, password }));
}

/** Where a single sign-on with a provider starts, on the server. */
export const ssoStartUrl = (baseUrl: string, provider: string): string => `${baseUrl.replace(/\/+$/, '')}/oauth/${encodeURIComponent(provider)}/login`;

/** Where a page the sign-in's web view reaches leaves it. */
export type SsoStep =
  /** Still at the provider (or on the way): `sawCallback` once the server's callback came. */
  | { kind: 'on-the-way'; sawCallback: boolean }
  /** Back on the server's /auth: the session is there, or comes after a second step on the server's own page. */
  | { kind: 'back' }
  | { kind: 'second-step' }
  | { kind: 'pending' }
  | { kind: 'error'; text: string }
  /** After the callback the server sent the browser to another address (its WEBUI_URL setting), where the session can't be picked up. */
  | { kind: 'elsewhere'; origin: string };

export function ssoStepOf(url: string, baseUrl: string, sawCallback: boolean): SsoStep {
  let page: URL;
  let base: URL;
  try {
    page = new URL(url);
    base = new URL(baseUrl);
  } catch {
    return { kind: 'on-the-way', sawCallback };
  }
  if (page.protocol !== 'https:' && page.protocol !== 'http:') return { kind: 'on-the-way', sawCallback };
  const prefix = base.pathname.replace(/\/+$/, '');
  const path = page.pathname.replace(/\/+$/, '');
  const ours = page.origin === base.origin;
  if (ours && path.startsWith(`${prefix}/oauth/`) && path.endsWith('/callback')) return { kind: 'on-the-way', sawCallback: true };
  if (ours && path === `${prefix}/auth`) {
    const error = page.searchParams.get('error');
    if (error) return { kind: 'error', text: error };
    if (page.searchParams.get('pending')) return { kind: 'pending' };
    if (page.searchParams.get('mfa')) return { kind: 'second-step' };
    return { kind: 'back' };
  }
  if (!ours && sawCallback && path.endsWith('/auth')) return { kind: 'elsewhere', origin: page.origin };
  return { kind: 'on-the-way', sawCallback };
}

/**
 * The script the sign-in's web view runs on every page it loads. On the server's own pages only, it
 * hands over the session token once the server has left it: the `token` cookie its sign-in sets,
 * or, after a second step on its page, the page's own storage. Elsewhere (the provider's pages) it
 * does nothing. It looks for up to ten minutes (time for a second step).
 */
export function ssoTokenScript(origin: string): string {
  return `(function () {
  var origin = ${JSON.stringify(origin)};
  if (window.location.origin !== origin) return;
  var sent = false;
  var tries = 0;
  function read() {
    var match = document.cookie.match(/(?:^|;\\s*)token=([^;]*)/);
    if (match && match[1]) return decodeURIComponent(match[1]);
    try {
      return window.localStorage.getItem('token');
    } catch (error) {
      return null;
    }
  }
  function check() {
    if (sent) return true;
    var token = read();
    if (token) {
      sent = true;
      window.ReactNativeWebView.postMessage(JSON.stringify({ maviechat: 'sso', token: token }));
    }
    return sent;
  }
  if (check()) return;
  var timer = setInterval(function () {
    tries += 1;
    if (check() || tries > 2400) clearInterval(timer);
  }, 250);
})();
true;`;
}

/** The token in a message from that script, or null. */
export function ssoTokenOf(message: string): string | null {
  try {
    const data = record(JSON.parse(message));
    return data.maviechat === 'sso' && typeof data.token === 'string' && data.token ? data.token : null;
  } catch {
    return null;
  }
}

/** The sign-in a token stands for: the account it belongs to, read with it (a pending account says so). */
export async function signInWithToken(client: OwuiClient, token: string): Promise<SignInResult> {
  const user = await getSessionUser(client.withToken(token));
  return interpretSignIn({ ...user, token, token_type: 'Bearer' });
}
