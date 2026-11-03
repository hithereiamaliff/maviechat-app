import { describe, expect, it } from 'vitest';
import { signedOutRoute } from './entry';

describe('signedOutRoute', () => {
  it('welcomes a launch with neither side signed in', () => {
    expect(signedOutRoute('signed-out', false)).toBe('/welcome');
  });

  it('opens DeepTutor when only DeepTutor is signed in', () => {
    expect(signedOutRoute('signed-in', false)).toBe('/learn');
  });

  it("waits for DeepTutor's sign-in to load", () => {
    expect(signedOutRoute('loading', false)).toBeNull();
  });

  it("explains an expired Open WebUI sign-in on its own screen", () => {
    expect(signedOutRoute('signed-in', true)).toBe('/login');
    expect(signedOutRoute('loading', true)).toBe('/login');
  });
});
