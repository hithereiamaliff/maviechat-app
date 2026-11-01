import type { DtClient } from './http';

/** The HttpOnly cookie DeepTutor signs in with. Its value is a JWT the API also takes as a Bearer token. */
export const TOKEN_COOKIE = 'dt_token';

/** `POST /api/auth/login` answers with the account; the token itself only travels in the cookie. */
export interface DtAccount {
  ok?: boolean;
  user_id: string;
  username: string;
  role: string;
  is_admin: boolean;
  must_change_password?: boolean;
  [key: string]: unknown;
}

/** `GET /api/auth/status`: works without signing in (then `authenticated` is false). */
export interface DtAuthStatus {
  enabled: boolean;
  authenticated: boolean;
  user_id: string | null;
  username: string | null;
  role: string | null;
  is_admin: boolean;
  [key: string]: unknown;
}

export interface DtSignIn {
  account: DtAccount;
  /** Null when the platform hides `Set-Cookie`; its cookie store then carries the sign-in instead. */
  token: string | null;
}

/** Signs in with a username (or email) and password. */
export async function signIn(client: DtClient, username: string, password: string): Promise<DtSignIn> {
  const { data, headers } = await client.send<DtAccount>('POST', '/api/auth/login', { body: { username: username.trim(), password } });
  return { account: data, token: tokenFromHeaders(headers) };
}

export function getAuthStatus(client: DtClient): Promise<DtAuthStatus> {
  return client.get<DtAuthStatus>('/api/auth/status');
}

/**
 * Clears the sign-in cookie. DeepTutor's tokens are stateless: one already copied stays
 * valid until it expires, so the app also forgets its copy.
 */
export async function signOut(client: DtClient): Promise<void> {
  await client.post('/api/auth/logout');
}

/** The token from a login response's `Set-Cookie` header(s), if the platform shows them. */
export function tokenFromHeaders(headers: Headers): string | null {
  const withList = headers as Headers & { getSetCookie?: () => string[] };
  const cookies = typeof withList.getSetCookie === 'function' ? withList.getSetCookie() : [];
  const lines = cookies.length > 0 ? cookies : [headers.get('set-cookie') ?? ''];
  for (const line of lines) {
    // A folded header joins cookies with ", "; the token's characters never include a comma or semicolon.
    const match = new RegExp(`(?:^|[,;]\\s*)${TOKEN_COOKIE}=([^;,\\s]+)`).exec(line);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** When a token stops working (its `exp`, in Unix seconds), or null if it can't be read. */
export function tokenExpiry(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const claims = JSON.parse(atob(base64)) as { exp?: unknown };
    return typeof claims.exp === 'number' ? claims.exp : null;
  } catch {
    return null;
  }
}
