import { describe, expect, it } from 'vitest';
import { DtPartnerChat, type DtPartnerChatState, type DtPartnerTurn } from './partnerChat';
import type { DtSocketHandlers } from './turnConnection';

interface FakeSocket {
  url: string;
  handlers: DtSocketHandlers;
  sent: Record<string, unknown>[];
  closed: boolean;
}

function setup() {
  const sockets: FakeSocket[] = [];
  const timers: { run: () => void; ms: number; id: number }[] = [];
  let nextTimer = 0;
  const states: DtPartnerChatState[] = [];
  const turns: (DtPartnerTurn | null)[] = [];
  const ended: DtPartnerTurn[] = [];
  const refused: { prompt: string; reason: string; message: string }[] = [];
  const said: string[] = [];
  const chat = new DtPartnerChat({
    url: 'wss://learn.example.com/ws/partners/ada',
    connect: (url, handlers) => {
      const socket: FakeSocket = { url, handlers, sent: [], closed: false };
      sockets.push(socket);
      return { send: (data) => socket.sent.push(JSON.parse(data) as Record<string, unknown>), close: () => (socket.closed = true) };
    },
    timers: {
      set: (run, ms) => {
        nextTimer += 1;
        timers.push({ run, ms, id: nextTimer });
        return nextTimer;
      },
      clear: (id) => {
        const index = timers.findIndex((timer) => timer.id === id);
        if (index >= 0) timers.splice(index, 1);
      },
    },
    onState: (state) => states.push(state),
    onTurn: (turn) => turns.push(turn),
    onEnd: (turn) => ended.push(turn),
    onRefused: (prompt, reason, message) => refused.push({ prompt, reason, message }),
    onProactive: (content) => said.push(content),
  });
  const latest = () => sockets[sockets.length - 1]!;
  const frame = (data: Record<string, unknown>) => latest().handlers.onMessage(JSON.stringify(data));
  const event = (type: string, content: string, metadata: Record<string, unknown> = {}, seq = 1) =>
    frame({ type: 'stream_event', event: { type, content, metadata, source: 'chat', stage: 'responding', session_id: 's', turn_id: 't', seq, timestamp: 1 } });
  const fire = () => {
    const timer = timers.sort((a, b) => a.ms - b.ms)[0];
    if (!timer) throw new Error('no timer');
    timers.splice(timers.indexOf(timer), 1);
    timer.run();
    return timer.ms;
  };
  const live = () => turns[turns.length - 1] ?? null;
  return { chat, sockets, timers, states, turns, ended, refused, said, latest, frame, event, fire, live };
}

