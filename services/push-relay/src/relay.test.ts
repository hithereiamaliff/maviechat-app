import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { chatIdFromUrl, preview, pushFor } from './notification.ts';
import { createRelay, RateLimiter } from './relay.ts';
import { loadKey, seal, unseal } from './seal.ts';

const key = randomBytes(32);
const token = 'ExponentPushToken[abc123_DEF-456]';

describe('seal', () => {
  it('round-trips and rejects tampering or another key', () => {
    const sealed = seal(key, { pushToken: token, userId: 'u1' });
    expect(unseal(key, sealed)).toEqual({ pushToken: token, userId: 'u1' });
    const flipped = `${sealed.slice(0, 20)}${sealed[20] === 'A' ? 'B' : 'A'}${sealed.slice(21)}`;
    expect(unseal(key, flipped)).toBeNull();
    expect(unseal(randomBytes(32), sealed)).toBeNull();
    expect(unseal(key, 'short')).toBeNull();
    expect(seal(key, { pushToken: token, userId: 'u1' })).not.toBe(sealed);
  });

  it('wants a 32-byte key', () => {
    expect(() => loadKey(undefined)).toThrow();
    expect(() => loadKey(randomBytes(16).toString('base64'))).toThrow();
    expect(loadKey(key.toString('base64')).equals(key)).toBe(true);
  });
});

describe('notifications', () => {
  it('reads the chat id from the links Open WebUI sends', () => {
    expect(chatIdFromUrl('https://chat.example.com/3f9c2a1b-77aa-4e0b-9a3e-5d2f1c0b8e11')).toBe('3f9c2a1b-77aa-4e0b-9a3e-5d2f1c0b8e11');
    expect(chatIdFromUrl('/3f9c2a1b-77aa-4e0b-9a3e-5d2f1c0b8e11')).toBe('3f9c2a1b-77aa-4e0b-9a3e-5d2f1c0b8e11');
    expect(chatIdFromUrl('https://chat.example.com/')).toBeNull();
    expect(chatIdFromUrl('')).toBeNull();
  });

  it('previews a reply as plain text', () => {
    const reply = '<details type="reasoning">thinking…</details>\n# Plan\n\n**Start** with [breakfast](https://x.test) in Old Town.\n```js\ncode()\n```\nThen walk.';
    expect(preview(reply)).toBe('Plan Start with breakfast in Old Town. Then walk.');
    expect(preview('a'.repeat(300)).length).toBe(140);
  });

  it('announces finished and failed chats and the test button, nothing else', () => {
    const finished = pushFor({ action: 'chat', title: 'Ipoh trip', message: 'Start early.', url: 'https://h/3f9c2a1b-77aa' }, token);
    expect(finished).toMatchObject({ to: token, title: 'Reply ready: Ipoh trip', body: 'Start early.', data: { kind: 'chat.finished', chatId: '3f9c2a1b-77aa' }, threadId: '3f9c2a1b-77aa' });
    expect(pushFor({ action: 'chat', title: 'New Chat', message: '' }, token)).toMatchObject({ title: 'Reply ready', body: 'Open the chat to read it.' });
    expect(pushFor({ action: 'chat_failed', title: 'Ipoh trip', message: 'Model timed out' }, token)).toMatchObject({ title: 'Reply failed: Ipoh trip', data: { kind: 'chat.failed' } });
    expect(pushFor({ action: 'test' }, token)?.data.kind).toBe('test');
    expect(pushFor({ action: 'channel' }, token)).toBeNull();
  });
});

describe('relay', () => {
  const config = { key, publicUrl: 'https://push.example.com/', owuiUrl: 'https://chat.example.com' };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const request = (method: string, path: string, body: unknown = '', authorization?: string) => ({
    method,
    path,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    authorization,
    ip: '203.0.113.9',
  });

  it('registers a signed-in phone and hands back a sealed webhook link', async () => {
    const fetch = vi.fn(async () => json(200, { id: 'user-1' }));
    const handle = createRelay(config, fetch);
    const result = await handle(request('POST', '/v1/devices', { pushToken: token }, 'Bearer owui-jwt'));
    expect(result.status).toBe(200);
    const url = (result.body as { webhookUrl: string }).webhookUrl;
    expect(url.startsWith('https://push.example.com/v1/hooks/')).toBe(true);
    expect(unseal(key, url.split('/').pop() as string)).toEqual({ pushToken: token, userId: 'user-1' });
    expect(fetch).toHaveBeenCalledWith('https://chat.example.com/api/v1/auths/', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer owui-jwt' }) }));
  });

  it('refuses registrations without a valid sign-in or token', async () => {
    const handle = createRelay(config, vi.fn(async () => json(401, { detail: 'Not authenticated' })));
    expect((await handle(request('POST', '/v1/devices', { pushToken: token }))).status).toBe(401);
    expect((await handle(request('POST', '/v1/devices', { pushToken: 'nope' }, 'Bearer x'))).status).toBe(400);
    expect((await handle(request('POST', '/v1/devices', { pushToken: token }, 'Bearer bad'))).status).toBe(401);
  });

  it('sends a push for a finished chat and reports a phone that left', async () => {
    const sealed = seal(key, { pushToken: token, userId: 'user-1' });
    const fetch = vi.fn(async () => json(200, { data: [{ status: 'ok', id: 'ticket' }] }));
    const handle = createRelay(config, fetch);
    const result = await handle(request('POST', `/v1/hooks/${sealed}`, { action: 'chat', title: 'Ipoh', message: 'Done', url: '/3f9c2a1b-77aa' }));
    expect(result.status).toBe(200);
    const sent = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Array<{ to: string; title: string }>;
    expect(sent[0]).toMatchObject({ to: token, title: 'Reply ready: Ipoh' });

    const gone = createRelay(config, vi.fn(async () => json(200, { data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] })));
    expect((await gone(request('POST', `/v1/hooks/${sealed}`, { action: 'chat' }))).status).toBe(410);
  });

  it('ignores other events and unknown links', async () => {
    const fetch = vi.fn();
    const handle = createRelay(config, fetch);
    const sealed = seal(key, { pushToken: token, userId: 'user-1' });
    expect((await handle(request('POST', `/v1/hooks/${sealed}`, { action: 'channel' }))).status).toBe(202);
    expect((await handle(request('POST', '/v1/hooks/not-a-link', { action: 'chat' }))).status).toBe(404);
    expect((await handle(request('GET', '/health'))).status).toBe(200);
    expect((await handle(request('GET', '/anything'))).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('limits registrations per caller', () => {
    let now = 0;
    const limiter = new RateLimiter(2, () => now);
    expect([limiter.allow('ip'), limiter.allow('ip'), limiter.allow('ip')]).toEqual([true, true, false]);
    now = 61_000;
    expect(limiter.allow('ip')).toBe(true);
  });
});
