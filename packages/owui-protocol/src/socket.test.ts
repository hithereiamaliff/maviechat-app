import { afterEach, describe, expect, it, vi } from 'vitest';
import { openSocketSession, type ChatEventEnvelope, type SocketLike } from './socket';

type Listener = (...args: never[]) => void;

class FakeSocket implements SocketLike {
  id: string | undefined = 'sock-1';
  connected = false;
  url = '';
  options: Record<string, unknown> = {};
  emitted: { event: string; args: unknown[] }[] = [];
  pendingAcks: { event: string; data: unknown; ack: (error: unknown, response?: unknown) => void }[] = [];
  disconnected = false;
  private listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)?.add(listener);
    return this;
  }

  off(event: string, listener?: Listener) {
    if (listener) this.listeners.get(event)?.delete(listener);
    else this.listeners.delete(event);
    return this;
  }

  emit(event: string, ...args: unknown[]) {
    this.emitted.push({ event, args });
    return this;
  }

  timeout() {
    return {
      emit: (event: string, data: unknown, ack: (error: unknown, response?: unknown) => void) => {
        this.pendingAcks.push({ event, data, ack });
        return this;
      },
    };
  }

  disconnect() {
    this.disconnected = true;
    this.connected = false;
    return this;
  }

  fire(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) (listener as (...a: unknown[]) => void)(...args);
  }

  serverConnects() {
    this.connected = true;
    this.fire('connect');
  }
}

