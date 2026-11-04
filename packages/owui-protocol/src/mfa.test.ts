import { describe, expect, it } from 'vitest';
import { OwuiClient, type FetchLike } from './http';
import { confirmMfaEnrollment, otpauthUri, redeemMfaReset, verifyMfa } from './mfa';

function recordingClient(...answers: unknown[]) {
  const calls: { url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(answers.shift() ?? {}), { status: 200 });
  };
  return { client: new OwuiClient({ baseUrl: 'https://chat.test', token: null, fetch }), calls };
}

const SESSION = { token: 'jwt', token_type: 'Bearer', id: 'u1', email: 'amy@x.test', name: 'Amy', role: 'user', expires_at: 1, permissions: {} };

describe('two-step sign-in', () => {
  it('verifies a code (or a recovery code) and gets the session', async () => {
    const { client, calls } = recordingClient(SESSION);
    const result = await verifyMfa(client, 'challenge-token-0123456789', ' 123 456 ', true);
    expect(result.kind).toBe('session');
    expect(calls[0]).toEqual({ url: 'https://chat.test/api/v1/auths/mfa/verify', body: { challenge_token: 'challenge-token-0123456789', code: '123 456', recovery: true } });
  });

  it('confirms an enrollment: the session and the recovery codes', async () => {
    const { client } = recordingClient({ ...SESSION, recovery_codes: ['aaaa-bbbb', 'cccc-dddd'] });
    const { result, recoveryCodes } = await confirmMfaEnrollment(client, 'challenge-token-0123456789', '123456');
    expect(result.kind).toBe('session');
    expect(recoveryCodes).toEqual(['aaaa-bbbb', 'cccc-dddd']);
  });

  it('turns a reset token into the next step', async () => {
    const { client } = recordingClient({ next_step: 'enroll', challenge_token: 'next-challenge-0123456789', expires_in: 300 });
    expect(await redeemMfaReset(client, 'challenge-token-0123456789', ' reset-token ')).toEqual({ kind: 'mfa', step: 'enroll', challengeToken: 'next-challenge-0123456789', expiresIn: 300 });
  });

  it('names the authenticator entry as the server does', () => {
    expect(otpauthUri('abcd efgh ijkl mnop', 'amy@x.test')).toBe('otpauth://totp/Open%20WebUI:amy%40x.test?secret=ABCDEFGHIJKLMNOP&issuer=Open%20WebUI');
  });
});
