import { OwuiHttpError, OwuiNetworkError, UnexpectedResponseError } from '@maviechat/owui-protocol';
import { describe, expect, it } from 'vitest';
import { describeSignInError } from './errors';

describe('describeSignInError', () => {
  it("prefers the server's own message", () => {
    const error = new OwuiHttpError(400, 'The email or password provided is incorrect.', '/api/v1/auths/signin');
    expect(describeSignInError(error)).toBe('The email or password provided is incorrect.');
  });

  it('explains a wrong address', () => {
    expect(describeSignInError(new OwuiHttpError(404, undefined, '/api/v1/auths/signin'))).toMatch(/Open WebUI server/);
    expect(describeSignInError(new UnexpectedResponseError('sign-in response'))).toMatch(/Open WebUI server/);
  });

  it('separates timeouts from unreachable servers', () => {
    expect(describeSignInError(new OwuiNetworkError('/x', new Error('x'), true))).toMatch(/too long/);
    expect(describeSignInError(new OwuiNetworkError('/x', new Error('x'), false))).toMatch(/Couldn't reach/);
  });

  it('falls back to a generic message', () => {
    expect(describeSignInError('weird')).toBe('Sign-in failed. Please try again.');
  });
});