function open(options: Partial<Parameters<typeof openSocketSession>[0]> = {}) {
  const fake = new FakeSocket();
  const session = openSocketSession({
    baseUrl: 'https://x.test',
    token: 'jwt',
    connect: (url, socketOptions) => {
      fake.url = url;
      fake.options = socketOptions;
      return fake;
    },
    ...options,
  });
  return { fake, session };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('openSocketSession', () => {
  it('connects like the web app: path, websocket transport and token', () => {
    const { fake } = open({ websocketOnly: true });
    expect(fake.url).toBe('https://x.test');
    expect(fake.options.path).toBe('/ws/socket.io');
    expect(fake.options.transports).toEqual(['websocket']);
    expect(fake.options.auth).toEqual({ token: 'jwt' });
  });

  it('allows polling when the server is not websocket-only', () => {
    const { fake } = open({ websocketOnly: false });
    expect(fake.options.transports).toEqual(['polling', 'websocket']);
  });

  it('sends user-join on connect and resolves with the joined user', async () => {
    const statuses: string[] = [];
    const { fake, session } = open({ expectedUserId: 'u1', onStatus: (s) => statuses.push(s) });
    fake.serverConnects();

    expect(fake.pendingAcks[0]?.event).toBe('user-join');
    expect(fake.pendingAcks[0]?.data).toEqual({ auth: { token: 'jwt' } });
    fake.pendingAcks[0]?.ack(null, { id: 'u1', name: 'Test' });

    await expect(session.joined).resolves.toEqual({ id: 'u1', name: 'Test' });
    expect(session.status).toBe('joined');
    expect(session.sessionId).toBe('sock-1');
    expect(statuses).toContain('joined');
  });

  it('marks chats read once joined, like the web app', async () => {
    const { fake, session } = open();
    session.markRead('c1');
    expect(fake.emitted.filter((e) => e.event === 'events:chat')).toEqual([]);
    fake.serverConnects();
    fake.pendingAcks[0]?.ack(null, { id: 'u1', name: 'Test' });
    await session.joined;
    session.markRead('c2');
    expect(fake.emitted.filter((e) => e.event === 'events:chat').map((e) => e.args[0])).toEqual([
      { chat_id: 'c1', data: { type: 'last_read_at' } },
      { chat_id: 'c2', data: { type: 'last_read_at' } },
    ]);
  });

  it('closes when the socket signs in as someone else', async () => {
    const { fake, session } = open({ expectedUserId: 'u1' });
    fake.serverConnects();
    fake.pendingAcks[0]?.ack(null, { id: 'u2', name: 'Other' });

    await expect(session.joined).rejects.toThrow('different user');
    expect(fake.disconnected).toBe(true);
    expect(session.status).toBe('closed');
  });

  it('rejects when the server refuses the token (no ack payload)', async () => {
    const { fake, session } = open();
    fake.serverConnects();
    fake.pendingAcks[0]?.ack(null, undefined);
    await expect(session.joined).rejects.toThrow('refused');
  });

  it('sends heartbeats while connected', () => {
    vi.useFakeTimers();
    const { fake } = open({ heartbeatIntervalSec: 10 });
    fake.serverConnects();
    vi.advanceTimersByTime(25_000);
    expect(fake.emitted.filter((e) => e.event === 'heartbeat')).toHaveLength(2);

    fake.connected = false;
    fake.fire('disconnect');
    vi.advanceTimersByTime(30_000);
    expect(fake.emitted.filter((e) => e.event === 'heartbeat')).toHaveLength(2);
  });

  it('re-joins after a reconnect', () => {
    const { fake, session } = open();
    fake.serverConnects();
    fake.pendingAcks[0]?.ack(null, { id: 'u1', name: 'Test' });
    fake.fire('disconnect');
    expect(session.status).toBe('reconnecting');
    fake.serverConnects();
    expect(fake.pendingAcks).toHaveLength(2);
  });

  it('follows a note: joins its room once signed in, again after a reconnect, and passes only its changes', async () => {
    const { fake, session } = open();
    const seen: unknown[] = [];
    const stop = session.watchNote('n1', (change) => seen.push(change));
    const joins = () => fake.emitted.filter((e) => e.event === 'join-note').map((e) => e.args[0]);
    expect(joins()).toEqual([]);
    fake.serverConnects();
    fake.pendingAcks[0]?.ack(null, { id: 'u1', name: 'Test' });
    await session.joined;
    expect(joins()).toEqual([{ note_id: 'n1', auth: { token: 'jwt' } }]);
    // 0.12's name for the same join goes too.
    expect(fake.emitted.filter((e) => e.event === 'note:join').map((e) => e.args[0])).toEqual([{ note_id: 'n1', auth: { token: 'jwt' } }]);
    session.watchNote('n1', () => undefined);
    expect(joins()).toHaveLength(1);
    fake.fire('events:note', { id: 'n1', title: 'T' });
    fake.fire('events:note', { id: 'n2', title: 'Other' });
    fake.fire('events:note', 'junk');
    expect(seen).toEqual([{ id: 'n1', title: 'T' }]);
    fake.fire('disconnect');
    fake.serverConnects();
    fake.pendingAcks[1]?.ack(null, { id: 'u1', name: 'Test' });
    expect(joins()).toHaveLength(2);
    stop();
    expect(fake.emitted.filter((e) => e.event === 'note:leave').map((e) => e.args[0])).toEqual([]);
    fake.fire('events:note', { id: 'n1', title: 'Again' });
    expect(seen).toHaveLength(1);
    const stopLast = session.watchNote('n3', () => undefined);
    stopLast();
    expect(fake.emitted.filter((e) => e.event === 'note:leave').map((e) => e.args[0])).toEqual([{ note_id: 'n3' }]);
  });

  it('passes chat events to listeners and ignores malformed ones', () => {
    const { fake, session } = open();
    const seen: ChatEventEnvelope[] = [];
    const unsubscribe = session.onChatEvent((event) => seen.push(event));

    fake.fire('events', { chat_id: 'c1', message_id: 'm1', data: { type: 'status', data: { done: false } } });
    fake.fire('events', { nonsense: true });
    unsubscribe();
    fake.fire('events', { chat_id: 'c1', data: { type: 'chat:title', data: 'Hi' } });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.data.type).toBe('status');
  });

  it('hands the server reply callback to listeners when one is sent', () => {
    const { fake, session } = open();
    const replies: unknown[] = [];
    session.onChatEvent((_event, reply) => reply?.(true));
    fake.fire('events', { chat_id: 'c', message_id: 'm', data: { type: 'confirmation', data: {} } }, (answer: unknown) => replies.push(answer));
    fake.fire('events', { chat_id: 'c', message_id: 'm', data: { type: 'status', data: {} } });
    expect(replies).toEqual([true]);
  });

  it('close() rejects a pending join and stops everything', async () => {
    const { fake, session } = open();
    session.close();
    await expect(session.joined).rejects.toThrow('closed');
    expect(fake.disconnected).toBe(true);
    session.close();
  });
});
