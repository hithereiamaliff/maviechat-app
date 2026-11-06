import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPushToken, sendPushes, type PushMessage } from './push.ts';
import { parseGlobalEvent, readGlobalEvents, Watcher, type GlobalEvent } from './watch.ts';

const login = { id: 'root', name: 'OpenCode', url: 'http://opencode.test', username: 'opencode', password: 'pw' };
const tokenA = 'ExponentPushToken[aaaaAAAA1111]';
const tokenB = 'ExponentPushToken[bbbbBBBB2222]';
const ev = (type: string, properties: Record<string, unknown>): GlobalEvent => ({ directory: '/home/dev/work/app', payload: { type, properties } });
const status = (sessionID: string, type: string) => ev('session.status', { sessionID, status: { type } });

let stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
});

function setup() {
  let time = 1_000_000;
  const sent: PushMessage[] = [];
  const gone: string[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    // The event stream stays open until the watcher stops (the tests hand events over themselves).
    if (url.endsWith('/global/event')) return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('stopped'))));
    return new Response(JSON.stringify({ title: url.includes('/session/ses_1?') ? 'Fix the login bug' : 'Other work' }), { status: 200 });
  });
  const watcher = new Watcher({
    machineUrl: 'https://code.example.com',
    logins: [login],
    fetch,
    log: () => undefined,
    now: () => time,
    send: async (messages) => {
      sent.push(...messages);
      return { gone: [...gone] };
    },
  });
  stops.push(() => watcher.stop());
  const watch = (sessionId: string, deviceId = 'dev1', pushToken = tokenA) => watcher.watch({ deviceId, pushToken, loginId: 'root', sessionId, directory: '/home/dev/work/app' });
  return { watcher, sent, gone, fetch, watch, advance: (ms: number) => (time += ms) };
}

