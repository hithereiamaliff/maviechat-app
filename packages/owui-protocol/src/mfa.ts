import { interpretSignIn, type Session, type SignInResult } from './auth';
import type { OwuiClient } from './http';

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
