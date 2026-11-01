import { describe, expect, it } from 'vitest';
import { isDtUsable, parseStoredDtSession, toStoredDtSession } from './deeptutor-session';

const token = (exp: number) => `e30.${btoa(JSON.stringify({ sub: 'probe', exp })).replace(/=+$/, '')}.sig`;
const account = { user_id: 'u1', username: 'probe', role: 'user', is_admin: false };

describe('stored DeepTutor sign-in', () => {
  it('round-trips and reads the expiry from the token', () => {
    const stored = toStoredDtSession('https://learn.example.com', token(2_000_000_000), account);
    expect(stored.expiresAt).toBe(2_000_000_000);
    expect(parseStoredDtSession(JSON.stringify(stored))).toEqual(stored);
  });

  it('rejects damaged or foreign entries', () => {
    expect(parseStoredDtSession(null)).toBeNull();
    expect(parseStoredDtSession('{')).toBeNull();
    expect(parseStoredDtSession(JSON.stringify({ version: 2 }))).toBeNull();
    expect(parseStoredDtSession(JSON.stringify({ version: 1, baseUrl: 'x', token: 't', account: { username: 'a' }, expiresAt: null }))).toBeNull();
  });

  it('is usable until a minute before the token expires', () => {
    const stored = toStoredDtSession('https://learn.example.com', token(1_000), account);
    expect(isDtUsable(stored, 1_000_000 - 61_000)).toBe(true);
    expect(isDtUsable(stored, 1_000_000 - 59_000)).toBe(false);
    expect(isDtUsable({ ...stored, expiresAt: null }, Date.now())).toBe(true);
  });
});
