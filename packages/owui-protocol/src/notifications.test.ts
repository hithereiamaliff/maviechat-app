import { describe, expect, it } from 'vitest';
import { OwuiClient, type FetchLike } from './http';
import {
  createNotificationTarget,
  deleteNotificationTarget,
  FALLBACK_NOTIFICATION_EVENTS,
  listNotificationEvents,
  listNotificationTargets,
  maskedTargetUrl,
  saveWebhookTarget,
  setDefaultNotificationTarget,
  targetEventsLine,
  testNotificationTarget,
  updateNotificationTarget,
  type NotificationTarget,
} from './notifications';

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

function answering(answer: unknown, status = 200) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(answer), { status });
  };
  return { client: new OwuiClient({ baseUrl: 'https://x.test', token: 't', fetch }), calls };
}

describe('your notification targets, as the web edits them', () => {
  it('reads the server’s events, or the web’s two chat events when it can’t', async () => {
    const { client } = answering({ events: [{ event: 'chat.finished', label: 'Chat finished', description: 'Done.' }, { event: 'automation.run_failed' }, { label: 'no event' }] });
    expect(await listNotificationEvents(client)).toEqual([
      { event: 'chat.finished', label: 'Chat finished', description: 'Done.' },
      { event: 'automation.run_failed', label: 'automation.run_failed', description: '' },
    ]);
    expect(await listNotificationEvents(answering({ detail: 'Not Found' }, 404).client)).toEqual(FALLBACK_NOTIFICATION_EVENTS);
  });

  it('adds a webhook on by default, named only when you name it', async () => {
    const { client, calls } = answering({ id: 'example-com' });
    await createNotificationTarget(client, { url: ' https://hooks.example.com/abc ', events: ['chat.finished'], delivery: 'away' });
    await createNotificationTarget(client, { id: ' team ', url: 'https://hooks.example.com/abc', enabled: false, events: [] });
    expect(calls.map((call) => call.body)).toEqual([
      { type: 'webhook', enabled: true, events: ['chat.finished'], delivery: 'away', config: { url: 'https://hooks.example.com/abc' } },
      { id: 'team', type: 'webhook', enabled: false, events: [], config: { url: 'https://hooks.example.com/abc' } },
    ]);
  });

  it('changes only what you change: no address keeps the saved one, a new name renames it', async () => {
    const { client, calls } = answering({ id: 'b' });
    await updateNotificationTarget(client, 'a b', { enabled: false });
    await updateNotificationTarget(client, 'a', { id: 'b', url: '', events: ['chat.failed'], delivery: 'always' });
    await setDefaultNotificationTarget(client, 'b');
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'PUT https://x.test/api/v1/notifications/targets/a%20b',
      'PUT https://x.test/api/v1/notifications/targets/a',
      'PUT https://x.test/api/v1/notifications/targets/b/default',
    ]);
    expect(calls[0]?.body).toEqual({ type: 'webhook', enabled: false });
    expect(calls[1]?.body).toEqual({ id: 'b', type: 'webhook', events: ['chat.failed'], delivery: 'always' });
  });

  it('shows the masked address and what the target follows', () => {
    const target: NotificationTarget = { id: 'a', type: 'webhook', enabled: true, events: ['chat.finished', 'calendar.alert'], delivery: 'away', config: { url_masked: 'https://hooks.example.com/...xyz' } };
    expect(maskedTargetUrl(target)).toBe('https://hooks.example.com/...xyz');
    expect(maskedTargetUrl({ ...target, config: {} })).toBe('');
    expect(targetEventsLine(target, FALLBACK_NOTIFICATION_EVENTS)).toBe('Chat finished, calendar.alert · Only when away');
    expect(targetEventsLine({ ...target, delivery: 'always' }, FALLBACK_NOTIFICATION_EVENTS)).toBe('Chat finished, calendar.alert · Always');
    expect(targetEventsLine({ ...target, events: [] }, FALLBACK_NOTIFICATION_EVENTS)).toBe('No automatic events');
  });
});
