import type { DtStreamEvent } from '@maviechat/deeptutor-protocol';
import { describe, expect, it } from 'vitest';
import { LiveTurns } from './liveTurns';

const event = (type: DtStreamEvent['type'], turn: string, seq: number, content = ''): DtStreamEvent => ({
  type,
  content,
  metadata: type === 'content' ? { call_id: 'r1', call_kind: 'agent_loop_round' } : {},
  source: 'chat',
  stage: 'responding',
  session_id: 's1',
  turn_id: turn,
  seq,
  timestamp: 1,
});

function setup() {
  const runs: (() => void)[] = [];
  const turns = new LiveTurns((run) => runs.push(run));
  let notified = 0;
  turns.subscribe(() => (notified += 1));
  const flush = () => runs.splice(0).forEach((run) => run());
  return { turns, flush, notified: () => notified };
}

describe('live DeepTutor turns', () => {
  it('keeps your message while the server names the turn, and builds the reply', () => {
    const { turns } = setup();
    turns.begin('s1', 'Hello');
    turns.apply(event('session', 't1', 1));
    turns.apply(event('content', 't1', 2, 'Hi'));
    expect(turns.get('s1')).toMatchObject({ turnId: 't1', prompt: 'Hello', reply: { answer: 'Hi', status: 'running' } });
  });

  it('lets a newer turn (a regenerate) take the place of the old one', () => {
    const { turns } = setup();
    turns.apply(event('session', 't1', 1));
    turns.apply(event('done', 't1', 2));
    turns.beginRegenerate('s1');
    expect(turns.get('s1')).toMatchObject({ turnId: '', prompt: null });
    turns.apply(event('session', 't2', 1));
    expect(turns.get('s1')).toMatchObject({ turnId: 't2', reply: { status: 'running' } });
    turns.apply(event('session', 't3', 1));
    expect(turns.get('s1')?.turnId).toBe('t3');
  });

  it('removes only the turn the saved session has caught up with', () => {
    const { turns } = setup();
    turns.apply(event('session', 't1', 1));
    turns.remove('s1', 't0');
    expect(turns.get('s1')).toBeDefined();
    turns.remove('s1', 't1');
    expect(turns.get('s1')).toBeUndefined();
  });

  it("never starts a reply from a turn's end or the chat's new title", () => {
    const { turns } = setup();
    // The reply already finished and was let go; DeepTutor's late title event, or a repeated end, comes in.
    expect(turns.apply(event('session_meta', 't1', 22))).toBeUndefined();
    expect(turns.apply(event('done', 't1', 23))).toBeUndefined();
    expect(turns.get('s1')).toBeUndefined();
    // For the reply that is showing, both still apply.
    turns.begin('s1', 'Hello');
    turns.apply(event('session', 't2', 1));
    expect(turns.apply(event('done', 't2', 2))?.reply.status).toBe('completed');
  });

  it('tells screens at most once a frame', () => {
    const { turns, flush, notified } = setup();
    turns.begin('s1', 'Hello');
    turns.apply(event('session', 't1', 1));
    turns.apply(event('content', 't1', 2, 'A'));
    turns.setActivity('s1', 'Waiting');
    expect(notified()).toBe(0);
    flush();
    expect(notified()).toBe(1);
    turns.apply(event('content', 't1', 2, 'A'));
    flush();
    expect(notified()).toBe(1);
  });
});
