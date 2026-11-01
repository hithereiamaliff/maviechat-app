import { describe, expect, it } from 'vitest';
import { DtSocketAuthError, DtTurnConnection, type DtConnectionState, type DtSocketHandlers } from './turnConnection';
import type { DtStreamEvent } from './turns';

interface FakeSocket {
  handlers: DtSocketHandlers;
  sent: Record<string, unknown>[];
  closed: boolean;
}

function setup() {
  const sockets: FakeSocket[] = [];
  const timers: { run: () => void; ms: number; id: number }[] = [];
  let nextTimer = 0;
  const events: DtStreamEvent[] = [];
  const states: DtConnectionState[] = [];
  const connection = new DtTurnConnection({
    url: 'wss://learn.example.com/ws',
    connect: (_url, handlers) => {
      const socket: FakeSocket = { handlers, sent: [], closed: false };
      sockets.push(socket);
      return { send: (data) => socket.sent.push(JSON.parse(data) as Record<string, unknown>), close: () => (socket.closed = true) };
    },
    onEvent: (event) => events.push(event),
    onState: (state) => states.push(state),
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
    random: () => 0.5,
  });
  const latest = () => sockets[sockets.length - 1]!;
  const frame = (data: Record<string, unknown>) => latest().handlers.onMessage(JSON.stringify({ protocol_version: '2.0', ...data }));
  const turnEvent = (type: string, sequence: number, extra: Record<string, unknown> = {}) =>
    frame({ type, seq: sequence, turn_id: 'turn_1', session_id: 'unified_1', content: '', metadata: {}, timestamp: 1, ...extra });
  /** Runs the earliest timer that isn't the keep-alive ping. */
  const fire = () => {
    const timer = timers.filter((item) => item.ms !== 25_000).sort((a, b) => a.ms - b.ms)[0];
    if (!timer) throw new Error('no timer');
    timers.splice(timers.indexOf(timer), 1);
    timer.run();
  };
  return { connection, sockets, timers, events, states, latest, frame, turnEvent, fire };
}

describe('turn connection', () => {
  it('starts a new chat and learns its session from the first event', async () => {
    const { connection, latest, turnEvent, events } = setup();
    const started = connection.startTurn({ content: 'Hello' });
    latest().handlers.onOpen();
    expect(latest().sent[0]).toMatchObject({ type: 'start_turn', content: 'Hello', capability: 'chat' });
    expect(typeof latest().sent[0]!.client_submission_id).toBe('string');
    turnEvent('session', 1, { metadata: { session_id: 'unified_1', turn_id: 'turn_1' } });
    turnEvent('content', 2, { content: 'Hi' });
    await expect(started).resolves.toEqual({ sessionId: 'unified_1', turnId: 'turn_1' });
    turnEvent('content', 2, { content: 'Hi' });
    expect(events.map((event) => `${event.type}#${event.seq}`)).toEqual(['session#1', 'content#2']);
  });

  it('resumes an unfinished turn after a drop, without repeats', () => {
    const { connection, sockets, latest, turnEvent, events, fire } = setup();
    void connection.startTurn({ content: 'Hello', sessionId: 'unified_1' });
    latest().handlers.onOpen();
    turnEvent('session', 1);
    turnEvent('content', 2, { content: 'A' });
    latest().handlers.onClose(1006);
    expect(connection.connectionState).toBe('reconnecting');
    fire();
    expect(sockets).toHaveLength(2);
    latest().handlers.onOpen();
    expect(latest().sent).toEqual([{ protocol_version: '2.0', type: 'resume_from', turn_id: 'turn_1', seq: 2 }]);
    turnEvent('content', 2, { content: 'A' });
    turnEvent('content', 3, { content: 'B' });
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3]);
  });

  it('asks for a replay when an event goes missing', () => {
    const { connection, latest, turnEvent, events } = setup();
    connection.follow('turn_1', 3);
    latest().handlers.onOpen();
    expect(latest().sent[0]).toMatchObject({ type: 'resume_from', seq: 3 });
    turnEvent('content', 5);
    expect(latest().sent[1]).toMatchObject({ type: 'resume_from', seq: 3 });
    turnEvent('content', 4);
    turnEvent('content', 5);
    expect(events.map((event) => event.seq)).toEqual([4, 5]);
    // A numbering that really skips is taken after one replay.
    turnEvent('content', 7);
    turnEvent('content', 7);
    expect(events.map((event) => event.seq)).toEqual([4, 5, 7]);
  });

  it('sends a start again after a drop, with the same submission id', () => {
    const { connection, latest, fire } = setup();
    void connection.startTurn({ content: 'Hello' });
    latest().handlers.onOpen();
    const first = latest().sent[0]!.client_submission_id;
    latest().handlers.onClose(1006);
    fire();
    latest().handlers.onOpen();
    expect(latest().sent[0]).toMatchObject({ type: 'start_turn', client_submission_id: first });
  });

  it('stays closed once every turn is done, and reconnects on the next command', () => {
    const { connection, sockets, latest, turnEvent, timers } = setup();
    void connection.startTurn({ content: 'Hello' });
    latest().handlers.onOpen();
    turnEvent('session', 1);
    turnEvent('done', 2, { metadata: { status: 'completed' } });
    latest().handlers.onClose(1000);
    expect(connection.connectionState).toBe('idle');
    expect(timers.filter((timer) => timer.ms !== 25_000)).toHaveLength(0);
    connection.regenerate('unified_1');
    expect(sockets).toHaveLength(2);
    latest().handlers.onOpen();
    expect(latest().sent[0]).toEqual({ protocol_version: '2.0', type: 'regenerate', session_id: 'unified_1' });
  });

  it('fails a refused start and resolves cancels from their acknowledgement', async () => {
    const { connection, latest, frame } = setup();
    const refused = connection.startTurn({ content: 'Hello' });
    latest().handlers.onOpen();
    frame({ type: 'protocol_error', error_code: 'start_turn_rejected', message: 'No model', session_id: '' });
    await expect(refused).rejects.toThrow('No model');

    const cancelled = connection.cancel('turn_1');
    const command = latest().sent[latest().sent.length - 1]!;
    expect(command).toMatchObject({ type: 'cancel_turn', turn_id: 'turn_1' });
    frame({ type: 'command_ack', command_id: command.command_id, command_type: 'cancel_turn', accepted: true });
    await expect(cancelled).resolves.toBe(true);
  });

  it('stops for good when the sign-in is refused', async () => {
    const { connection, latest, timers } = setup();
    const started = connection.startTurn({ content: 'Hello' });
    latest().handlers.onClose(4001);
    await expect(started).rejects.toBeInstanceOf(DtSocketAuthError);
    expect(connection.connectionState).toBe('signed-out');
    expect(timers.filter((timer) => timer.ms !== 25_000)).toHaveLength(0);
  });

  it('keeps the socket alive with pings while open', () => {
    const { connection, latest, timers } = setup();
    connection.follow('turn_1');
    latest().handlers.onOpen();
    const ping = timers.find((timer) => timer.ms === 25_000)!;
    timers.splice(timers.indexOf(ping), 1);
    ping.run();
    expect(latest().sent[latest().sent.length - 1]).toEqual({ protocol_version: '2.0', type: 'ping' });
  });
});

