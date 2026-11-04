import { PARTNER_SOCKET_CLOSE, parsePartnerFrame, partnerAttach, partnerMessage, partnerStop, type DtPartnerFrame } from './partners';
import type { DtSocketFactory, DtSocketHandle, DtTimers } from './turnConnection';
import { applyTurnEvent, emptyReply, type DtReply } from './turnReply';

export type DtPartnerChatState = 'connecting' | 'ready' | 'reconnecting' | 'signed-out' | 'unavailable' | 'closed';

/** The reply being written in the conversation you're in. */
export interface DtPartnerTurn {
  sessionKey: string;
  /** Your message: the one this connection sent, or DeepTutor's echo of it when following a reply again. */
  prompt: string | null;
  /** DeepTutor has stored your message: a later failure doesn't lose it. */
  accepted: boolean;
  reply: DtReply;
}

export interface DtPartnerChatOptions {
  url: string;
  connect: DtSocketFactory;
  timers?: DtTimers;
  onState?(state: DtPartnerChatState, detail?: string): void;
  /** The reply in progress changed (null: none). */
  onTurn?(turn: DtPartnerTurn | null): void;
  /** A reply ended (finished, failed, or stopped): read the conversation again. */
  onEnd?(turn: DtPartnerTurn): void;
  /** A message wasn't taken (DeepTutor didn't store it): give the words back. */
  onRefused?(prompt: string, reason: 'busy' | 'moved' | 'error', message: string): void;
  /** Something the partner said on its own (a reminder it was asked to give). */
  onProactive?(content: string): void;
}

