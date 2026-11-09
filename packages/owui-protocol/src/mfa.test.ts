import { describe, expect, it } from 'vitest';
import { OwuiClient, OwuiHttpError, type FetchLike } from './http';
import { confirmMfaEnrollment, confirmMfaReplacement, getMfaStatus, needsFreshSignIn, newRecoveryCodes, otpauthUri, redeemMfaReset, startMfaReplacement, verifyMfa } from './mfa';

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

describe('your own two-step sign-in', () => {
  function server(routes: Record<string, { status?: number; body: unknown }>) {
    const calls: { method: string; path: string; body: unknown }[] = [];
    const fetch: FetchLike = async (url, init) => {
      const path = new URL(url).pathname;
      calls.push({ method: init?.method ?? 'GET', path, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      const route = routes[`${init?.method ?? 'GET'} ${path}`] ?? { body: {} };
      return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
    };
    return { client: new OwuiClient({ baseUrl: 'https://chat.test', token: 't', fetch }), calls };
  }

  it('reads the status', async () => {
    const { client } = server({ 'GET /api/v1/auths/mfa/status': { body: { enabled: true, required: true, recovery_codes_remaining: 7 } } });
    expect(await getMfaStatus(client)).toEqual({ enabled: true, required: true, recoveryCodesRemaining: 7 });
  });

  it('has no status where the server has no two-step sign-in (0.11 sends its web page; or 404)', async () => {
    const page: FetchLike = async () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    expect(await getMfaStatus(new OwuiClient({ baseUrl: 'https://chat.test', token: 't', fetch: page }))).toBeNull();
    const { client } = server({ 'GET /api/v1/auths/mfa/status': { status: 404, body: { detail: 'Not Found' } } });
    expect(await getMfaStatus(client)).toBeNull();
    const refused = server({ 'GET /api/v1/auths/mfa/status': { status: 401, body: { detail: 'Not authenticated' } } });
    await expect(getMfaStatus(refused.client)).rejects.toBeInstanceOf(OwuiHttpError);
  });

  it('starts a replacement with a code, confirms the new authenticator, and makes new recovery codes', async () => {
    const { client, calls } = server({
      'POST /api/v1/auths/mfa/replace': { body: { next_step: 'enroll', challenge_token: 'ch', expires_in: 300 } },
      'POST /api/v1/auths/mfa/enroll/confirm': { body: { recovery_codes: ['a', 'b'] } },
      'POST /api/v1/auths/mfa/recovery/codes': { body: { recovery_codes: ['c', 'd'] } },
    });
    expect(await startMfaReplacement(client, ' 123456 ', false)).toEqual({ challengeToken: 'ch', expiresIn: 300 });
    expect(calls[0]?.body).toEqual({ code: '123456', recovery: false });
    expect(await confirmMfaReplacement(client, 'ch', '654321')).toEqual(['a', 'b']);
    expect(calls[1]?.body).toEqual({ challenge_token: 'ch', code: '654321' });
    expect(await newRecoveryCodes(client, 'abcd-efgh', true)).toEqual(['c', 'd']);
    expect(calls[2]?.body).toEqual({ code: 'abcd-efgh', recovery: true });
  });

  it('knows when the server wants a fresh sign-in first', async () => {
    const { client } = server({ 'POST /api/v1/auths/mfa/replace': { status: 403, body: { detail: 'reauthentication_required' } } });
    const error = await startMfaReplacement(client, '123456', false).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OwuiHttpError);
    expect(needsFreshSignIn(error)).toBe(true);
    expect(needsFreshSignIn(new Error('other'))).toBe(false);
  });
});