describe('turn connection while DeepTutor wraps up the last turn', () => {
  it('sends a start again until the session is free, then resolves', async () => {
    const { connection, latest, frame, turnEvent, fire } = setup();
    const waiting: string[] = [];
    (connection as unknown as { options: { onWaiting?: (id: string) => void } }).options.onWaiting = (id) => waiting.push(id);
    const started = connection.startTurn({ content: 'Next', sessionId: 'unified_1' });
    latest().handlers.onOpen();
    const busy = { type: 'protocol_error', error_code: 'start_turn_rejected', message: 'Session already has an active or recovering turn', session_id: 'unified_1' };
    frame(busy);
    fire();
    frame(busy);
    fire();
    expect(latest().sent.filter((command) => command.type === 'start_turn')).toHaveLength(3);
    expect(new Set(latest().sent.map((command) => command.client_submission_id)).size).toBe(1);
    turnEvent('session', 1);
    await expect(started).resolves.toEqual({ sessionId: 'unified_1', turnId: 'turn_1' });
    expect(waiting).toEqual(['unified_1', 'unified_1']);
  });

  it('gives up after half a minute, and fails other refusals at once', async () => {
    let now = 0;
    const { connection, latest, frame, fire } = setup();
    (connection as unknown as { options: { now?: () => number } }).options.now = () => now;
    const started = connection.startTurn({ content: 'Next', sessionId: 'unified_1' });
    latest().handlers.onOpen();
    const busy = { type: 'protocol_error', error_code: 'start_turn_rejected', message: 'Session already has an active or recovering turn', session_id: 'unified_1' };
    frame(busy);
    fire();
    now = 31_000;
    frame(busy);
    await expect(started).rejects.toThrow('active or recovering');

    const refused = connection.startTurn({ content: 'Again', sessionId: 'unified_1' });
    frame({ type: 'protocol_error', error_code: 'start_turn_rejected', message: 'No model is available', session_id: 'unified_1' });
    await expect(refused).rejects.toThrow('No model');
  });

  it('sends a regenerate again until the session is free', () => {
    const { connection, latest, frame, turnEvent, fire, timers } = setup();
    connection.regenerate('unified_1');
    latest().handlers.onOpen();
    frame({ type: 'protocol_error', error_code: 'regenerate_rejected', message: 'Session already has an active or recovering turn', session_id: 'unified_1' });
    fire();
    expect(latest().sent.filter((command) => command.type === 'regenerate')).toHaveLength(2);
    turnEvent('session', 1);
    expect(timers.filter((timer) => timer.ms === 2000)).toHaveLength(0);
  });
});
