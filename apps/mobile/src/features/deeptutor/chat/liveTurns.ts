import { applyTurnEvent, emptyReply, type DtReply, type DtStreamEvent } from '@maviechat/deeptutor-protocol';

/** A turn the app shows as it streams. */
export interface LiveTurn {
  sessionId: string;
  /** "" until the server names the turn. */
  turnId: string;
  /** Your message, shown until the saved session has it. Null for a regenerate or a turn started elsewhere. */
  prompt: string | null;
  reply: DtReply;
}

/**
 * Live turns by session id. Screens read them with `useSyncExternalStore`; updates reach them
 * at most once a frame, since a reply streams a few dozen chunks a second.
 */
export class LiveTurns {
  private readonly turns = new Map<string, LiveTurn>();
  private readonly listeners = new Set<() => void>();
  private scheduled = false;
  private readonly schedule: (run: () => void) => void;

  constructor(schedule: (run: () => void) => void = (run) => requestAnimationFrame(run)) {
    this.schedule = schedule;
  }

  get(sessionId: string): LiveTurn | undefined {
    return this.turns.get(sessionId);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Shows a message being sent in a known session, before the server has answered. */
  begin(sessionId: string, prompt: string): void {
    this.turns.set(sessionId, { sessionId, turnId: '', prompt, reply: emptyReply(sessionId) });
    this.notify();
  }

  /** Shows a regenerate starting: the new reply will take the last one's place. */
  beginRegenerate(sessionId: string): void {
    this.turns.set(sessionId, { sessionId, turnId: '', prompt: null, reply: emptyReply(sessionId) });
    this.notify();
  }

  setPrompt(sessionId: string, prompt: string): void {
    const turn = this.turns.get(sessionId);
    if (!turn || turn.prompt === prompt) return;
    this.turns.set(sessionId, { ...turn, prompt });
    this.notify();
  }

  /** Applies a turn event; a new turn in the session (a regenerate) takes the old one's place. */
  apply(event: DtStreamEvent): LiveTurn | undefined {
    const sessionId = event.session_id;
    if (!sessionId || !event.turn_id) return undefined;
    const current = this.turns.get(sessionId);
    let turn: LiveTurn;
    if (current && (current.turnId === event.turn_id || current.turnId === '')) {
      turn = { ...current, turnId: event.turn_id, reply: applyTurnEvent(current.turnId ? current.reply : { ...current.reply, turnId: event.turn_id }, event) };
    } else {
      turn = { sessionId, turnId: event.turn_id, prompt: null, reply: applyTurnEvent(emptyReply(sessionId, event.turn_id), event) };
    }
    if (turn.reply === current?.reply && turn.turnId === current.turnId) return current;
    this.turns.set(sessionId, turn);
    this.notify();
    return turn;
  }

  /** Says what a turn that hasn't started yet is waiting for. */
  setActivity(sessionId: string, activity: string): void {
    const turn = this.turns.get(sessionId);
    if (!turn || turn.reply.activity === activity) return;
    this.turns.set(sessionId, { ...turn, reply: { ...turn.reply, activity } });
    this.notify();
  }

  /** A send the server refused, or a turn that couldn't be followed: shown as failed. */
  fail(sessionId: string, message: string): void {
    const turn = this.turns.get(sessionId);
    if (!turn) return;
    this.turns.set(sessionId, { ...turn, reply: { ...turn.reply, status: 'failed', error: message, activity: null } });
    this.notify();
  }

  /** Drops a turn once the saved session shows it (only if no newer turn took its place). */
  remove(sessionId: string, turnId?: string): void {
    const turn = this.turns.get(sessionId);
    if (!turn || (turnId !== undefined && turn.turnId !== turnId)) return;
    this.turns.delete(sessionId);
    this.notify();
  }

  clear(): void {
    this.turns.clear();
    this.notify();
  }

  private notify(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      for (const listener of this.listeners) listener();
    });
  }
}
