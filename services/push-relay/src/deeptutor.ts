import { preview, type PushMessage } from './notification.ts';

/**
 * DeepTutor has no "reply finished" hook, so the relay watches a turn for the app: the app hands
 * over its DeepTutor sign-in for that one turn, the relay follows the turn over DeepTutor's `/ws`
 * (inside the server, not over the internet) and notifies the phone when it ends or asks a
 * question. The sign-in stays in memory for as long as the watch lasts, and is never logged.
 */

export interface WatchSocketHandlers {
  onOpen(): void;
  onMessage(data: string): void;
  onClose(): void;
}

export interface WatchSocket {
  send(data: string): void;
  close(): void;
}

/** Opens DeepTutor's `/ws` with a `Cookie` header (Node's built-in WebSocket in production). */
export type WatchSocketFactory = (url: string, cookie: string, handlers: WatchSocketHandlers) => WatchSocket;

export interface Timers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface WatchRequest {
  pushToken: string;
  sessionId: string;
  turnId: string;
  /** The chat's title, for the notification. */
  title: string | null;
  /** The user's DeepTutor sign-in, for this watch only. */
  token: string;
}

interface Watch extends WatchRequest {
  seq: number;
  socket: WatchSocket | null;
  drops: number;
  asked: boolean;
  result: Record<string, unknown> | null;
  expiry: unknown;
  retry: unknown;
}

export interface TurnWatcherOptions {
  /** DeepTutor's web front end as the relay reaches it, e.g. `http://deeptutor:3782`. */
  url: string;
  connect: WatchSocketFactory;
  /** Sends through Expo; resolves with how many were accepted. */
  send(messages: PushMessage[]): Promise<number>;
  timers?: Timers;
  maxWatches?: number;
  maxPerPhone?: number;
}

