import type { OwuiClient } from './http';

/** Permission tree from `GET /api/v1/auths/` (workspace, sharing, chat, features, settings, …). */
export type Permissions = Record<string, unknown>;

export interface SessionUser {
  id: string;
  name: string;
  role: string;
  email: string;
  profile_image_url?: string;
  /** Unix seconds; null when the server's tokens never expire. */
  expires_at?: number | null;
  permissions?: Permissions | null;
  [key: string]: unknown;
}

export interface Session extends SessionUser {
  token: string;
  token_type: string;
}

export type MfaStep = 'verify' | 'enroll' | 'recover';

export type SignInResult =
  | { kind: 'session'; session: Session }
  /** 0.11.x signs pending users in with role "pending"; 0.12.x answers `{next_step: "pending"}` with no session. */
  | { kind: 'pending'; session: Session | null }
  /** 0.12.x two-step sign-in. MavieChat supports it from milestone M5. */
  | { kind: 'mfa'; step: MfaStep; challengeToken: string; expiresIn: number | null };

export class UnexpectedResponseError extends Error {
  constructor(what: string) {
    super(`The server sent an unexpected ${what}. Is this an Open WebUI server?`);
    this.name = 'UnexpectedResponseError';
  }
}

const MFA_STEPS: readonly string[] = ['verify', 'enroll', 'recover'];

export function interpretSignIn(body: unknown): SignInResult {
  if (!isRecord(body)) throw new UnexpectedResponseError('sign-in response');

  if (typeof body.next_step === 'string') {
    if (body.next_step === 'pending') return { kind: 'pending', session: null };
    if (MFA_STEPS.includes(body.next_step) && typeof body.challenge_token === 'string') {
      return {
        kind: 'mfa',
        step: body.next_step as MfaStep,
        challengeToken: body.challenge_token,
        expiresIn: typeof body.expires_in === 'number' ? body.expires_in : null,
      };
    }
    throw new UnexpectedResponseError(`sign-in step "${body.next_step}"`);
  }

  if (typeof body.token === 'string' && typeof body.id === 'string' && typeof body.role === 'string') {
    const session = body as unknown as Session;
    return session.role === 'pending' ? { kind: 'pending', session } : { kind: 'session', session };
  }

  throw new UnexpectedResponseError('sign-in response');
}

export async function signIn(client: OwuiClient, email: string, password: string): Promise<SignInResult> {
  const body = await client.post<unknown>('/api/v1/auths/signin', { email, password });
  return interpretSignIn(body);
}

/** What the server tells an account waiting for approval: the admin's title and text for it, and who the admin is, where it shares that. */
export interface PendingNotice {
  /** The admin's own words; empty for the app's. */
  title: string;
  /** Markdown; empty for the app's. */
  content: string;
  admin: { name: string; email: string } | null;
}

/**
 * Read with the pending account's own token (the server shows these only to a signed-in account,
 * and gives a pending one a token unless 0.12's two-step sign-in is on). Each part is left out
 * where the server doesn't answer it (the admin's details are shared only when the admin chose to).
 */
export async function pendingNotice(client: OwuiClient): Promise<PendingNotice> {
  const [config, admin] = await Promise.all([client.get<unknown>('/api/config').catch(() => null), client.get<unknown>('/api/v1/auths/admin/details').catch(() => null)]);
  const ui = isRecord(config) && isRecord(config.ui) ? config.ui : {};
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const details = isRecord(admin) ? admin : {};
  return {
    title: text(ui.pending_user_overlay_title),
    content: text(ui.pending_user_overlay_content),
    admin: text(details.email) ? { name: text(details.name), email: text(details.email) } : null,
  };
}

/** The signed-in user with fresh permissions and `expires_at`. Fails with 401 once the token is no longer valid. */
export function getSessionUser(client: OwuiClient): Promise<SessionUser> {
  return client.get<SessionUser>('/api/v1/auths/');
}

/** Revokes the token on the server. May return `{redirect_url}` for OIDC sign-out (unused by password sign-in). */
export function signOut(client: OwuiClient): Promise<unknown> {
  return client.post<unknown>('/api/v1/auths/signout');
}

/** True when the token has expired or will within `marginSeconds`. A missing expiry means it never expires. */
export function isExpiring(expiresAt: number | null | undefined, nowMs: number, marginSeconds = 60): boolean {
  if (expiresAt === null || expiresAt === undefined) return false;
  return expiresAt * 1000 - nowMs <= marginSeconds * 1000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
