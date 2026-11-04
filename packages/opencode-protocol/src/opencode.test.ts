import { describe, expect, it, vi } from 'vitest';
import { createSession, pairDevice, parseModelRef, parsePairingLink, pickableAgents, sendPrompt, setDefaultModel } from './api';
import { parseEvent, readEvents, SseParser } from './events';
import { OcClient, OcHttpError } from './http';
import { applyEvent, emptyLive, errorText, isWorking, liveFromHistory, type SessionLive } from './live';
import type { OcEvent } from './types';

const ev = (type: string, properties: Record<string, unknown>): OcEvent => ({ type, properties });

describe('event stream', () => {
  it('splits a stream into events, across chunks and line endings', () => {
    const parser = new SseParser();
    expect(parser.push('data: {"type":"a","prop')).toEqual([]);
    expect(parser.push('erties":{}}\r\n\r\n: comment\n\ndata: line1\ndata: line2\n\n')).toEqual(['{"type":"a","properties":{}}', 'line1\nline2']);
  });

  it('reads events from a stream body, unwrapping global ones', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"server.connected","properties":{}}\n\n'));
        controller.enqueue(new TextEncoder().encode('data: {"directory":"/x","payload":{"type":"session.idle","properties":{"sessionID":"s"}}}\n\ndata: not json\n\n'));
        controller.close();
      },
    });
    const seen: OcEvent[] = [];
    await readEvents(stream, (event) => seen.push(event));
    expect(seen).toEqual([ev('server.connected', {}), ev('session.idle', { sessionID: 's' })]);
    expect(parseEvent('{"no":"type"}')).toBeNull();
  });
});

const user = { id: 'msg_01', sessionID: 's1', role: 'user' as const, time: { created: 1 } };
const assistant = { id: 'msg_02', sessionID: 's1', role: 'assistant' as const, time: { created: 2 } };

describe('a live session', () => {
  it('streams a reply: message, text part, deltas, tool, finish', () => {
    let live: SessionLive = liveFromHistory('s1', [{ info: user, parts: [{ id: 'prt_1', sessionID: 's1', messageID: 'msg_01', type: 'text', text: 'Fix the bug' }] }]);
    live = applyEvent(live, ev('session.status', { sessionID: 's1', status: { type: 'busy' } }));
    expect(isWorking(live)).toBe(true);
    live = applyEvent(live, ev('message.updated', { sessionID: 's1', info: assistant }));
    live = applyEvent(live, ev('message.part.updated', { sessionID: 's1', part: { id: 'prt_3', sessionID: 's1', messageID: 'msg_02', type: 'text', text: '' }, time: 3 }));
    live = applyEvent(live, ev('message.part.delta', { sessionID: 's1', messageID: 'msg_02', partID: 'prt_3', field: 'text', delta: 'Looking ' }));
    live = applyEvent(live, ev('message.part.delta', { sessionID: 's1', messageID: 'msg_02', partID: 'prt_3', field: 'text', delta: 'now.' }));
    // A part with an earlier id sorts before it.
    live = applyEvent(live, ev('message.part.updated', { sessionID: 's1', part: { id: 'prt_2', sessionID: 's1', messageID: 'msg_02', type: 'tool', callID: 'c', tool: 'bash', state: { status: 'running', input: { command: 'ls' }, time: { start: 1 } } } }));
    live = applyEvent(live, ev('session.idle', { sessionID: 's1' }));
    expect(isWorking(live)).toBe(false);
    expect(live.messages.map((entry) => entry.info.id)).toEqual(['msg_01', 'msg_02']);
    expect(live.messages[1]?.parts.map((part) => [part.id, part.type])).toEqual([
      ['prt_2', 'tool'],
      ['prt_3', 'text'],
    ]);
    expect((live.messages[1]?.parts[1] as { text: string }).text).toBe('Looking now.');
  });

  it('ignores other sessions, holds parts that come before their message, and removes', () => {
    const start = emptyLive('s1');
    expect(applyEvent(start, ev('session.idle', { sessionID: 'other' }))).toBe(start);
    let live = applyEvent(start, ev('message.part.updated', { sessionID: 's1', part: { id: 'prt_1', sessionID: 's1', messageID: 'msg_09', type: 'text', text: 'x' } }));
    expect(live.messages).toHaveLength(1);
    live = applyEvent(live, ev('message.updated', { sessionID: 's1', info: { ...assistant, id: 'msg_09' } }));
    expect(live.messages).toHaveLength(1);
    expect(live.messages[0]?.info.time.created).toBe(2);
    expect(live.messages[0]?.parts).toHaveLength(1);
    live = applyEvent(live, ev('message.part.removed', { sessionID: 's1', messageID: 'msg_09', partID: 'prt_1' }));
    expect(live.messages[0]?.parts).toEqual([]);
    live = applyEvent(live, ev('message.removed', { sessionID: 's1', messageID: 'msg_09' }));
    expect(live.messages).toEqual([]);
    // A delta for a part not seen yet changes nothing (its full update will come).
    expect(applyEvent(live, ev('message.part.delta', { sessionID: 's1', messageID: 'm', partID: 'p', field: 'text', delta: 'x' }))).toBe(live);
  });

  it('tracks approvals, questions, todos and errors', () => {
    let live = emptyLive('s1');
    live = applyEvent(live, ev('permission.asked', { id: 'per_1', sessionID: 's1', permission: 'bash', patterns: ['rm -rf build'], metadata: {}, always: ['rm *'] }));
    live = applyEvent(live, ev('question.asked', { id: 'que_1', sessionID: 's1', questions: [{ question: 'Which?', header: 'Pick', options: [] }] }));
    live = applyEvent(live, ev('todo.updated', { sessionID: 's1', todos: [{ content: 'Write tests', status: 'pending', priority: 'high' }] }));
    expect([live.permissions.length, live.questions.length, live.todos.length]).toEqual([1, 1, 1]);
    live = applyEvent(live, ev('permission.replied', { sessionID: 's1', requestID: 'per_1', reply: 'once' }));
    live = applyEvent(live, ev('question.rejected', { sessionID: 's1', requestID: 'que_1' }));
    expect([live.permissions.length, live.questions.length]).toEqual([0, 0]);
    live = applyEvent(live, ev('session.error', { sessionID: 's1', error: { name: 'APIError', data: { message: 'Rate limited' } } }));
    expect(live.error).toBe('Rate limited');
    live = applyEvent(live, ev('session.status', { sessionID: 's1', status: { type: 'busy' } }));
    expect(live.error).toBeNull();
    expect(errorText({ name: 'MessageAbortedError' })).toBe('Stopped.');
  });
});