const defaultTimers: DtTimers = { set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
/** As the web: reconnect after 250 ms, doubling up to 8 s; ask again after 2 s when the reply runs elsewhere. */
const RETRY_BASE_MS = 250;
const RETRY_MAX_MS = 8000;
const ATTACH_AGAIN_MS = 2000;

/**
 * One partner's socket, following one conversation: sends a message, streams its reply, stops it,
 * and after a dropped socket (the app was away) reconnects and follows the reply again. Replies run
 * on DeepTutor, not on the socket, so nothing is lost while it's closed.
 */
export class DtPartnerChat {
  private readonly options: DtPartnerChatOptions;
  private readonly timers: DtTimers;
  private socket: DtSocketHandle | null = null;
  private state: DtPartnerChatState = 'closed';
  private sessionKey = '';
  private turn: DtPartnerTurn | null = null;
  private wanted = false;
  private attempts = 0;
  private generation = 0;
  private retry: unknown = null;
  private attachAgain: unknown = null;
  /** A reply was in progress when the socket went down: the next attach's answer is about it. */
  private following = false;

  constructor(options: DtPartnerChatOptions) {
    this.options = options;
    this.timers = options.timers ?? defaultTimers;
  }

  get currentState(): DtPartnerChatState {
    return this.state;
  }

  get busy(): boolean {
    return this.turn !== null;
  }

  /** Connects (if needed) and follows the conversation `sessionKey`. */
  open(sessionKey: string): void {
    this.wanted = true;
    if (sessionKey !== this.sessionKey) {
      this.sessionKey = sessionKey;
      this.setTurn(null);
      if (this.state === 'ready') this.socket?.send(partnerAttach(sessionKey));
    }
    if (!this.socket) this.connect();
  }

  /** Sends a message in the current conversation; false when it can't go now (not connected, or a reply is running). */
  send(content: string): boolean {
    if (this.state !== 'ready' || !this.socket || this.turn) return false;
    this.setTurn({ sessionKey: this.sessionKey, prompt: content, accepted: false, reply: { ...emptyReply(), status: 'running' } });
    this.socket.send(partnerMessage(this.sessionKey, content));
    return true;
  }

  /** Stops the reply in progress (DeepTutor answers `stopped`; the words so far stay). */
  stop(): void {
    if (this.state === 'ready' && this.socket && this.turn) this.socket.send(partnerStop(this.sessionKey));
  }

  /** Back in the app: reconnect now if the socket died while away. */
  wake(): void {
    if (!this.wanted || this.socket) return;
    this.attempts = 0;
    if (this.retry !== null) this.timers.clear(this.retry);
    this.retry = null;
    this.connect();
  }

  /** After the partner is started or stopped: the open socket still points at the old runtime. */
  reconnect(): void {
    if (!this.wanted) return;
    this.drop();
    this.attempts = 0;
    this.connect();
  }

  close(): void {
    this.wanted = false;
    this.drop();
    this.setTurn(null);
    this.setState('closed');
  }

  private drop(): void {
    this.generation += 1;
    if (this.retry !== null) this.timers.clear(this.retry);
    if (this.attachAgain !== null) this.timers.clear(this.attachAgain);
    this.retry = null;
    this.attachAgain = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  private connect(): void {
    const generation = ++this.generation;
    this.following = this.turn !== null;
    this.setState(this.attempts ? 'reconnecting' : 'connecting');
    this.socket = this.options.connect(this.options.url, {
      onOpen: () => undefined, // ready comes once DeepTutor has started the partner
      onMessage: (data) => {
        if (generation !== this.generation) return;
        const frame = parsePartnerFrame(data);
        if (frame) this.frame(frame);
      },
      onClose: (code) => {
        if (generation !== this.generation) return;
        this.socket = null;
        this.closed(code);
      },
    });
  }

  private closed(code: number | undefined): void {
    if (code === PARTNER_SOCKET_CLOSE.signedOut) {
      this.wanted = false;
      this.setState('signed-out');
      return;
    }
    // Gone or not yours (4404), or it couldn't start (4003/4004, after an `error` frame).
    if (code === PARTNER_SOCKET_CLOSE.unavailable || code === 4003 || code === 4004) {
      this.wanted = false;
      this.setState('unavailable', this.lastError);
      return;
    }
    if (!this.wanted) return;
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** this.attempts);
    this.attempts += 1;
    this.setState('reconnecting');
    this.retry = this.timers.set(() => {
      this.retry = null;
      if (this.wanted && !this.socket) this.connect();
    }, delay);
  }

  private lastError = '';

  private frame(frame: DtPartnerFrame): void {
    switch (frame.type) {
      case 'ready':
        this.attempts = 0;
        this.setState('ready');
        this.socket?.send(partnerAttach(this.sessionKey));
        return;
      case 'accepted':
        if (this.turn && !this.turn.accepted) this.setTurn({ ...this.turn, accepted: true });
        return;
      case 'resuming':
        this.following = false;
        this.setTurn({ sessionKey: this.sessionKey, prompt: this.turn?.prompt ?? null, accepted: true, reply: this.turn?.reply ?? { ...emptyReply(), status: 'running' } });
        return;
      case 'user_echo':
        if (this.turn) this.setTurn({ ...this.turn, prompt: frame.content });
        return;
      case 'stream_event': {
        // Only a reply this socket sent or follows takes events: one arriving after its end (the
        // conversation's new title, say) never starts a reply of its own. And only the outer
        // `done` frame ends a reply; an event of type `done` inside is DeepTutor's bookkeeping.
        const turn = this.turn;
        if (!turn || frame.event.type === 'done') return;
        this.setTurn({ ...turn, reply: { ...applyTurnEvent(turn.reply, frame.event), status: 'running' } });
        return;
      }
      case 'content':
        if (this.turn) this.setTurn({ ...this.turn, reply: { ...this.turn.reply, answer: frame.content } });
        return;
      case 'done':
        this.end(this.turn?.reply.error ? 'failed' : 'completed');
        return;
      case 'stopped':
        this.end('cancelled');
        return;
      case 'error':
        this.lastError = frame.content;
        if (!this.turn) return;
        if (!this.turn.accepted) this.refuse('error', frame.content);
        else this.setTurn({ ...this.turn, reply: { ...this.turn.reply, error: frame.content } }); // `done` follows
        return;
      case 'turn_busy':
        if (this.turn && !this.turn.accepted) this.refuse('busy', frame.content);
        return;
      case 'stale_session':
        if (this.turn && !this.turn.accepted) this.refuse('moved', frame.content);
        return;
      case 'attach_busy':
        // The reply is running in another of DeepTutor's workers: ask again shortly.
        if (this.attachAgain !== null) this.timers.clear(this.attachAgain);
        this.attachAgain = this.timers.set(() => {
          this.attachAgain = null;
          if (this.state === 'ready') this.socket?.send(partnerAttach(this.sessionKey));
        }, ATTACH_AGAIN_MS);
        return;
      case 'attach_idle':
        // Nothing running. That's news only for a reply we were following when the socket went
        // down (it ended meanwhile); a message sent since the attach is answered on its own.
        if (!this.following) return;
        this.following = false;
        if (this.turn && !this.turn.accepted) this.refuse('error', 'The message didn’t reach the partner. Send it again.');
        else if (this.turn) this.end('completed');
        return;
      case 'proactive':
        this.options.onProactive?.(frame.content);
        return;
    }
  }

  private refuse(reason: 'busy' | 'moved' | 'error', message: string): void {
    const prompt = this.turn?.prompt ?? '';
    this.setTurn(null);
    this.options.onRefused?.(prompt, reason, message);
  }

  private end(status: DtReply['status']): void {
    const turn = this.turn;
    if (!turn) return;
    const ended: DtPartnerTurn = { ...turn, reply: { ...turn.reply, status } };
    this.setTurn(null);
    this.options.onEnd?.(ended);
  }

  private setTurn(turn: DtPartnerTurn | null): void {
    this.turn = turn;
    this.options.onTurn?.(turn);
  }

  private setState(state: DtPartnerChatState, detail?: string): void {
    this.state = state;
    this.options.onState?.(state, detail);
  }
}