/** Lets pending notifications (title lookup, then sending) go out. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('notifications for sessions started from a phone', () => {
  it('says once when a watched session finishes, with what the app needs to open it', async () => {
    const { watcher, sent, watch } = setup();
    watch('ses_1');
    watcher.handle('root', status('ses_1', 'busy'));
    watcher.handle('root', status('ses_1', 'idle'));
    watcher.handle('root', ev('session.idle', { sessionID: 'ses_1' }));
    await settle();
    expect(sent).toEqual([
      {
        to: tokenA,
        title: 'OpenCode finished',
        body: 'Fix the login bug · app',
        data: { kind: 'opencode', machine: 'https://code.example.com', login: 'root', sessionId: 'ses_1', directory: '/home/dev/work/app' },
        threadId: 'ses_1',
      },
    ]);
    expect(watcher.size).toBe(0);
  });

  it('stays quiet for a reply you stopped, and says so when one fails', async () => {
    const { watcher, sent, watch } = setup();
    watch('ses_1');
    watcher.handle('root', status('ses_1', 'busy'));
    watcher.handle('root', ev('session.error', { sessionID: 'ses_1', error: { name: 'MessageAbortedError' } }));
    watcher.handle('root', status('ses_1', 'idle'));
    await settle();
    expect(sent).toEqual([]);
    watch('ses_1');
    watcher.handle('root', status('ses_1', 'busy'));
    watcher.handle('root', ev('session.error', { sessionID: 'ses_1', error: { name: 'APIError' } }));
    watcher.handle('root', status('ses_1', 'idle'));
    await settle();
    expect(sent.map((message) => message.title)).toEqual(['OpenCode couldn’t finish']);
  });

  it('takes no idle report from before the prompt got going as its end', async () => {
    const { watcher, sent, watch, advance } = setup();
    watch('ses_1');
    watcher.handle('root', status('ses_1', 'idle'));
    await settle();
    expect(sent).toEqual([]);
    expect(watcher.size).toBe(1);
    advance(5000);
    watcher.handle('root', status('ses_1', 'idle'));
    await settle();
    expect(sent.map((message) => message.title)).toEqual(['OpenCode finished']);
  });

  it('asks once for each approval or question, also a subagent’s, and keeps watching', async () => {
    const { watcher, sent, watch } = setup();
    watch('ses_1');
    watcher.handle('root', ev('session.created', { info: { id: 'ses_sub', parentID: 'ses_1' } }));
    watcher.handle('root', ev('permission.asked', { id: 'per_1', sessionID: 'ses_sub', permission: 'bash', patterns: ['npm test'] }));
    watcher.handle('root', ev('permission.asked', { id: 'per_1', sessionID: 'ses_sub', permission: 'bash', patterns: ['npm test'] }));
    watcher.handle('root', ev('question.asked', { id: 'que_1', sessionID: 'ses_1', questions: [] }));
    await settle();
    expect(sent.map((message) => [message.title, message.body, message.data.sessionId])).toEqual([
      ['OpenCode needs your approval', 'Fix the login bug: wants to run a command', 'ses_1'],
      ['OpenCode has a question', 'Fix the login bug · app', 'ses_1'],
    ]);
    // The command itself never goes into a notification.
    expect(JSON.stringify(sent)).not.toContain('npm test');
    expect(watcher.size).toBe(1);
  });

  it('leaves other logins, unpaired phones and removed apps alone', async () => {
    const { watcher, sent, gone, watch } = setup();
    watch('ses_1', 'dev1', tokenA);
    watch('ses_2', 'dev2', tokenB);
    watcher.handle('elsewhere', ev('permission.asked', { id: 'per_9', sessionID: 'ses_1', permission: 'edit' }));
    watcher.forgetDevice('dev1');
    expect(watcher.size).toBe(1);
    gone.push(tokenB);
    watcher.handle('root', ev('permission.asked', { id: 'per_2', sessionID: 'ses_2', permission: 'edit' }));
    await settle();
    expect(sent.map((message) => message.to)).toEqual([tokenB]);
    // Expo said that phone no longer has the app: its watches end.
    expect(watcher.size).toBe(0);
  });

  it('undoes a watch for a prompt OpenCode didn’t take, and ignores unknown logins', () => {
    const { watcher, watch } = setup();
    const undo = watch('ses_1');
    expect(watcher.size).toBe(1);
    undo();
    expect(watcher.size).toBe(0);
    watcher.watch({ deviceId: 'dev1', pushToken: tokenA, loginId: 'nobody', sessionId: 'ses_1', directory: '/x' });
    expect(watcher.size).toBe(0);
  });
});

describe('OpenCode’s global event stream', () => {
  it('keeps only the kinds the watcher acts on, in either shape', () => {
    expect(parseGlobalEvent('data: {"directory":"/a","payload":{"type":"session.idle","properties":{"sessionID":"s"}}}')).toEqual({ directory: '/a', payload: { type: 'session.idle', properties: { sessionID: 's' } } });
    expect(parseGlobalEvent('data: {"type":"permission.asked","properties":{"id":"p"}}')?.payload.type).toBe('permission.asked');
    expect(parseGlobalEvent('data: {"directory":"/a","payload":{"type":"message.part.delta","properties":{}}}')).toBeNull();
    expect(parseGlobalEvent('data: {"type":"session.idle", oops')).toBeNull();
    expect(parseGlobalEvent(': heartbeat')).toBeNull();
  });

  it('reads events split across chunks', async () => {
    const encoder = new TextEncoder();
    const chunks = ['data: {"payload":{"type":"session.st', 'atus","properties":{"sessionID":"s","status":{"type":"busy"}}}}\n', '\ndata: {"payload":{"type":"message.part.delta","properties":{}}}\n\n'];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const events: GlobalEvent[] = [];
    await readGlobalEvents(body, (event) => events.push(event));
    expect(events.map((event) => event.payload.type)).toEqual(['session.status']);
  });
});

describe('sending through Expo', () => {
  it('knows a push token when it sees one', () => {
    expect(isPushToken(tokenA)).toBe(true);
    expect(isPushToken('ExpoPushToken[x-y_z]')).toBe(true);
    for (const value of ['', 'ExponentPushToken[]', 'ExponentPushToken[a b]', 'token', 42, undefined]) expect(isPushToken(value)).toBe(false);
  });

  it('sends with sound and high priority, and reports phones Expo says are gone', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ status: 'ok', id: 'x' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }] }), { status: 200 }));
    const messages = [tokenA, tokenB].map((to) => ({ to, title: 't', body: 'b', data: {} }));
    await expect(sendPushes(fetch, messages)).resolves.toEqual({ gone: [tokenB] });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://exp.host/--/api/v2/push/send');
    expect(JSON.parse(String(init.body))[0]).toEqual({ to: tokenA, title: 't', body: 'b', data: {}, sound: 'default', priority: 'high' });
    await expect(sendPushes(async () => new Response('', { status: 503 }), messages)).rejects.toThrow('503');
  });
});
