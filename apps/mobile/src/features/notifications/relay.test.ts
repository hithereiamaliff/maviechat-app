import { OwuiHttpError } from '@maviechat/owui-protocol';
import { describe, expect, it, vi } from 'vitest';
import { describePushError, registerWithRelay, targetIdFor } from './relay';

describe('push relay client', () => {
  it('registers with the Open WebUI sign-in and returns the webhook link', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ webhookUrl: 'https://push.test/v1/hooks/abc' }), { status: 200 }));
    await expect(registerWithRelay(fetch, 'jwt', 'ExponentPushToken[x]', 'https://push.test')).resolves.toBe('https://push.test/v1/hooks/abc');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://push.test/v1/devices');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
    expect(JSON.parse(String(init.body))).toEqual({ pushToken: 'ExponentPushToken[x]' });
  });

  it("passes on the relay's reason, or the status", async () => {
    const refused = vi.fn(async () => new Response(JSON.stringify({ error: 'Open WebUI did not accept this sign-in' }), { status: 401 }));
    await expect(registerWithRelay(refused, 'jwt', 't')).rejects.toThrow('Open WebUI did not accept this sign-in');
    const broken = vi.fn(async () => new Response('oops', { status: 502 }));
    await expect(registerWithRelay(broken, 'jwt', 't')).rejects.toThrow('answered 502');
    const offline = vi.fn(async () => {
      throw new TypeError('Network request failed');
    });
    await expect(registerWithRelay(offline, 'jwt', 't')).rejects.toThrow("couldn't reach");
  });

  it('names a target per phone and explains server refusals', () => {
    expect(targetIdFor('3F9C2A1B-77AA-4E0B')).toBe('maviechat-3f9c2a1b77aa');
    expect(describePushError(new OwuiHttpError(404, undefined, '/x'))).toContain('turned off');
    expect(describePushError(new OwuiHttpError(403, undefined, '/x'))).toContain('User Webhooks permission');
  });
});
