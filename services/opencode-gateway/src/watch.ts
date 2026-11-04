/*
 * Notifications for sessions started from a phone. With each prompt the phone may hand over its
 * Expo push token (header `x-maviechat-push`). The gateway keeps it in memory for that session
 * only, follows OpenCode's event stream, and tells the phone when the session finishes or fails,
 * or asks for approval or an answer (also from a subagent it started). Nothing is written down:
 * a restart forgets every watch. Sessions started elsewhere (the terminal) don't notify.
 */
import { basic, type Login } from './gateway.ts';
import { sendPushes, type PushMessage } from './push.ts';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** How long a session is watched at most. */
const WATCH_MS = 6 * 60 * 60_000;
const MAX_WATCHES = 500;
const MAX_PER_DEVICE = 50;
/** An idle report within this long of the prompt, before the session was seen working, isn't its end. */
const SETTLE_MS = 3000;
/** Sessions whose parent is remembered (for subagents), oldest forgotten first. */
const MAX_PARENTS = 5000;

/** An event from OpenCode's global stream: the project it's in, and what happened. */
export interface GlobalEvent {
  directory?: string;
  payload: { type: string; properties: Record<string, unknown> };
}

interface Watch {
  deviceId: string;
  pushToken: string;
  login: Login;
  sessionId: string;
  directory: string;
  startedAt: number;
  busy: boolean;
  error: 'stopped' | 'failed' | null;
  /** Requests already notified (each once). */
  asked: Set<string>;
}

type Note = { kind: 'finished' } | { kind: 'failed' } | { kind: 'question' } | { kind: 'approval'; need: string };

/** What a permission request is for, in words. */
const NEEDS: Record<string, string> = {
  edit: 'wants to change files',
  bash: 'wants to run a command',
  webfetch: 'wants to fetch a web page',
  websearch: 'wants to search the web',
  external_directory: 'wants to use a folder outside the project',
  task: 'wants to start a subagent',
  doom_loop: 'keeps repeating the same step',
};

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const folderName = (directory: string) => directory.replace(/\/+$/, '').split('/').pop() || directory;

/** The event types the watcher acts on; everything else is skipped before parsing. */
const WANTED = /"type":"(?:session\.(?:created|updated|status|idle|error)|permission\.asked|question\.asked)"/;

/** One server-sent event block from `/global/event`, when it's a kind the watcher acts on. */
export function parseGlobalEvent(block: string): GlobalEvent | null {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n');
  if (!data || !WANTED.test(data)) return null;
  try {
    const parsed = JSON.parse(data) as { directory?: unknown; payload?: unknown; type?: unknown; properties?: unknown };
    const payload = (parsed.payload ?? parsed) as { type?: unknown; properties?: unknown };
    if (typeof payload.type !== 'string') return null;
    const properties = typeof payload.properties === 'object' && payload.properties !== null ? (payload.properties as Record<string, unknown>) : {};
    return { directory: text(parsed.directory) || undefined, payload: { type: payload.type, properties } };
  } catch {
    return null;
  }
}

