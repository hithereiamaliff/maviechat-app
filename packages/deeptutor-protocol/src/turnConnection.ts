import {
  cancelTurnCommand,
  checkActiveTurnCommand,
  parseServerEvent,
  pingCommand,
  randomId,
  regenerateCommand,
  resumeTurnCommand,
  startTurnCommand,
  submitUserReplyCommand,
  TERMINAL_ERROR_CODES,
  type DtActiveTurnInfo,
  type DtCommand,
  type DtProtocolError,
  type DtStreamEvent,
  type DtTurnRequest,
} from './turns';

/** What the connection hears from a socket. */
export interface DtSocketHandlers {
  onOpen(): void;
  onMessage(data: unknown): void;
  /** `code` 4001: DeepTutor refused the sign-in (a socket refused with HTTP 401/403 counts too). */
  onClose(code: number | undefined): void;
}

/** DeepTutor's close code for a refused sign-in. */
export const SOCKET_AUTH_FAILED = 4001;

export interface DtSocketHandle {
  send(data: string): void;
  close(): void;
}

/** Opens a WebSocket that carries the sign-in (React Native: a `Cookie` header; Node: the `ws` package). */
export type DtSocketFactory = (url: string, handlers: DtSocketHandlers) => DtSocketHandle;

export type DtConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'signed-out';

export interface DtTimers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface DtTurnConnectionOptions {
  url: string;
  connect: DtSocketFactory;
  /** Every event of the turns this connection follows, in order and once each. */
  onEvent(event: DtStreamEvent): void;
  /** Refused commands and broken subscriptions. A refused start also rejects its `startTurn`. */
  onError?(error: DtProtocolError): void;
  onState?(state: DtConnectionState): void;
  /** A start or regenerate is waiting for DeepTutor to finish the session's previous turn. */
  onWaiting?(sessionId: string): void;
  timers?: DtTimers;
  now?: () => number;
  random?: () => number;
  /** Keeps proxies from closing a quiet socket. */
  pingIntervalMs?: number;
  ackTimeoutMs?: number;
  startTimeoutMs?: number;
}

/** DeepTutor refused the sign-in on the socket. */
export class DtSocketAuthError extends Error {
  constructor() {
    super('DeepTutor no longer accepts this sign-in');
    this.name = 'DtSocketAuthError';
  }
}

/** A command sent again while DeepTutor still holds the session's previous turn. */
interface Retrying {
  command: DtCommand;
  busyUntil: number | null;
  retryTimer: unknown;
}

interface PendingStart extends Retrying {
  sessionId: string;
  resolve(value: { sessionId: string; turnId: string }): void;
  reject(error: Error): void;
  timer: unknown;
}

/**
 * DeepTutor keeps a session's turn lease for a few seconds after `done` (about 8 s in 1.7.1)
 * and refuses another turn meanwhile. Nothing is created before it accepts, so the command
 * is simply sent again.
 */
const BUSY_RETRY_MS = 2000;
const BUSY_WAIT_MS = 30_000;

function isBusy(error: DtProtocolError): boolean {
  return /active or recovering turn|_busy\b/i.test(error.message) || error.error_code.endsWith('_busy');
}

