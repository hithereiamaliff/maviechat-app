import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { chatIdFromUrl, chatOutcome, notificationFor, preview } from './notification.ts';
import { createRelay, RateLimiter } from './relay.ts';
import { DeviceStore } from './store.ts';

const phone = 'ExponentPushToken[abc123_DEF-456]';
const otherPhone = 'ExponentPushToken[zzz999]';
const secret = 'a'.repeat(43);

describe('notifications', () => {
  it('reads the chat id from the links Open WebUI sends', () => {
    expect(chatIdFromUrl('https://chat.example.com/3f9c2a1b-77aa-4e0b')).toBe('3f9c2a1b-77aa-4e0b');
    expect(chatIdFromUrl('/3f9c2a1b-77aa-4e0b')).toBe('3f9c2a1b-77aa-4e0b');
    expect(chatIdFromUrl('https://chat.example.com/')).toBeNull();
  });

  it('previews a reply as plain text', () => {
    const reply = '<details type="reasoning">thinking…</details>\n# Plan\n\n**Start** with [breakfast](https://x.test) in Old Town.\n```js\ncode()\n```\nThen walk.';
    expect(preview(reply)).toBe('Plan Start with breakfast in Old Town. Then walk.');
    expect(preview('a'.repeat(300)).length).toBe(140);
  });

  it('turns finished and failed chat events into notifications, and skips the rest', () => {
    const finished = chatOutcome({ event: 'chat.finished', data: { user_id: 'u1', chat_id: 'c-123456789', title: 'Ipoh trip', message: 'Start early.' } });
    expect(finished).toEqual({ userId: 'u1', kind: 'chat.finished', chatId: 'c-123456789', title: 'Ipoh trip', text: 'Start early.' });
    expect(notificationFor(finished!, phone)).toMatchObject({ to: phone, title: 'Reply ready: Ipoh trip', body: 'Start early.', data: { kind: 'chat.finished', userId: 'u1', chatId: 'c-123456789' }, threadId: 'c-123456789' });

    const failed = chatOutcome({ event: 'chat.failed', actor: { id: 'u2' }, data: { url: '/c-987654321', message: 'Model timed out' } });
    expect(failed).toMatchObject({ userId: 'u2', kind: 'chat.failed', chatId: 'c-987654321', title: null });
    expect(notificationFor(failed!, phone).title).toBe('Reply failed');
    expect(notificationFor({ ...finished!, title: null, text: '' }, phone)).toMatchObject({ title: 'Reply ready', body: 'Open the chat to read it.' });

    expect(chatOutcome({ event: 'chat.finished', data: { title: 'New Chat', user_id: 'u1' } })?.title).toBeNull();
    expect(chatOutcome({ event: 'user.signin', data: { user_id: 'u1' } })).toBeNull();
    expect(chatOutcome({ event: 'chat.finished', data: {} })).toBeNull();
  });
});

describe('device list', () => {
  it('keeps a phone under several accounts, caps both sides and forgets departed phones', () => {
    let clock = 0;
    const store = new DeviceStore(null, () => (clock += 1));
    store.add('u1', phone);
    store.add('u2', phone);
    expect(store.tokensFor('u1')).toEqual([phone]);
    expect(store.tokensFor('u2')).toEqual([phone]);
    // Registering again doesn't duplicate it.
    store.add('u1', phone);
    expect(store.tokensFor('u1')).toEqual([phone]);
    // Ten accounts at most on one phone: the one it joined longest ago lets go.
    for (let i = 0; i < 10; i++) store.add(`many${i}`, phone);
    expect(store.tokensFor('u2')).toEqual([]);
    expect(store.tokensFor('u1')).toEqual([]);
    expect(store.tokensFor('many9')).toEqual([phone]);
    expect(store.tokensFor('many0')).toEqual([phone]);
    store.add('u2', phone);
    for (let i = 0; i < 12; i++) store.add('u3', `ExponentPushToken[t${i}]`);
    expect(store.tokensFor('u3')).toHaveLength(10);
    expect(store.tokensFor('u3')[0]).toBe('ExponentPushToken[t11]');
    store.forget(phone);
    expect(store.tokensFor('u2')).toEqual([]);
    expect(store.tokensFor('many5')).toEqual([]);
    expect(store.remove('u3', 'ExponentPushToken[t11]')).toBe(true);
    expect(store.remove('u3', 'ExponentPushToken[t11]')).toBe(false);
  });

  it('keeps the list in a private file across restarts', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'relay-')), 'data', 'devices.json');
    const store = new DeviceStore(file, () => 1_000_000);
    store.add('u1', phone);
    store.noteEvent();
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8')).not.toContain('message');
    const reopened = new DeviceStore(file);
    expect(reopened.tokensFor('u1')).toEqual([phone]);
    expect(reopened.lastEventAt).toBe(1_000_000);
  });
});

