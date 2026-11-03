import { applyTurnEvent, emptyReply, type DtReply, type DtStreamEvent } from '@maviechat/deeptutor-protocol';

/** What your message went with, shown under it until the saved session has it. */
export interface PromptExtras {
  /** Photos as data: URLs; files by name. */
  attachments: { key: string; type: string; filename: string; uri: string | null }[];
  references: { key: string; kind: 'notebook' | 'chat' | 'knowledge'; label: string }[];
}

/** A turn the app shows as it streams. */
export interface LiveTurn {
  sessionId: string;
  /** "" until the server names the turn. */
  turnId: string;
  /** Your message, shown until the saved session has it. Null for a regenerate, a continuation or a turn started elsewhere. */
  prompt: string | null;
  promptExtras?: PromptExtras;
  /** A regenerate: the reply replaces the last one shown. */
  replacesLast: boolean;
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
  begin(sessionId: string, prompt: string, promptExtras?: PromptExtras): void {
    this.turns.set(sessionId, { sessionId, turnId: '', prompt, promptExtras, replacesLast: false, reply: emptyReply(sessionId) });
    this.notify();
  }

  /** Shows a regenerate starting: the new reply will take the last one's place. */
  beginRegenerate(sessionId: string): void {
    this.turns.set(sessionId, { sessionId, turnId: '', prompt: null, replacesLast: true, reply: emptyReply(sessionId) });
    this.notify();
  }

  /** Shows a turn that carries on without a new message (Research after its outline). */
  beginContinuation(sessionId: string): void {
    this.turns.set(sessionId, { sessionId, turnId: '', prompt: null, replacesLast: false, reply: emptyReply(sessionId) });
    this.notify();
  }

  setPrompt(sessionId: string, prompt: string, promptExtras?: PromptExtras): void {
    const turn = this.turns.get(sessionId);
    if (!turn || (turn.prompt === prompt && turn.promptExtras === promptExtras)) return;
    this.turns.set(sessionId, { ...turn, prompt, promptExtras });
    this.notify();
  }

  /**
   * Applies a turn event; a new turn in the session (a regenerate) takes the old one's place.
   * A turn's end (`done`) or the chat's new title (`session_meta`) never starts one: either
   * arriving for a reply that isn't showing would leave an empty "Working…" behind.
   */
  apply(event: DtStreamEvent): LiveTurn | undefined {
    const sessionId = event.session_id;
    if (!sessionId || !event.turn_id) return undefined;
    const current = this.turns.get(sessionId);
    const known = current && (current.turnId === event.turn_id || current.turnId === '');
    if (!known && (event.type === 'done' || event.type === 'session_meta')) return undefined;
    let turn: LiveTurn;
    if (current && known) {
      turn = { ...current, turnId: event.turn_id, reply: applyTurnEvent(current.turnId ? current.reply : { ...current.reply, turnId: event.turn_id }, event) };
    } else {
      turn = { sessionId, turnId: event.turn_id, prompt: null, replacesLast: false, reply: applyTurnEvent(emptyReply(sessionId, event.turn_id), event) };
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
