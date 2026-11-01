import { describe, expect, it } from 'vitest';
import { isLoginPage, nextPath, signInScript } from './webSignIn';

const base = 'https://learn.example.com';

describe('web view sign-in fallback', () => {
  it('follows the login page back to a path on the same site only', () => {
    expect(nextPath(`${base}/login?next=%2Fchat%2Fabc`)).toBe('/chat/abc');
    expect(nextPath(`${base}/login`)).toBe('/chat');
    expect(nextPath(`${base}/login?next=%2F%2Fevil.example`)).toBe('/chat');
    expect(nextPath(`${base}/login?next=https%3A%2F%2Fevil.example`)).toBe('/chat');
    expect(nextPath(`${base}/login?next=%E0%A4%A`)).toBe('/chat');
  });

  it('recognises the login page', () => {
    expect(isLoginPage(`${base}/login?next=%2Fchat`, base)).toBe(true);
    expect(isLoginPage(`${base}/chat`, base)).toBe(false);
    expect(isLoginPage('https://other.example/login', base)).toBe(false);
  });

  it('sets the cookie until the token expires and goes on', () => {
    const script = signInScript('aaa.bbb.ccc', 1_000 + 3_600, `${base}/login?next=%2Fnotebook`, 1_000_000);
    expect(script).toContain('"dt_token=aaa.bbb.ccc; path=/; max-age=3600; secure; samesite=lax"');
    expect(script).toContain('window.location.replace("/notebook")');
    expect(script?.trim().endsWith('true;')).toBe(true);
    expect(signInScript('aaa.bbb.ccc', null, `${base}/login`, 0)).toContain('max-age=2592000');
  });

  it('refuses anything that is not a plain JWT', () => {
    expect(signInScript('a.b.c"; alert(1); "', null, `${base}/login`, 0)).toBeNull();
    expect(signInScript('', null, `${base}/login`, 0)).toBeNull();
  });
});
