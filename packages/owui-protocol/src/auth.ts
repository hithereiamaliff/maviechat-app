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
