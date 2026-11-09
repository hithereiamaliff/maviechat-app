import { interpretSignIn, type Session, type SignInResult } from './auth';
import { OwuiHttpError, type OwuiClient } from './http';

/*
 * Two-step sign-in (Open WebUI 0.12): after the password, the server answers with a step and a
 * short-lived challenge token instead of a session. `verify`: a code from the authenticator app
 * (or a one-time recovery code). `enroll`: the account has no authenticator yet (the admin turned
 * two-step sign-in on): add one, confirm a code, keep the recovery codes. `recover`: an admin
 * reset it: their reset token leads to `enroll`.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const base = '/api/v1/auths/mfa';

/** A code from the authenticator app, or a recovery code (each works once). */
export async function verifyMfa(client: OwuiClient, challengeToken: string, code: string, recovery = false): Promise<SignInResult> {
  return interpretSignIn(await client.post<unknown>(`${base}/verify`, { challenge_token: challengeToken, code: code.trim(), recovery }));
}

/** What to add to an authenticator app: the setup key, and a QR code (an SVG data address) for another device. */
export async function startMfaEnrollment(client: OwuiClient, challengeToken: string): Promise<{ manualKey: string; qrCode: string }> {
  const row = record(await client.post<unknown>(`${base}/enroll/start`, { challenge_token: challengeToken }));
  return { manualKey: text(row.manual_key), qrCode: text(row.qr_code) };
}

/** The first code from the newly added authenticator: signs in, and hands over recovery codes to keep. */
export async function confirmMfaEnrollment(client: OwuiClient, challengeToken: string, code: string): Promise<{ result: SignInResult; recoveryCodes: string[] }> {
  const body = record(await client.post<unknown>(`${base}/enroll/confirm`, { challenge_token: challengeToken, code: code.trim() }));
  const recoveryCodes = Array.isArray(body.recovery_codes) ? body.recovery_codes.map(text).filter(Boolean) : [];
  return { result: interpretSignIn(body), recoveryCodes };
}

/** An admin's reset token: leads to adding an authenticator again. */
export async function redeemMfaReset(client: OwuiClient, challengeToken: string, resetToken: string): Promise<SignInResult> {
  return interpretSignIn(await client.post<unknown>(`${base}/recover`, { challenge_token: challengeToken, reset_token: resetToken.trim() }));
}

/**
 * The link authenticator apps (and the iPhone's Passwords) take, named as the server names it
 * in its QR code: "Open WebUI" and the account's email.
 */
export function otpauthUri(manualKey: string, email: string, issuer = 'Open WebUI'): string {
  const secret = manualKey.replace(/\s+/g, '').toUpperCase();
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
}

/** Whether a sign-in step's answer is a finished session. */
export const sessionOf = (result: SignInResult): Session | null => (result.kind === 'session' || result.kind === 'pending' ? result.session : null);

// --- Your own two-step sign-in, from your account's settings (0.12; the web's Account → Multi-factor authentication). ---

export interface MfaStatus {
  /** An authenticator is set up for this account. */
  enabled: boolean;
  /** The server asks this account for a second step (the web shows the section only then). */
  required: boolean;
  recoveryCodesRemaining: number;
}

/** This account's two-step sign-in; null where the server has none (0.11 answers with its web page). */
export async function getMfaStatus(client: OwuiClient): Promise<MfaStatus | null> {
  let answer: unknown;
  try {
    answer = await client.get<unknown>(`${base}/status`);
  } catch (error) {
    if (error instanceof OwuiHttpError && error.status === 404) return null;
    throw error;
  }
  const row = record(answer);
  if (typeof row.enabled !== 'boolean') return null;
  return { enabled: row.enabled, required: row.required === true, recoveryCodesRemaining: typeof row.recovery_codes_remaining === 'number' ? row.recovery_codes_remaining : 0 };
}

/**
 * Starts replacing the authenticator, proven with a current code (or a recovery code): a
 * challenge for adding the new one, as when it was first set up. Needs a sign-in from the last
 * few minutes.
 */
export async function startMfaReplacement(client: OwuiClient, code: string, recovery: boolean): Promise<{ challengeToken: string; expiresIn: number | null }> {
  const row = record(await client.post<unknown>(`${base}/replace`, { code: code.trim(), recovery }));
  const challengeToken = text(row.challenge_token);
  if (!challengeToken) throw new Error('The server didn’t start the replacement.');
  return { challengeToken, expiresIn: typeof row.expires_in === 'number' ? row.expires_in : null };
}

/** The new authenticator's first code: its recovery codes. Every device is signed out, this one too. */
export async function confirmMfaReplacement(client: OwuiClient, challengeToken: string, code: string): Promise<string[]> {
  const body = record(await client.post<unknown>(`${base}/enroll/confirm`, { challenge_token: challengeToken, code: code.trim() }));
  return Array.isArray(body.recovery_codes) ? body.recovery_codes.map(text).filter(Boolean) : [];
}

/**
 * New recovery codes, proven with a current code (or a recovery code): the old ones stop working,
 * and every device is signed out, this one too. Needs a sign-in from the last few minutes.
 */
export async function newRecoveryCodes(client: OwuiClient, code: string, recovery: boolean): Promise<string[]> {
  const body = record(await client.post<unknown>(`${base}/recovery/codes`, { code: code.trim(), recovery }));
  return Array.isArray(body.recovery_codes) ? body.recovery_codes.map(text).filter(Boolean) : [];
}

/** The server wants a sign-in from the last few minutes before changing two-step sign-in. */
export const needsFreshSignIn = (error: unknown): boolean => error instanceof OwuiHttpError && error.status === 403 && error.detail === 'reauthentication_required';
