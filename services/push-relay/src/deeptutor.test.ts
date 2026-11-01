import { describe, expect, it, vi } from 'vitest';
import { describeResult, TurnWatcher, type WatchSocketHandlers } from './deeptutor.ts';
import type { PushMessage } from './notification.ts';
import { createRelay } from './relay.ts';
import { DeviceStore } from './store.ts';

const phone = 'ExponentPushToken[abc123]';

function setup(limits: { maxPerPhone?: number } = {}) {
  const sockets: { url: string; cookie: string; handlers: WatchSocketHandlers; sent: Record<string, unknown>[]; closed: boolean }[] = [];
  const timers: { run: () => void; ms: number }[] = [];
  const pushed: PushMessage[] = [];
  const watcher = new TurnWatcher({
    url: 'http://deeptutor:3782/',
    connect: (url, cookie, handlers) => {
      const socket = { url, cookie, handlers, sent: [] as Record<string, unknown>[], closed: false };
      sockets.push(socket);
      return { send: (data) => socket.sent.push(JSON.parse(data) as Record<string, unknown>), close: () => (socket.closed = true) };
    },
    send: async (messages) => {
      pushed.push(...messages);
      return messages.length;
    },
    timers: {
      set: (run, ms) => {
        const timer = { run, ms };
        timers.push(timer);
        return timer;
      },
      clear: (handle) => {
        const index = timers.indexOf(handle as (typeof timers)[number]);
        if (index >= 0) timers.splice(index, 1);
      },
    },
    ...limits,
  });
  const latest = () => sockets[sockets.length - 1]!;
  const event = (type: string, seq: number, metadata: Record<string, unknown> = {}, turn = 'turn_1') =>
    latest().handlers.onMessage(JSON.stringify({ type, seq, turn_id: turn, session_id: 'unified_1', content: '', metadata, protocol_version: '2.0' }));
  return { watcher, sockets, timers, pushed, latest, event };
}

const request = { pushToken: phone, sessionId: 'unified_1', turnId: 'turn_1', title: 'Photosynthesis', token: 'tok.en' };

describe('watching a DeepTutor turn', () => {
  it('follows the turn inside the server and notifies when it ends', async () => {
    const { watcher, latest, event, pushed } = setup();
    expect(watcher.watch(request)).toBe('watching');
    expect(watcher.watch(request)).toBe('already');
    expect(latest().url).toBe('ws://deeptutor:3782/ws');
    expect(latest().cookie).toBe('maviechat=1; dt_token=tok.en');
    latest().handlers.onOpen();
    expect(latest().sent).toEqual([{ protocol_version: '2.0', type: 'resume_from', turn_id: 'turn_1', seq: 0 }]);
    event('result', 5, { summary: { results: [{}, {}] } });
    event('done', 6, { status: 'completed' });
    await Promise.resolve();
    expect(pushed).toEqual([
      {
        to: phone,
        title: 'DeepTutor reply ready: Photosynthesis',
        body: 'Your quiz is ready: 2 questions.',
        data: { kind: 'deeptutor.finished', sessionId: 'unified_1' },
        sound: 'default',
        priority: 'high',
        threadId: 'unified_1',
      },
    ]);
    expect(watcher.size).toBe(0);
    expect(latest().closed).toBe(true);
  });

  it('tells you once when DeepTutor asks a question, and nothing when you stop it', async () => {
    const { watcher, latest, event, pushed } = setup();
    watcher.watch(request);
    latest().handlers.onOpen();
    const ask = { tool_metadata: { ask_user: { intro: 'A few details', questions: [{ id: 'goal', prompt: 'What are you studying for?' }] } } };
    event('tool_result', 3, ask);
    event('tool_result', 3, ask);
    event('tool_result', 4, ask);
    event('done', 9, { status: 'cancelled' });
    await Promise.resolve();
    expect(pushed.map((message) => [message.title, message.body, message.data.kind])).toEqual([
      ['DeepTutor has a question: Photosynthesis', 'What are you studying for?', 'deeptutor.question'],
    ]);
    expect(watcher.size).toBe(0);
  });

  it('picks up where it was after a drop, and gives up on a turn it may not follow', () => {
    const { watcher, sockets, latest, event, timers } = setup();
    watcher.watch(request);
    latest().handlers.onOpen();
    event('content', 7);
    latest().handlers.onClose();
    const retry = timers.find((timer) => timer.ms < 60_000)!;
    timers.splice(timers.indexOf(retry), 1);
    retry.run();
    expect(sockets).toHaveLength(2);
    latest().handlers.onOpen();
    expect(latest().sent).toEqual([{ protocol_version: '2.0', type: 'resume_from', turn_id: 'turn_1', seq: 7 }]);
    latest().handlers.onMessage(JSON.stringify({ type: 'protocol_error', error_code: 'subscription_failed', retryable: false }));
    expect(watcher.size).toBe(0);
  });

  it('keeps each phone to a few watches at once', () => {
    const { watcher } = setup({ maxPerPhone: 1 });
    expect(watcher.watch(request)).toBe('watching');
    expect(watcher.watch({ ...request, turnId: 'turn_2' })).toBe('full');
  });

  it('describes each mode in a line', () => {
    expect(describeResult({ outline_preview: true })).toMatch(/research plan/);
    expect(describeResult({ render_type: 'chartjs' })).toMatch(/visualization/);
    expect(describeResult({ response: '# Water\n\nIt **moves**.' })).toBe('Water It moves.');
    expect(describeResult(null)).toBe('Open the chat to read it.');
  });
});

describe('the watch endpoint', () => {
  function relay(deeptutor = true) {
    const store = new DeviceStore(null);
    const watcher = new TurnWatcher({ url: 'http://deeptutor:3782', connect: () => ({ send: () => undefined, close: () => undefined }), send: async () => 0 });
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>).Authorization;
      return new Response(JSON.stringify({ authenticated: url.endsWith('/api/auth/status') && auth === 'Bearer good' }), { status: 200 });
    });
    const handle = createRelay(
      { eventsSecret: 'a'.repeat(40), owuiUrl: 'https://chat.example.com', deeptutor: deeptutor ? { url: 'http://deeptutor:3782', publicUrl: 'https://learn.example.com', watcher } : undefined },
      store,
      fetch,
    );
    const call = (body: unknown, authorization?: string) => handle({ method: 'POST', path: '/v1/deeptutor/watch', body: JSON.stringify(body), authorization, ip: '203.0.113.9' });
    return { call, watcher };
  }
  const body = { pushToken: phone, sessionId: 'unified_1', turnId: 'turn_1', title: '  Water   cycle ', server: 'https://learn.example.com/' };

  it('watches for a sign-in that works on the DeepTutor it serves', async () => {
    const { call, watcher } = relay();
    expect((await call(body)).status).toBe(401);
    expect((await call(body, 'Bearer bad')).status).toBe(401);
    expect((await call({ ...body, turnId: 'no spaces allowed' }, 'Bearer good')).status).toBe(400);
    expect((await call({ ...body, server: 'https://other.example.com' }, 'Bearer good')).status).toBe(404);
    expect(await call(body, 'Bearer good')).toEqual({ status: 202, body: { watching: true } });
    expect(watcher.size).toBe(1);
    watcher.stopAll();
  });

  it('is off when the relay serves no DeepTutor', async () => {
    expect((await relay(false).call(body, 'Bearer good')).status).toBe(404);
  });
});