/** Research can run for most of an hour; nothing is watched longer than this. */
const MAX_WATCH_MS = 3 * 60 * 60_000;
const MAX_DROPS = 20;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const defaultTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => {
    if (handle !== null && handle !== undefined) clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

function heading(base: string, title: string | null): string {
  return title ? `${base}: ${title}` : base;
}

/** What a finished turn produced, in a line: the mode's own result, else the start of the answer. */
export function describeResult(result: Record<string, unknown> | null): string {
  if (!result) return 'Open the chat to read it.';
  if (result.outline_preview === true) return 'Your research plan is ready. Open it to start the research.';
  const quiz = record(result.summary).results;
  if (Array.isArray(quiz) && quiz.length) return `Your quiz is ready: ${quiz.length} ${quiz.length === 1 ? 'question' : 'questions'}.`;
  if (text(result.render_type)) return 'Your visualization is ready.';
  return preview(text(result.response)) || 'Open the chat to read it.';
}

export function deepTutorDone(watch: Pick<WatchRequest, 'pushToken' | 'sessionId' | 'title'>, status: string, result: Record<string, unknown> | null): PushMessage {
  const failed = status === 'failed';
  return {
    to: watch.pushToken,
    title: heading(failed ? "DeepTutor couldn't finish" : 'DeepTutor reply ready', watch.title),
    body: failed ? 'Open the chat to try again.' : describeResult(result),
    data: { kind: failed ? 'deeptutor.failed' : 'deeptutor.finished', sessionId: watch.sessionId },
    sound: 'default',
    priority: 'high',
    threadId: watch.sessionId,
  };
}

export function deepTutorQuestion(watch: Pick<WatchRequest, 'pushToken' | 'sessionId' | 'title'>, ask: Record<string, unknown>): PushMessage {
  const first = record(Array.isArray(ask.questions) ? ask.questions[0] : null);
  return {
    to: watch.pushToken,
    title: heading('DeepTutor has a question', watch.title),
    body: preview(text(first.prompt) || text(ask.intro)) || 'Open the chat to answer it.',
    data: { kind: 'deeptutor.question', sessionId: watch.sessionId },
    sound: 'default',
    priority: 'high',
    threadId: watch.sessionId,
  };
}

/** Follows DeepTutor turns for phones, one socket per watched turn, until each ends. */
export class TurnWatcher {
  private readonly options: TurnWatcherOptions;
  private readonly timers: Timers;
  private readonly watches = new Map<string, Watch>();

  constructor(options: TurnWatcherOptions) {
    this.options = options;
    this.timers = options.timers ?? defaultTimers;
  }

  get size(): number {
    return this.watches.size;
  }

  /** Starts following a turn for a phone. */
  watch(request: WatchRequest): 'watching' | 'already' | 'full' {
    const key = `${request.pushToken} ${request.turnId}`;
    if (this.watches.has(key)) return 'already';
    const perPhone = [...this.watches.values()].filter((watch) => watch.pushToken === request.pushToken).length;
    if (this.watches.size >= (this.options.maxWatches ?? 200) || perPhone >= (this.options.maxPerPhone ?? 10)) return 'full';
    const watch: Watch = { ...request, seq: 0, socket: null, drops: 0, asked: false, result: null, expiry: null, retry: null };
    watch.expiry = this.timers.set(() => this.end(key), MAX_WATCH_MS);
    this.watches.set(key, watch);
    this.open(key);
    return 'watching';
  }

  /** Shutting down: every socket closes and every sign-in is forgotten. */
  stopAll(): void {
    for (const key of [...this.watches.keys()]) this.end(key);
  }

  private open(key: string): void {
    const watch = this.watches.get(key);
    if (!watch) return;
    const url = `${this.options.url.replace(/\/+$/, '').replace(/^http/i, 'ws')}/ws`;
    // The same header shape as the app's (see deeptutor-protocol's socketCookieHeader).
    watch.socket = this.options.connect(url, `maviechat=1; dt_token=${watch.token}`, {
      onOpen: () => watch.socket?.send(JSON.stringify({ protocol_version: '2.0', type: 'resume_from', turn_id: watch.turnId, seq: watch.seq })),
      onMessage: (data) => this.handle(key, data),
      onClose: () => this.dropped(key),
    });
  }

  private handle(key: string, data: string): void {
    const watch = this.watches.get(key);
    if (!watch) return;
    let event: Record<string, unknown>;
    try {
      event = record(JSON.parse(data));
    } catch {
      return;
    }
    if (event.type === 'protocol_error') {
      // An unknown turn, or one this sign-in may not follow: nothing will come.
      if (event.retryable !== true) this.end(key);
      return;
    }
    if (text(event.turn_id) !== watch.turnId) return;
    if (typeof event.seq === 'number') {
      if (event.seq <= watch.seq) return;
      watch.seq = event.seq;
    }
    const meta = record(event.metadata);
    if (event.type === 'result') watch.result = meta;
    if (event.type === 'tool_result' && !watch.asked) {
      const ask = record(record(meta.tool_metadata).ask_user);
      if (Array.isArray(ask.questions) && ask.questions.length) {
        watch.asked = true;
        void this.options.send([deepTutorQuestion(watch, ask)]).catch(() => 0);
      }
    }
    if (event.type === 'done') {
      const status = text(meta.status);
      // You stopped it yourself: nothing to tell you.
      if (status !== 'cancelled') void this.options.send([deepTutorDone(watch, status, watch.result)]).catch(() => 0);
      this.end(key);
    }
  }

  private dropped(key: string): void {
    const watch = this.watches.get(key);
    if (!watch) return;
    watch.socket = null;
    watch.drops += 1;
    if (watch.drops > MAX_DROPS) {
      this.end(key);
      return;
    }
    watch.retry = this.timers.set(() => this.open(key), Math.min(30_000, 1000 * 2 ** Math.min(watch.drops, 5)));
  }

  private end(key: string): void {
    const watch = this.watches.get(key);
    if (!watch) return;
    this.watches.delete(key);
    this.timers.clear(watch.expiry);
    this.timers.clear(watch.retry);
    watch.token = '';
    watch.socket?.close();
  }
}