describe('client', () => {
  it('signs requests with the device token and goes through the login’s path', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'ses_1' }), { status: 200 }));
    const client = new OcClient({ gatewayUrl: 'https://code.example.com/', token: 'tok', login: 'root', fetch });
    await createSession(client, '/home/dev/app', { title: 'x' }, false);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://code.example.com/v1/oc/root/session?directory=${encodeURIComponent('/home/dev/app')}`);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect((init.headers as Record<string, string>)['x-maviechat-approvals']).toBe('off');
    const empty = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(sendPrompt(new OcClient({ gatewayUrl: 'https://g', token: 't', login: 'root', fetch: empty }), '/d', 'ses_1', { text: 'hi', files: [{ mime: 'image/png', filename: 'a.png', url: 'data:x' }] })).resolves.toBeUndefined();
    expect(JSON.parse(String((empty.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({
      parts: [
        { type: 'text', text: 'hi' },
        { type: 'file', mime: 'image/png', filename: 'a.png', url: 'data:x' },
      ],
    });
  });

  it('turns error answers into errors that say what happened', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'This phone is not paired' }), { status: 401 }));
    const client = new OcClient({ gatewayUrl: 'https://g', token: 't', login: 'root', fetch });
    const failure = await createSession(client, '/d', {}).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OcHttpError);
    expect((failure as OcHttpError).isUnpaired).toBe(true);
    expect((failure as OcHttpError).detail).toBe('This phone is not paired');
  });

  it('reads pairing links and pairs', async () => {
    expect(parsePairingLink(' maviechat://pair?url=https%3A%2F%2Fcode.example.com%2F&code=abc ')).toEqual({ url: 'https://code.example.com', code: 'abc' });
    expect(parsePairingLink('maviechat://pair?url=http%3A%2F%2Finsecure&code=abc')).toBeNull();
    expect(parsePairingLink('https://example.com')).toBeNull();
    const fetch = vi.fn(async () => new Response(JSON.stringify({ deviceId: 'd1', token: 'tok', machine: { name: 'Dev box', url: 'https://code.example.com' } }), { status: 200 }));
    await expect(pairDevice(fetch, 'https://code.example.com/', 'abc', 'iPhone')).resolves.toMatchObject({ token: 'tok', machine: { name: 'Dev box' } });
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe('https://code.example.com/v1/pair');
  });

  it('offers only primary, visible agents', () => {
    expect(
      pickableAgents([
        { name: 'build', mode: 'primary' },
        { name: 'plan', mode: 'all' },
        { name: 'general', mode: 'subagent' },
        { name: 'title', mode: 'primary', hidden: true },
      ]).map((agent) => agent.name),
    ).toEqual(['build', 'plan']);
  });
});

describe('model names', () => {
  it('splits provider/model at the first slash', () => {
    expect(parseModelRef('opencode-go/glm-5.2')).toEqual({ providerID: 'opencode-go', modelID: 'glm-5.2' });
    expect(parseModelRef('openrouter/anthropic/claude-x')).toEqual({ providerID: 'openrouter', modelID: 'anthropic/claude-x' });
    for (const ref of [null, undefined, '', 'glm', '/glm', 'opencode-go/', 42]) expect(parseModelRef(ref)).toBeNull();
  });
});

describe('the default model', () => {
  it('is set with only the model name in the body', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ model: 'opencode-go/deepseek-v4.1-flash' }), { status: 200 }));
    const client = new OcClient({ gatewayUrl: 'https://g', token: 't', login: 'root', fetch });
    await expect(setDefaultModel(client, { providerID: 'opencode-go', modelID: 'deepseek-v4.1-flash' })).resolves.toEqual({ providerID: 'opencode-go', modelID: 'deepseek-v4.1-flash' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://g/v1/oc/root/global/config');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ model: 'opencode-go/deepseek-v4.1-flash' });
  });
});