const defaultTimers: DtTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => {
    if (handle !== null && handle !== undefined) clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/**
 * One `/ws` connection for every turn of a signed-in account. It follows turns by their
 * `seq`: repeats are dropped, a gap asks the server to replay from the last event applied,
 * and after a reconnect each unfinished turn resumes where it stopped. A start sent before
 * a drop is sent again with the same submission id, so the server doesn't run it twice.
 */
export class DtTurnConnection {
  private readonly options: DtTurnConnectionOptions;
  private readonly timers: DtTimers;
  private socket: DtSocketHandle | null = null;
  private generation = 0;
  private open = false;
  private stopped = false;
  private state: DtConnectionState = 'idle';
  private attempt = 0;
  private reconnectTimer: unknown = null;
  private pingTimer: unknown = null;
  /** The last event applied of every turn seen; unfinished turns are also in `active`. */
  private readonly cursors = new Map<string, number>();
  private readonly active = new Set<string>();
  private readonly gapAsked = new Map<string, number>();
  /** Turns whose `session` event arrived, or that were followed rather than started here. */
  private readonly named = new Set<string>();
  private readonly starts: PendingStart[] = [];
  private readonly regenerates = new Map<string, Retrying>();
  private readonly acks = new Map<string, { resolve(accepted: boolean): void; timer: unknown }>();
  private readonly activeChecks: ((info: DtActiveTurnInfo) => void)[] = [];
  private readonly outbox: DtCommand[] = [];

  constructor(options: DtTurnConnectionOptions) {
    this.options = options;
    this.timers = options.timers ?? defaultTimers;
  }

  get connectionState(): DtConnectionState {
    return this.state;
  }

  /** Starts a turn. Resolves when the server names its session and turn (for a new chat, the new session). */
  startTurn(request: DtTurnRequest): Promise<{ sessionId: string; turnId: string }> {
    if (this.state === 'signed-out') return Promise.reject(new DtSocketAuthError());
    const command = startTurnCommand({ ...request, clientSubmissionId: request.clientSubmissionId ?? randomId() });
    return new Promise((resolve, reject) => {
      const pending: PendingStart = {
        command,
        busyUntil: null,
        retryTimer: null,
        sessionId: request.sessionId ?? '',
        resolve,
        reject,
        timer: this.timers.set(() => {
          this.dropStart(pending);
          reject(new Error("DeepTutor didn't start the reply. Check the connection and try again."));
        }, this.options.startTimeoutMs ?? 45_000),
      };
      this.starts.push(pending);
      if (this.open) this.transmit(command);
      else this.connect();
    });
  }

  /** Follows a turn already running (or replays a finished one) from after `afterSeq`. */
  follow(turnId: string, afterSeq = 0): void {
    if (!turnId) return;
    this.cursors.set(turnId, Math.max(this.cursors.get(turnId) ?? 0, afterSeq));
    this.active.add(turnId);
    this.named.add(turnId);
    if (this.open) this.transmit(resumeTurnCommand(turnId, this.cursors.get(turnId) ?? 0));
    else this.connect();
  }

  /** Asks the server to stop a turn; resolves with whether it accepted. */
  cancel(turnId: string): Promise<boolean> {
    const commandId = randomId();
    return this.awaitAck(commandId, cancelTurnCommand(turnId, commandId));
  }

  /** Answers the session's last message again (replacing the reply); the new turn's events follow as usual. */
  regenerate(sessionId: string): void {
    const previous = this.regenerates.get(sessionId);
    if (previous) this.timers.clear(previous.retryTimer);
    const command = regenerateCommand(sessionId);
    this.regenerates.set(sessionId, { command, busyUntil: null, retryTimer: null });
    this.queue(command);
  }

  /** Answers a turn waiting for input. */
  reply(turnId: string, reply: { text?: string; answers?: { questionId: string; text: string }[] }): Promise<boolean> {
    const commandId = randomId();
    return this.awaitAck(commandId, submitUserReplyCommand(turnId, commandId, reply));
  }

  /** Whether a session has a turn running elsewhere (another device, or before the app restarted). */
  checkActiveTurn(sessionId: string): Promise<DtActiveTurnInfo> {
    return new Promise((resolve) => {
      this.activeChecks.push(resolve);
      this.queue(checkActiveTurnCommand(sessionId));
    });
  }

  /** Opens the socket if it isn't (on demand, or when the app comes back to the foreground). */
  connect(): void {
    this.stopped = false;
    if (this.socket || this.state === 'signed-out') return;
    if (this.reconnectTimer !== null) {
      this.timers.clear(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.setState(this.active.size ? 'reconnecting' : 'connecting');
    const generation = ++this.generation;
    const current = () => generation === this.generation;
    this.socket = this.options.connect(this.options.url, {
      onOpen: () => current() && this.handleOpen(),
      onMessage: (data) => current() && this.handleMessage(data),
      onClose: (code) => current() && this.handleClose(code),
    });
  }

  /** Back in the foreground: reconnect at once if anything is unfinished (iOS closes sockets in the background). */
  wake(): void {
    if (this.socket || this.stopped || this.state === 'signed-out') return;
    if (!this.active.size && !this.starts.length && !this.outbox.length) return;
    this.attempt = 0;
    this.connect();
  }

  /** Closes for good (sign-out): pending starts fail, nothing reconnects. */
  close(): void {
    this.stopped = true;
    this.generation += 1;
    this.open = false;
    this.socket?.close();
    this.socket = null;
    this.clearTimers();
    this.failPending(new Error('Disconnected from DeepTutor.'));
    this.active.clear();
    this.setState('idle');
  }

  private handleOpen(): void {
    this.open = true;
    this.attempt = 0;
    this.setState('open');
    for (const turnId of this.active) this.transmit(resumeTurnCommand(turnId, this.cursors.get(turnId) ?? 0));
    for (const start of this.starts) this.transmit(start.command);
    for (const command of this.outbox.splice(0)) this.transmit(command);
    this.schedulePing();
  }

  private handleMessage(data: unknown): void {
    const event = parseServerEvent(data);
    if (!event || event.type === 'pong') return;
    if (event.type === 'command_ack') {
      const waiter = this.acks.get(event.command_id);
      if (waiter) {
        this.acks.delete(event.command_id);
        this.timers.clear(waiter.timer);
        waiter.resolve(event.accepted);
      }
      return;
    }
    if (event.type === 'active_turn_info') {
      this.activeChecks.shift()?.(event);
      return;
    }
    if (event.type === 'protocol_error') {
      if (event.error_code === 'regenerate_rejected') {
        const pending = this.regenerates.get(event.session_id);
        if (pending && isBusy(event) && this.retryLater(pending, event.session_id)) return;
        this.regenerates.delete(event.session_id);
      } else if (TERMINAL_ERROR_CODES.has(event.error_code)) {
        const start = this.starts.find((item) => item.sessionId === event.session_id) ?? (event.session_id ? undefined : this.starts[0]);
        if (start) {
          if (isBusy(event) && this.retryLater(start, event.session_id)) return;
          this.dropStart(start);
          start.reject(new Error(event.message || "DeepTutor couldn't start the reply."));
        }
      }
      this.options.onError?.(event);
      return;
    }

    const turnId = event.turn_id;
    if (!turnId) {
      this.options.onEvent(event);
      return;
    }
    if (!this.cursors.has(turnId)) {
      // A turn this socket subscribed to: a start, a regenerate or a resume.
      this.cursors.set(turnId, 0);
      this.active.add(turnId);
    }
    const last = this.cursors.get(turnId) ?? 0;
    if (event.seq > 0) {
      if (event.seq <= last) return;
      if (event.seq > last + 1 && this.gapAsked.get(turnId) !== last) {
        // An event went missing: replay from the last one applied (once per gap; if the
        // server's numbering really skips, the replay's first event is taken as it is).
        this.gapAsked.set(turnId, last);
        this.transmit(resumeTurnCommand(turnId, last));
        return;
      }
      this.cursors.set(turnId, event.seq);
    }
    if (event.type === 'session' && !this.named.has(turnId)) {
      this.named.add(turnId);
      this.settleStart(event.session_id, turnId);
      const regenerate = this.regenerates.get(event.session_id);
      if (regenerate) {
        this.timers.clear(regenerate.retryTimer);
        this.regenerates.delete(event.session_id);
      }
    }
    if (event.type === 'done') this.active.delete(turnId);
    this.options.onEvent(event);
  }

  private handleClose(code: number | undefined): void {
    this.open = false;
    this.socket = null;
    this.clearPing();
    if (code === SOCKET_AUTH_FAILED) {
      this.failPending(new DtSocketAuthError());
      this.active.clear();
      this.setState('signed-out');
      return;
    }
    if (this.stopped) {
      this.setState('idle');
      return;
    }
    if (!this.active.size && !this.starts.length && !this.outbox.length) {
      // Nothing to wait for: the next command reconnects.
      this.setState('idle');
      return;
    }
    this.setState('reconnecting');
    const random = this.options.random ?? Math.random;
    const delay = Math.min(8000, 250 * 2 ** this.attempt) * (0.8 + random() * 0.4);
    this.attempt += 1;
    this.reconnectTimer = this.timers.set(() => {
      this.reconnectTimer = null;
      this.connect();
    }, Math.round(delay));
  }

  private settleStart(sessionId: string, turnId: string): void {
    const start = this.starts.find((item) => item.sessionId === sessionId) ?? this.starts.find((item) => !item.sessionId);
    if (!start) return;
    this.dropStart(start);
    start.resolve({ sessionId, turnId });
  }

  private dropStart(start: PendingStart): void {
    const index = this.starts.indexOf(start);
    if (index >= 0) this.starts.splice(index, 1);
    this.timers.clear(start.timer);
    this.timers.clear(start.retryTimer);
  }

  /** Sends a refused command again in a moment, while the session's previous turn wraps up. */
  private retryLater(item: Retrying, sessionId: string): boolean {
    const now = (this.options.now ?? Date.now)();
    item.busyUntil ??= now + BUSY_WAIT_MS;
    if (now >= item.busyUntil) return false;
    this.options.onWaiting?.(sessionId);
    this.timers.clear(item.retryTimer);
    item.retryTimer = this.timers.set(() => {
      item.retryTimer = null;
      // A pending start goes out again on its own when the socket reopens; others wait in the outbox.
      if (this.open) this.transmit(item.command);
      else if (this.starts.includes(item as PendingStart)) this.connect();
      else this.queue(item.command);
    }, BUSY_RETRY_MS);
    return true;
  }

  private awaitAck(commandId: string, command: DtCommand): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = this.timers.set(() => {
        this.acks.delete(commandId);
        resolve(false);
      }, this.options.ackTimeoutMs ?? 15_000);
      this.acks.set(commandId, { resolve, timer });
      this.queue(command);
    });
  }

  private queue(command: DtCommand): void {
    if (this.open) this.transmit(command);
    else {
      this.outbox.push(command);
      this.connect();
    }
  }

  private transmit(command: DtCommand): void {
    this.socket?.send(JSON.stringify(command));
  }

  private schedulePing(): void {
    this.clearPing();
    this.pingTimer = this.timers.set(() => {
      this.pingTimer = null;
      if (!this.open) return;
      this.transmit(pingCommand());
      this.schedulePing();
    }, this.options.pingIntervalMs ?? 25_000);
  }

  private clearPing(): void {
    if (this.pingTimer === null) return;
    this.timers.clear(this.pingTimer);
    this.pingTimer = null;
  }

  private clearTimers(): void {
    this.clearPing();
    if (this.reconnectTimer !== null) this.timers.clear(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private failPending(error: Error): void {
    for (const start of this.starts.splice(0)) {
      this.timers.clear(start.timer);
      this.timers.clear(start.retryTimer);
      start.reject(error);
    }
    for (const regenerate of this.regenerates.values()) this.timers.clear(regenerate.retryTimer);
    this.regenerates.clear();
    for (const [id, waiter] of this.acks) {
      this.timers.clear(waiter.timer);
      waiter.resolve(false);
      this.acks.delete(id);
    }
    this.outbox.length = 0;
  }

  private setState(state: DtConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onState?.(state);
  }
}
