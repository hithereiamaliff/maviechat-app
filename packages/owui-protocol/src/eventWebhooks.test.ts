import { describe, expect, it } from 'vitest';
import {
  audienceLine,
  audienceOf,
  createEventWebhook,
  deleteEventWebhook,
  eventFilterProblem,
  eventsLine,
  listEventKinds,
  listEventWebhooks,
  updateEventWebhook,
  webhookHost,
  webhookName,
} from './eventWebhooks';
import { OwuiClient, type FetchLike } from './http';

function answering(answer: unknown) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(answer), { status: 200 });
  };
  return { client: new OwuiClient({ baseUrl: 'https://x.test', token: 't', fetch }), calls };
}

const KNOWN = ['chat.failed', 'chat.finished', 'user.created', 'user.deleted'];

describe('the server’s event webhooks (admins)', () => {
  it('lists the events by name, and the webhooks with the default first, then by name', async () => {
    const kinds = await listEventKinds(answering({ schema: '0.11.3', events: [{ event: 'user.created', message: 'User created', description: 'A user was created.' }, { event: 'chat.finished', message: 'Chat finished' }, { message: 'no name' }] }).client);
    expect(kinds.map((kind) => kind.event)).toEqual(['chat.finished', 'user.created']);
    const hooks = await listEventWebhooks(
      answering([
        { id: 'b', name: 'Zed', url: 'https://z.example/hook', enabled: false, events: ['chat.*'], targets: [] },
        { id: 'default', name: 'Default webhook', url: 'https://old.example/x', events: null, targets: null },
        { id: 'a', name: 'Audit', url: 'https://a.example/e', enabled: true, events: ['user.created'], targets: [{ type: 'group', id: 'g1' }, { type: 'nobody', id: 'x' }] },
        { name: 'no id' },
      ]).client,
    );
    expect(hooks.map((hook) => hook.id)).toEqual(['default', 'a', 'b']);
    expect(hooks[0]).toMatchObject({ enabled: true, events: ['*'], targets: null });
    expect(hooks[1]?.targets).toEqual([{ type: 'group', id: 'g1' }]);
    expect(hooks[2]).toMatchObject({ enabled: false, targets: [] });
  });

  it('adds one with every field, all events when none are chosen', async () => {
    const { client, calls } = answering({ id: 'new', name: 'Webhook', url: 'https://h.example/e', enabled: true, events: ['*'], targets: null });
    const made = await createEventWebhook(client, { name: ' ', url: ' https://h.example/e ', enabled: true, events: [], targets: null });
    expect(made.id).toBe('new');
    expect(calls).toEqual([{ method: 'POST', url: 'https://x.test/api/events/webhooks', body: { name: '', url: 'https://h.example/e', enabled: true, events: ['*'], targets: null } }]);
  });

  it('changes only what it’s given, everyone included, and deletes by id', async () => {
    const { client, calls } = answering({ id: 'a b', url: 'https://h.example/e', events: ['*'] });
    await updateEventWebhook(client, 'a b', { enabled: false });
    await updateEventWebhook(client, 'a b', { targets: null, events: ['user.*'] });
    await deleteEventWebhook(client, 'a b');
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'PUT https://x.test/api/events/webhooks/a%20b',
      'PUT https://x.test/api/events/webhooks/a%20b',
      'DELETE https://x.test/api/events/webhooks/a%20b',
    ]);
    expect(calls[0]?.body).toEqual({ enabled: false });
    expect(calls[1]?.body).toEqual({ events: ['user.*'], targets: null });
  });

  it('checks event filters as the server does', () => {
    expect(eventFilterProblem('*', KNOWN)).toBeNull();
    expect(eventFilterProblem('chat.finished', KNOWN)).toBeNull();
    expect(eventFilterProblem('user.*', KNOWN)).toBeNull();
    expect(eventFilterProblem('nope.*', KNOWN)).toBe('No event starts with nope.');
    expect(eventFilterProblem('.*', KNOWN)).toBe('No event starts with .');
    expect(eventFilterProblem('chat.started', KNOWN)).toBe('The server has no event called chat.started');
  });

  it('says what each one gets, and where to, in a few words', () => {
    expect(eventsLine(['*'])).toBe('All events');
    expect(eventsLine(['chat.finished', 'chat.failed'])).toBe('chat.finished + chat.failed');
    expect(eventsLine(['a', 'b', 'c'])).toBe('3 filters');
    expect(audienceOf(null)).toBe('everyone');
    expect(audienceOf([])).toBe('server');
    expect(audienceLine([{ type: 'user', id: 'u' }, { type: 'group', id: 'g' }, { type: 'group', id: 'h' }])).toBe('1 person + 2 groups');
    expect(audienceLine(null)).toBe('Everyone’s and the server’s');
    expect(webhookHost('https://push.example.com/v1/events/secret')).toBe('push.example.com');
    expect(webhookHost('')).toBe('No address');
    expect(webhookName({ id: 'default', name: '' })).toBe('Default webhook');
    expect(webhookName({ id: 'x', name: '' })).toBe('Webhook');
  });
});
