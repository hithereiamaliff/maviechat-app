import { describe, expect, it } from 'vitest';
import { interpretSignIn, isExpiring, pendingNotice, UnexpectedResponseError } from './auth';
import { OwuiClient, type FetchLike } from './http';

const session = {
  id: 'u1',
  name: 'Test',
  role: 'user',
  email: 'test@example.com',
  profile_image_url: '/user.png',
  token: 'jwt',
  token_type: 'Bearer',
  expires_at: 2_000_000_000,
  permissions: { chat: {} },
};

describe('interpretSignIn', () => {
  it('accepts a 0.11.x session', () => {
    const result = interpretSignIn(session);
    expect(result.kind).toBe('session');
    if (result.kind === 'session') expect(result.session.token).toBe('jwt');
  });

  it('treats a 0.11.x pending role as pending, keeping the session', () => {
    const result = interpretSignIn({ ...session, role: 'pending' });
    expect(result).toEqual({ kind: 'pending', session: { ...session, role: 'pending' } });
  });

  it('understands 0.12.x next_step answers', () => {
    expect(interpretSignIn({ next_step: 'pending' })).toEqual({ kind: 'pending', session: null });
    expect(interpretSignIn({ next_step: 'verify', challenge_token: 'c', expires_in: 300 })).toEqual({
      kind: 'mfa',
      step: 'verify',
      challengeToken: 'c',
      expiresIn: 300,
    });
  });

  it('rejects anything that is not Open WebUI', () => {
    expect(() => interpretSignIn('<html>')).toThrow(UnexpectedResponseError);
    expect(() => interpretSignIn({ token: 'x' })).toThrow(UnexpectedResponseError);
    expect(() => interpretSignIn({ next_step: 'dance' })).toThrow(UnexpectedResponseError);
    expect(() => interpretSignIn({ next_step: 'verify' })).toThrow(UnexpectedResponseError);
  });
});

describe('isExpiring', () => {
  const now = 1_000_000 * 1000;

  it('never expires without an expiry', () => {
    expect(isExpiring(null, now)).toBe(false);
    expect(isExpiring(undefined, now)).toBe(false);
  });

  it('expires within the margin', () => {
    expect(isExpiring(1_000_000 + 30, now)).toBe(true);
    expect(isExpiring(1_000_000 + 61, now)).toBe(false);
    expect(isExpiring(999_999, now)).toBe(true);
  });
});

describe('pendingNotice', () => {
  const clientWith = (config: unknown, admin: unknown) => {
    const fetch: FetchLike = async (url) => {
      const path = new URL(url).pathname;
      if (path === '/api/config') return new Response(JSON.stringify(config), { status: 200 });
      if (admin === null) return new Response(JSON.stringify({ detail: 'nope' }), { status: 400 });
      return new Response(JSON.stringify(admin), { status: 200 });
    };
    return new OwuiClient({ baseUrl: 'https://chat.test', token: 'pending-token', fetch });
  };

  it('reads the admin’s words and contact, where the server shares them', async () => {
    const notice = await pendingNotice(clientWith({ ui: { pending_user_overlay_title: ' Hold on ', pending_user_overlay_content: 'Ask **Ada**.' } }, { name: 'Ada', email: 'ada@example.com' }));
    expect(notice).toEqual({ title: 'Hold on', content: 'Ask **Ada**.', admin: { name: 'Ada', email: 'ada@example.com' } });
  });

  it('leaves out what the server doesn’t answer', async () => {
    expect(await pendingNotice(clientWith({}, null))).toEqual({ title: '', content: '', admin: null });
  });
});
