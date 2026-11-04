import { describe, expect, it, vi } from 'vitest';
import { describePushError, isRelayServer, legacyTargetId, registerWithRelay, testThroughRelay, unregisterFromRelay } from './relay';

describe('which servers the relay serves', () => {
  it('knows TechMavie Digital’s two servers, however the address is written', () => {
    for (const url of ['https://chat.techmavie.digital', 'https://Chat.TechMavie.Digital/', 'https://chat.techmavie.digital:443', ' https://chat.techmavie.digital/c/abc?x=1 ']) {
      expect(isRelayServer('owui', url)).toBe(true);
    }
    expect(isRelayServer('deeptutor', 'https://learn.techmavie.digital/')).toBe(true);
  });

  it('refuses every other server, look-alikes included', () => {
    for (const url of [
      'http://chat.techmavie.digital',
      'https://chat.techmavie.digital:8443',
      'https://chat.techmavie.digital.example.com',
      'https://chat.techmavie.digital@example.com',
      'https://example.com/https://chat.techmavie.digital',
      'https://learn.techmavie.digital',
      'chat.techmavie.digital',
      '',
    ]) {
      expect(isRelayServer('owui', url)).toBe(false);
    }
    expect(isRelayServer('deeptutor', 'https://chat.techmavie.digital')).toBe(false);
  });
});

const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('push relay client', () => {
  it('registers with the Open WebUI sign-in and reports whether Open WebUI sends events yet', async () => {
    const fetch = vi.fn(async () => answer(200, { registered: true, lastEventAt: null }));
    await expect(registerWithRelay(fetch, 'jwt', 'ExponentPushToken[x]', 'https://push.test')).resolves.toEqual({ lastEventAt: null });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://push.test/v1/devices');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
    expect(JSON.parse(String(init.body))).toEqual({ pushToken: 'ExponentPushToken[x]' });
  });

  it('removes the phone and sends tests', async () => {
    const fetch = vi.fn(async () => answer(200, { sent: 1, lastEventAt: 1_700_000_000_000 }));
    await unregisterFromRelay(fetch, 'jwt', 't', 'https://push.test');
    await expect(testThroughRelay(fetch, 'jwt', 't', 'https://push.test')).resolves.toEqual({ lastEventAt: 1_700_000_000_000 });
    expect(fetch.mock.calls.map((call) => `${(call as unknown as [string, RequestInit])[1].method} ${(call as unknown as [string])[0]}`)).toEqual([
      'DELETE https://push.test/v1/devices',
      'POST https://push.test/v1/devices/test',
    ]);
  });

  it("passes on the relay's reason, or the status", async () => {
    await expect(registerWithRelay(vi.fn(async () => answer(401, { error: 'Open WebUI did not accept this sign-in' })), 'jwt', 't')).rejects.toThrow(
      'Open WebUI did not accept this sign-in',
    );
    await expect(registerWithRelay(vi.fn(async () => new Response('oops', { status: 502 })), 'jwt', 't')).rejects.toThrow('answered 502');
    const offline = vi.fn(async () => {
      throw new TypeError('Network request failed');
    });
    await expect(registerWithRelay(offline, 'jwt', 't')).rejects.toThrow("couldn't reach");
    expect(describePushError(new Error('x'))).toBe("Notifications couldn't be set up: x.");
  });

  it('names the target earlier versions saved', () => {
    expect(legacyTargetId('3F9C2A1B-77AA-4E0B')).toBe('maviechat-3f9c2a1b77aa');
  });
});
