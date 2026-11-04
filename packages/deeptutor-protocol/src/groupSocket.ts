import { groupFrames, parseGroupFrame, type DtGroupFrame } from './partnerGroups';
import type { DtSocketFactory, DtSocketHandle, DtTimers } from './turnConnection';

export type DtGroupSocketState = 'connecting' | 'open' | 'reconnecting' | 'signed-out' | 'unavailable' | 'closed';

export interface DtGroupSocketOptions {
  url: string;
  connect: DtSocketFactory;
  timers?: DtTimers;
  onFrame(frame: DtGroupFrame): void;
  onState?(state: DtGroupSocketState): void;
}

const defaultTimers: DtTimers = { set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };

/**
 * A group's socket, following one discussion. It's usable once open (DeepTutor sends no `ready`
 * here); on opening it asks to follow the discussion, which replays what's running (or the last
 * thing that ran). A dropped socket reconnects (250 ms, doubling up to 8 s); work carries on in DeepTutor meanwhile.
 */
export class DtGroupSocket {
  private readonly options: DtGroupSocketOptions;
  private readonly timers: DtTimers;
  private socket: DtSocketHandle | null = null;
  private state: DtGroupSocketState = 'closed';
  private sessionKey = '';
  private wanted = false;
  private attempts = 0;
  private generation = 0;
  private retry: unknown = null;

  constructor(options: DtGroupSocketOptions) {
    this.options = options;
    this.timers = options.timers ?? defaultTimers;
  }

  get currentState(): DtGroupSocketState {
    return this.state;
  }

  /** Connects (if needed) and follows the discussion `sessionKey`. */
  open(sessionKey: string): void {
    this.wanted = true;
    const changed = sessionKey !== this.sessionKey;
    this.sessionKey = sessionKey;
    if (!this.socket) this.connect();
    else if (changed && this.state === 'open') this.socket.send(groupFrames.attach(sessionKey));
  }

  /** Sends a frame (see `groupFrames`); false while not connected. */
  send(data: string): boolean {
    if (this.state !== 'open' || !this.socket) return false;
    this.socket.send(data);
    return true;
  }

  /** Back in the app: reconnect now if the socket died while away. */
  wake(): void {
    if (!this.wanted || this.socket) return;
    if (this.retry !== null) this.timers.clear(this.retry);
    this.retry = null;
    this.attempts = 0;
    this.connect();
  }

  close(): void {
    this.wanted = false;
    this.generation += 1;
    if (this.retry !== null) this.timers.clear(this.retry);
    this.retry = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setState('closed');
  }

  private connect(): void {
    const generation = ++this.generation;
    this.setState(this.attempts ? 'reconnecting' : 'connecting');
    this.socket = this.options.connect(this.options.url, {
      onOpen: () => {
        if (generation !== this.generation) return;
        this.attempts = 0;
        this.setState('open');
        if (this.sessionKey) this.socket?.send(groupFrames.attach(this.sessionKey));
      },
      onMessage: (data) => {
        if (generation !== this.generation) return;
        const frame = parseGroupFrame(data);
        if (frame) this.options.onFrame(frame);
      },
      onClose: (code) => {
        if (generation !== this.generation) return;
        this.socket = null;
        if (code === 4001) {
          this.wanted = false;
          this.setState('signed-out');
          return;
        }
        if (code === 4404) {
          this.wanted = false;
          this.setState('unavailable');
          return;
        }
        if (!this.wanted) return;
        const delay = Math.min(8000, 250 * 2 ** this.attempts);
        this.attempts += 1;
        this.setState('reconnecting');
        this.retry = this.timers.set(() => {
          this.retry = null;
          if (this.wanted && !this.socket) this.connect();
        }, delay);
      },
    });
  }

  private setState(state: DtGroupSocketState): void {
    this.state = state;
    this.options.onState?.(state);
  }
}