/** Reads an event stream to its end, handing over each event the watcher acts on. */
export async function readGlobalEvents(body: ReadableStream<Uint8Array>, onEvent: (event: GlobalEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n');
    let end = buffer.indexOf('\n\n');
    while (end >= 0) {
      const event = parseGlobalEvent(buffer.slice(0, end));
      buffer = buffer.slice(end + 2);
      if (event) onEvent(event);
      end = buffer.indexOf('\n\n');
    }
    // A runaway event (a huge tool output) isn't one the watcher needs.
    if (buffer.length > 4_000_000) buffer = '';
  }
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

export interface WatcherOptions {
  /** This machine's address, as the app knows it: the notification names it. */
  machineUrl: string;
  logins: Login[];
  fetch: Fetch;
  log: (line: string) => void;
  send?: (messages: PushMessage[]) => Promise<{ gone: string[] }>;
  now?: () => number;
}

export class Watcher {
  private readonly watches = new Map<string, Watch>();
  private readonly parents = new Map<string, string>();
  private readonly streams = new Map<string, AbortController>();
  private readonly options: WatcherOptions;
  private readonly send: (messages: PushMessage[]) => Promise<{ gone: string[] }>;
  private readonly now: () => number;

  constructor(options: WatcherOptions) {
    this.options = options;
    this.send = options.send ?? ((messages) => sendPushes(options.fetch, messages));
    this.now = options.now ?? Date.now;
  }

  /** How many sessions are watched now. */
  get size(): number {
    return this.watches.size;
  }

  /**
   * Starts watching a session for a phone, before its prompt goes to OpenCode (so the session's
   * start isn't missed). Answers with an undo, for a prompt OpenCode didn't take.
   */
  watch(input: { deviceId: string; pushToken: string; loginId: string; sessionId: string; directory: string }): () => void {
    const login = this.options.logins.find((item) => item.id === input.loginId);
    if (!login) return () => undefined;
    this.sweep();
    const key = `${input.deviceId} ${login.id} ${input.sessionId}`;
    const existing = this.watches.get(key);
    if (!existing) {
      const mine = [...this.watches.values()].filter((item) => item.deviceId === input.deviceId).length;
      if (this.watches.size >= MAX_WATCHES || mine >= MAX_PER_DEVICE) return () => undefined;
    }
    const watch: Watch = {
      deviceId: input.deviceId,
      pushToken: input.pushToken,
      login,
      sessionId: input.sessionId,
      directory: input.directory,
      startedAt: this.now(),
      busy: existing?.busy ?? false,
      error: null,
      asked: existing?.asked ?? new Set(),
    };
    this.watches.set(key, watch);
    this.follow(login);
    return () => {
      if (!existing && this.watches.get(key) === watch) this.watches.delete(key);
    };
  }

  /** A phone was unpaired: nothing more reaches it. */
  forgetDevice(deviceId: string): void {
    for (const [key, watch] of this.watches) if (watch.deviceId === deviceId) this.watches.delete(key);
  }

  /** Follows every login's events from now on, reconnecting when a stream drops. */
  start(): void {
    for (const login of this.options.logins) this.follow(login);
  }

  stop(): void {
    for (const controller of this.streams.values()) controller.abort();
    this.streams.clear();
  }

  /** One event from a login's stream. */
  handle(loginId: string, event: GlobalEvent): void {
    const props = event.payload.properties;
    switch (event.payload.type) {
      case 'session.created':
      case 'session.updated': {
        const info = props.info as { id?: unknown; parentID?: unknown } | undefined;
        if (text(info?.id) && text(info?.parentID)) this.remember(text(info?.id), text(info?.parentID));
        return;
      }
      case 'session.status': {
        const status = text((props.status as { type?: unknown } | undefined)?.type);
        if (status === 'busy' || status === 'retry') for (const watch of this.watching(loginId, text(props.sessionID))) watch.busy = true;
        else if (status === 'idle') this.finish(loginId, text(props.sessionID));
        return;
      }
      case 'session.idle':
        this.finish(loginId, text(props.sessionID));
        return;
      case 'session.error': {
        const stopped = text((props.error as { name?: unknown } | undefined)?.name) === 'MessageAbortedError';
        for (const watch of this.watching(loginId, text(props.sessionID))) watch.error = stopped ? 'stopped' : 'failed';
        return;
      }
      case 'permission.asked':
      case 'question.asked': {
        const id = text(props.id);
        if (!id) return;
        for (const watch of this.watching(loginId, this.rootOf(text(props.sessionID)))) {
          if (watch.asked.has(id)) continue;
          watch.asked.add(id);
          void this.notify(watch, event.payload.type === 'question.asked' ? { kind: 'question' } : { kind: 'approval', need: text(props.permission) });
        }
        return;
      }
    }
  }

  private follow(login: Login): void {
    if (this.streams.has(login.id)) return;
    const controller = new AbortController();
    this.streams.set(login.id, controller);
    void this.listen(login, controller.signal);
  }

  private async listen(login: Login, signal: AbortSignal): Promise<void> {
    let delay = 1000;
    while (!signal.aborted) {
      try {
        const response = await this.options.fetch(`${login.url}/global/event`, { headers: { Authorization: basic(login), Accept: 'text/event-stream' }, signal });
        if (!response.ok || !response.body) throw new Error(`answered ${response.status}`);
        this.options.log(`events: following ${login.id}`);
        delay = 1000;
        await readGlobalEvents(response.body, (event) => this.handle(login.id, event));
      } catch {
        // Reconnects below.
      }
      if (signal.aborted) return;
      await sleep(delay, signal);
      delay = Math.min(delay * 2, 30_000);
    }
  }

  private watching(loginId: string, sessionId: string): Watch[] {
    return sessionId ? [...this.watches.values()].filter((watch) => watch.login.id === loginId && watch.sessionId === sessionId) : [];
  }

  private finish(loginId: string, sessionId: string): void {
    for (const watch of this.watching(loginId, sessionId)) {
      if (!watch.busy && this.now() - watch.startedAt < SETTLE_MS) continue;
      this.watches.delete(`${watch.deviceId} ${loginId} ${sessionId}`);
      // A reply you stopped yourself needs no notification.
      if (watch.error !== 'stopped') void this.notify(watch, { kind: watch.error === 'failed' ? 'failed' : 'finished' });
    }
  }

  private remember(child: string, parent: string): void {
    this.parents.set(child, parent);
    if (this.parents.size > MAX_PARENTS) {
      const oldest = this.parents.keys().next().value;
      if (oldest !== undefined) this.parents.delete(oldest);
    }
  }

  /** The session a subagent's session belongs to (itself for a top-level one). */
  private rootOf(sessionId: string): string {
    let id = sessionId;
    for (let depth = 0; depth < 8; depth++) {
      const parent = this.parents.get(id);
      if (!parent) return id;
      id = parent;
    }
    return id;
  }

  private sweep(): void {
    const since = this.now() - WATCH_MS;
    for (const [key, watch] of this.watches) if (watch.startedAt < since) this.watches.delete(key);
  }

  private async titleOf(watch: Watch): Promise<string> {
    try {
      const response = await this.options.fetch(`${watch.login.url}/session/${encodeURIComponent(watch.sessionId)}?directory=${encodeURIComponent(watch.directory)}`, {
        headers: { Authorization: basic(watch.login), Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      const title = response.ok ? text(((await response.json()) as { title?: unknown }).title).trim() : '';
      return title ? (title.length > 80 ? `${title.slice(0, 79)}…` : title) : 'A session';
    } catch {
      return 'A session';
    }
  }

  private async notify(watch: Watch, note: Note): Promise<void> {
    const title = await this.titleOf(watch);
    const where = `${title} · ${folderName(watch.directory)}`;
    const [heading, body] =
      note.kind === 'finished'
        ? ['OpenCode finished', where]
        : note.kind === 'failed'
          ? ['OpenCode couldn’t finish', where]
          : note.kind === 'question'
            ? ['OpenCode has a question', where]
            : ['OpenCode needs your approval', `${title}: ${NEEDS[note.need] ?? 'wants your OK to go on'}`];
    const message: PushMessage = {
      to: watch.pushToken,
      title: heading,
      body,
      data: { kind: 'opencode', machine: this.options.machineUrl, login: watch.login.id, sessionId: watch.sessionId, directory: watch.directory },
      threadId: watch.sessionId,
    };
    try {
      const { gone } = await this.send([message]);
      // The app was removed from that phone: its watches end.
      for (const token of gone) for (const [key, item] of this.watches) if (item.pushToken === token) this.watches.delete(key);
      this.options.log(`push: ${note.kind} sent`);
    } catch {
      this.options.log(`push: ${note.kind} not sent`);
    }
  }
}