describe('partner chat', () => {
  it('waits for ready, follows the conversation, then sends and streams a reply', () => {
    const { chat, latest, frame, event, live, ended, states } = setup();
    chat.open('web-abc12345');
    expect(latest().url).toBe('wss://learn.example.com/ws/partners/ada');
    expect(chat.send('Too early')).toBe(false);
    frame({ type: 'ready' });
    expect(states).toEqual(['connecting', 'ready']);
    expect(latest().sent).toEqual([{ action: 'attach', session_key: 'web-abc12345', include_activity: false }]);
    frame({ type: 'attach_idle', session_key: 'web-abc12345' });
    expect(live()).toBeNull();

    expect(chat.send('Hello Ada')).toBe(true);
    expect(latest().sent[1]).toEqual({ content: 'Hello Ada', session_key: 'web-abc12345' });
    expect(chat.send('Again')).toBe(false);
    frame({ type: 'accepted', session_key: 'web-abc12345' });
    event('thinking', 'Let me think');
    event('content', 'Hi ', {}, 2);
    event('content', 'reasoning words', { call_id: 'c1', call_kind: 'planning' }, 3);
    event('content', 'there!', {}, 4);
    expect(live()).toMatchObject({ prompt: 'Hello Ada', accepted: true, reply: { answer: 'Hi there!', status: 'running' } });
    expect(live()?.reply.thoughts.length).toBeGreaterThan(0);
    event('done', '', {}, 5);
    expect(live()).not.toBeNull();
    frame({ type: 'content', content: 'Hi there! (final)' });
    frame({ type: 'done' });
    expect(live()).toBeNull();
    expect(ended).toHaveLength(1);
    expect(ended[0]?.reply).toMatchObject({ answer: 'Hi there! (final)', status: 'completed' });
  });

  it('sends files with a message, the words optional', () => {
    const { chat, latest, frame, live } = setup();
    chat.open('web-1');
    frame({ type: 'ready' });
    expect(chat.send('   ')).toBe(false);
    expect(chat.send('', [{ type: 'file', filename: 'notes.txt', mimeType: 'text/plain', base64: 'aGk=' }])).toBe(true);
    expect(latest().sent.at(-1)).toEqual({ content: '', session_key: 'web-1', attachments: [{ type: 'file', filename: 'notes.txt', mime_type: 'text/plain', base64: 'aGk=' }] });
    expect(live()).toMatchObject({ prompt: '', files: ['notes.txt'] });
  });

  it('gives the words back when DeepTutor didn’t take the message', () => {
    const { chat, frame, refused, live } = setup();
    chat.open('web-1');
    frame({ type: 'ready' });
    chat.send('One');
    frame({ type: 'turn_busy', content: 'This conversation is already replying.' });
    chat.send('Two');
    frame({ type: 'stale_session', content: 'moved', active_session_key: 'web-2' });
    chat.send('Three');
    frame({ type: 'error', content: 'Attachment too large' });
    expect(refused.map((item) => [item.prompt, item.reason])).toEqual([
      ['One', 'busy'],
      ['Two', 'moved'],
      ['Three', 'error'],
    ]);
    expect(live()).toBeNull();
  });

  it('keeps a failure after the message was stored as the reply’s error', () => {
    const { chat, frame, ended, refused } = setup();
    chat.open('web-1');
    frame({ type: 'ready' });
    chat.send('Hi');
    frame({ type: 'accepted', session_key: 'web-1' });
    frame({ type: 'error', content: 'The model failed' });
    frame({ type: 'done' });
    expect(refused).toHaveLength(0);
    expect(ended[0]?.reply).toMatchObject({ error: 'The model failed', status: 'failed' });
  });

  it('stops a reply, keeping what was written', () => {
    const { chat, latest, frame, event, ended } = setup();
    chat.open('web-1');
    frame({ type: 'ready' });
    chat.send('Count to a hundred');
    frame({ type: 'accepted', session_key: 'web-1' });
    event('content', '1, 2, 3');
    chat.stop();
    expect(latest().sent[2]).toEqual({ action: 'stop', session_key: 'web-1' });
    frame({ type: 'stopped' });
    expect(ended[0]?.reply).toMatchObject({ answer: '1, 2, 3', status: 'cancelled' });
  });

  it('after a dropped socket, reconnects with growing waits and follows the reply again', () => {
    const { chat, sockets, frame, event, fire, live, states, ended } = setup();
    chat.open('web-1');
    frame({ type: 'ready' });
    chat.send('Long question');
    frame({ type: 'accepted', session_key: 'web-1' });
    event('content', 'Part one. ');
    sockets[0]!.handlers.onClose(1006);
    expect(states.at(-1)).toBe('reconnecting');
    expect(fire()).toBe(250);
    sockets[1]!.handlers.onClose(1006);
    expect(fire()).toBe(500);
    expect(sockets).toHaveLength(3);
    frame({ type: 'ready' });
    expect(sockets[2]!.sent).toEqual([{ action: 'attach', session_key: 'web-1', include_activity: false }]);
    frame({ type: 'resuming' });
    frame({ type: 'user_echo', content: 'Long question' });
    event('content', 'Part one. ', {}, 1);
    event('content', 'Part two.', {}, 2);
    expect(live()?.reply.answer).toBe('Part one. Part two.');
    frame({ type: 'content', content: 'Part one. Part two.' });
    frame({ type: 'done' });
    expect(ended[0]).toMatchObject({ prompt: 'Long question', reply: { status: 'completed' } });
  });

  it('sends at once after ready: the answer to the attach doesn’t touch the new message', () => {
    const { chat, frame, refused, ended, live } = setup();
    chat.open('web-1');
    frame({ type: 'ready' });
    chat.send('Quick');
    frame({ type: 'attach_idle', session_key: 'web-1' });
    expect(refused).toHaveLength(0);
    expect(ended).toHaveLength(0);
    expect(live()).toMatchObject({ prompt: 'Quick', accepted: false });
    frame({ type: 'accepted', session_key: 'web-1' });
    frame({ type: 'content', content: 'Done' });
    frame({ type: 'done' });
    expect(ended[0]?.reply.answer).toBe('Done');
  });

  it('when the reply ended while away, ends it so the conversation is read again', () => {
    const { chat, sockets, frame, fire, ended } = setup();
    chat.open('web-1');
    frame({ type: 'ready' });
    chat.send('Hi');
    frame({ type: 'accepted', session_key: 'web-1' });
    sockets[0]!.handlers.onClose(1001);
    fire();
    frame({ type: 'ready' });
    frame({ type: 'attach_idle', session_key: 'web-1' });
    expect(ended).toHaveLength(1);
  });

  it('asks again when the reply runs in another worker, and wakes up at once when the app returns', () => {
    const { chat, sockets, frame, fire, timers } = setup();
    chat.open('web-1');
    frame({ type: 'ready' });
    frame({ type: 'attach_busy', session_key: 'web-1' });
    expect(fire()).toBe(2000);
    expect(sockets[0]!.sent.filter((sent) => sent.action === 'attach')).toHaveLength(2);
    sockets[0]!.handlers.onClose(1006);
    expect(timers).toHaveLength(1);
    chat.wake();
    expect(timers).toHaveLength(0);
    expect(sockets).toHaveLength(2);
  });

  it('stops trying when signed out or the partner is gone, and ignores events after a reply ended', () => {
    const signedOut = setup();
    signedOut.chat.open('web-1');
    signedOut.latest().handlers.onClose(4001);
    expect(signedOut.states.at(-1)).toBe('signed-out');
    expect(signedOut.timers).toHaveLength(0);

    const gone = setup();
    gone.chat.open('web-1');
    gone.frame({ type: 'error', content: 'Partner not found' });
    gone.latest().handlers.onClose(4404);
    expect(gone.states.at(-1)).toBe('unavailable');

    const late = setup();
    late.chat.open('web-1');
    late.frame({ type: 'ready' });
    late.event('session_meta', 'A title');
    expect(late.live()).toBeNull();
    late.frame({ type: 'proactive', content: 'Time to review!' });
    expect(late.said).toEqual(['Time to review!']);
  });

  it('follows another conversation, and leaves out other apps’ activity', () => {
    const { chat, latest, frame, live } = setup();
    chat.open('web-1');
    frame({ type: 'ready' });
    chat.send('Hi');
    chat.open('web-2');
    expect(live()).toBeNull();
    expect(latest().sent.at(-1)).toEqual({ action: 'attach', session_key: 'web-2', include_activity: false });
    frame({ type: 'user_echo', content: 'from Telegram', external: true, session_key: 'telegram_1' });
    expect(live()).toBeNull();
  });
});
