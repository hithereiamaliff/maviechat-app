import { describe, expect, it } from 'vitest';
import { isUsable, parseStoredSession, toStoredSession } from './stored-session';

const session = {
  id: 'u1',
  name: 'Test',
  email: 'test@example.com',
  role: 'user',
  token: 'jwt',
  token_type: 'Bearer',
  expires_at: 2_000_000_000,
  permissions: { chat: { edit: true } },
};

describe('stored session', () => {
  it('keeps only what the app needs and round-trips through JSON', () => {
    const stored = toStoredSession('https://chat.example.com', session);
    expect(stored).toEqual({
      version: 1,
      baseUrl: 'https://chat.example.com',
      token: 'jwt',
      user: { id: 'u1', name: 'Test', email: 'test@example.com', role: 'user' },
      expiresAt: 2_000_000_000,
    });
    expect(parseStoredSession(JSON.stringify(stored))).toEqual(stored);
  });

  it('records a missing expiry as never expiring', () => {
    const stored = toStoredSession('https://x.test', { ...session, expires_at: null });
    expect(stored.expiresAt).toBeNull();
    expect(isUsable(stored, Date.now())).toBe(true);
  });

  it('rejects corrupt or old-format values', () => {
    expect(parseStoredSession(null)).toBeNull();
    expect(parseStoredSession('not json')).toBeNull();
    expect(parseStoredSession(JSON.stringify({ version: 2 }))).toBeNull();
    expect(parseStoredSession(JSON.stringify({ ...toStoredSession('https://x.test', session), token: 5 }))).toBeNull();
  });

  it('stops being usable a minute before expiry', () => {
    const stored = toStoredSession('https://x.test', { ...session, expires_at: 1_000_000 });
    expect(isUsable(stored, (1_000_000 - 120) * 1000)).toBe(true);
    expect(isUsable(stored, (1_000_000 - 30) * 1000)).toBe(false);
  });
});