describe('relay', () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const request = (method: string, requestPath: string, body: unknown = '', authorization?: string) => ({
    method,
    path: requestPath,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    authorization,
    ip: '203.0.113.9',
  });
  /** Open WebUI says the bearer token is user-1; Expo accepts or rejects as told. */
  function setup(expo: (messages: Array<{ to: string }>) => unknown = (messages) => ({ data: messages.map(() => ({ status: 'ok' })) })) {
    const store = new DeviceStore(null);
    const sent: Array<Array<{ to: string; title: string }>> = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v1/auths/')) {
        const auth = (init?.headers as Record<string, string>).Authorization;
        return auth === 'Bearer good' ? json(200, { id: 'user-1' }) : json(401, { detail: 'Not authenticated' });
      }
      const messages = JSON.parse(String(init?.body)) as Array<{ to: string; title: string }>;
      sent.push(messages);
      return json(200, expo(messages));
    });
    const handle = createRelay({ eventsSecret: secret, owuiUrl: 'https://chat.example.com/' }, store, fetch);
    return { handle, store, sent, fetch };
  }

  it('registers and removes a signed-in phone', async () => {
    const { handle, store } = setup();
    expect((await handle(request('POST', '/v1/devices', { pushToken: phone }))).status).toBe(401);
    expect((await handle(request('POST', '/v1/devices', { pushToken: phone }, 'Bearer bad'))).status).toBe(401);
    expect((await handle(request('POST', '/v1/devices', { pushToken: 'nope' }, 'Bearer good'))).status).toBe(400);
    const added = await handle(request('POST', '/v1/devices', { pushToken: phone }, 'Bearer good'));
    expect(added).toEqual({ status: 200, body: { registered: true, lastEventAt: null } });
    expect(store.tokensFor('user-1')).toEqual([phone]);
    expect((await handle(request('DELETE', '/v1/devices', { pushToken: phone }, 'Bearer good'))).body).toEqual({ removed: true });
    expect(store.tokensFor('user-1')).toEqual([]);
  });

  it("notifies the reply's owner for server-wide events, whatever their permissions", async () => {
    const { handle, store, sent } = setup();
    store.add('user-1', phone);
    store.add('user-2', otherPhone);
    const event = { event: 'chat.finished', actor: { id: 'user-1' }, data: { user_id: 'user-1', chat_id: 'c-123456789', title: 'Ipoh', message: 'Done' } };
    expect((await handle(request('POST', `/v1/events/${secret}`, event))).body).toEqual({ sent: 1 });
    expect(sent[0]).toMatchObject([{ to: phone, title: 'Reply ready: Ipoh' }]);
    expect(store.lastEventAt).not.toBeNull();
    expect((await handle(request('POST', `/v1/events/${secret}`, { event: 'user.signin', data: { user_id: 'user-1' } }))).status).toBe(202);
    expect((await handle(request('POST', `/v1/events/${'b'.repeat(43)}`, event))).status).toBe(404);
    expect(sent).toHaveLength(1);
  });

  it('forgets phones Apple no longer reaches', async () => {
    const { handle, store } = setup(() => ({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }));
    store.add('user-1', phone);
    await handle(request('POST', `/v1/events/${secret}`, { event: 'chat.finished', data: { user_id: 'user-1' } }));
    expect(store.tokensFor('user-1')).toEqual([]);
  });

  it("sends a test to the caller's phone", async () => {
    const { handle, store, sent } = setup();
    expect((await handle(request('POST', '/v1/devices/test', { pushToken: phone }, 'Bearer good'))).status).toBe(404);
    store.add('user-1', phone);
    expect((await handle(request('POST', '/v1/devices/test', { pushToken: phone }, 'Bearer good'))).body).toEqual({ sent: 1, lastEventAt: null });
    expect(sent[0]?.[0]?.title).toBe('MavieChat notifications work');
  });

  it('answers health and refuses everything else', async () => {
    const { handle } = setup();
    expect((await handle(request('GET', '/health'))).status).toBe(200);
    expect((await handle(request('GET', '/v1/devices'))).status).toBe(404);
    expect((await handle(request('POST', '/v1/hooks/anything', {}))).status).toBe(404);
  });

  it('limits calls per caller', () => {
    let now = 0;
    const limiter = new RateLimiter(2, () => now);
    expect([limiter.allow('ip'), limiter.allow('ip'), limiter.allow('ip')]).toEqual([true, true, false]);
    now = 61_000;
    expect(limiter.allow('ip')).toBe(true);
  });
});
