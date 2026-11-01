import { describe, expect, it } from 'vitest';
import { OwuiClient, type FetchLike } from './http';
import { deleteNotificationTarget, listNotificationTargets, saveWebhookTarget, testNotificationTarget } from './notifications';

function serverWith(targets: { id: string }[]) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const answer = (init?.method ?? 'GET') === 'GET' ? { targets } : { id: 'maviechat-1', enabled: true };
    return new Response(JSON.stringify(answer), { status: 200 });
  };
  return { client: new OwuiClient({ baseUrl: 'https://x.test', token: 't', fetch }), calls };
}

describe('notification targets (0.11.3)', () => {
  it('creates the webhook target for finished and failed chats, delivered always', async () => {
    const { client, calls } = serverWith([{ id: 'slack' }]);
    await saveWebhookTarget(client, { id: 'maviechat-1', url: 'https://push.test/v1/hooks/abc' });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET https://x.test/api/v1/notifications/targets',
      'POST https://x.test/api/v1/notifications/targets',
    ]);
    expect(calls[1]?.body).toEqual({
      id: 'maviechat-1',
      type: 'webhook',
      enabled: true,
      events: ['chat.finished', 'chat.failed'],
      delivery: 'always',
      config: { url: 'https://push.test/v1/hooks/abc' },
    });
  });

  it('updates the target when it already exists', async () => {
    const { client, calls } = serverWith([{ id: 'MavieChat-1' }]);
    await saveWebhookTarget(client, { id: 'maviechat-1', url: 'https://push.test/v1/hooks/new' });
    expect(calls[1]?.method).toBe('PUT');
    expect(calls[1]?.url).toBe('https://x.test/api/v1/notifications/targets/maviechat-1');
    expect(calls[1]?.body).not.toHaveProperty('id');
  });

  it('lists, deletes and tests targets', async () => {
    const { client, calls } = serverWith([{ id: 'a' }]);
    expect((await listNotificationTargets(client)).map((target) => target.id)).toEqual(['a']);
    await deleteNotificationTarget(client, 'a b');
    await testNotificationTarget(client, 'a');
    expect(calls.slice(1).map((call) => `${call.method} ${call.url}`)).toEqual([
      'DELETE https://x.test/api/v1/notifications/targets/a%20b',
      'POST https://x.test/api/v1/notifications/targets/a/test',
    ]);
  });
});
