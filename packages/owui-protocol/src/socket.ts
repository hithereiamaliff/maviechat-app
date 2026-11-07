import { io } from 'socket.io-client';

/** Server → client envelope on the `events` socket event. */
export interface ChatEventEnvelope {
  chat_id?: string;
  message_id?: string;
  data: { type: string; data?: unknown };
  [key: string]: unknown;
}

export interface JoinedUser {
  id: string;
  name: string;
}

export type SocketStatus = 'connecting' | 'joined' | 'reconnecting' | 'closed';

/** The part of socket.io-client's `Socket` this module uses (a fake implements it in tests). */
export interface SocketLike {
  readonly id?: string | undefined;
  readonly connected: boolean;
  on(event: string, listener: (...args: never[]) => void): unknown;
  off(event: string, listener?: (...args: never[]) => void): unknown;
  emit(event: string, ...args: unknown[]): unknown;
  timeout(ms: number): { emit(event: string, ...args: unknown[]): unknown };
  disconnect(): unknown;
}

export interface SocketSessionOptions {
  baseUrl: string;
  token: string;
  /** User id from `GET /api/v1/auths/`. A `user-join` answer for anyone else closes the session. */
  expectedUserId?: string;
  /** `Capabilities.websocketOnly`. */
  websocketOnly?: boolean;
  /** `Capabilities.heartbeatIntervalSec` (the web app's default is 30). */
  heartbeatIntervalSec?: number;
  joinTimeoutMs?: number;
  onStatus?: (status: SocketStatus, detail?: string) => void;
  /** Replaces socket.io-client in tests. */
  connect?: (url: string, options: Record<string, unknown>) => SocketLike;
}

export interface SocketSession {
  /** Resolves after the first successful `user-join`; rejects if the server refuses or the session closes first. */
  readonly joined: Promise<JoinedUser>;
  readonly status: SocketStatus;
  /** The socket id, sent as `session_id` with chat completions so replies stream here. */
  readonly sessionId: string | undefined;
  /**
   * Chat events for every chat of this user (from any device). `reply` is set when the
   * server waits for an answer (confirmation, input, execute, …) and must then be called.
   */
  onChatEvent(listener: (event: ChatEventEnvelope, reply?: (response: unknown) => void) => void): () => void;
  /**
   * Tells the server you've read a chat (the sidebar's unread dot, here and on the web).
   * Sent once the socket has joined; until then the latest requests wait.
   */
  markRead(chatId: string): void;
  /**
   * Follows a note: its changes (`events:note`, from the web or another device, with only what
   * changed) come to `listener` until the returned function is called. The server keeps the socket
   * in the note's room until it disconnects; after a reconnect the note is joined again.
   */
  watchNote(noteId: string, listener: (change: unknown) => void): () => void;
  close(): void;
}

const defaultConnect = (url: string, options: Record<string, unknown>): SocketLike => io(url, options);

/**
 * Opens the Socket.IO session the way Open WebUI's web app does (0.11.3 ✓):
 * path `/ws/socket.io`, `auth: {token}`, then `user-join` on every (re)connect
 * and a `heartbeat` while connected.
 */
export function openSocketSession(options: SocketSessionOptions): SocketSession {
  const socket = (options.connect ?? defaultConnect)(options.baseUrl, {
    path: '/ws/socket.io',
    transports: options.websocketOnly === false ? ['polling', 'websocket'] : ['websocket'],
    auth: { token: options.token },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    randomizationFactor: 0.5,
  });

  let status: SocketStatus = 'connecting';
  let closed = false;
  let settled = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const chatListeners = new Set<(event: ChatEventEnvelope, reply?: (response: unknown) => void) => void>();

  let resolveJoined: (user: JoinedUser) => void = () => {};
  let rejectJoined: (error: Error) => void = () => {};
  const joined = new Promise<JoinedUser>((resolve, reject) => {
    resolveJoined = resolve;
    rejectJoined = reject;
  });
  // Callers may ignore `joined`; don't let a rejection go unhandled.
  joined.catch(() => {});

  const setStatus = (next: SocketStatus, detail?: string) => {
    status = next;
    options.onStatus?.(next, detail);
  };

  const fail = (message: string) => {
    if (!settled) {
      settled = true;
      rejectJoined(new Error(message));
    }
    options.onStatus?.(status, message);
  };

  const stopHeartbeat = () => {
    if (heartbeat !== undefined) clearInterval(heartbeat);
    heartbeat = undefined;
  };

  const startHeartbeat = () => {
    stopHeartbeat();
    const seconds = options.heartbeatIntervalSec ?? 30;
    heartbeat = setInterval(() => {
      if (socket.connected) socket.emit('heartbeat', {});
    }, seconds * 1000);
  };

  // Notes followed, joined again after a reconnect. 0.11 joins a note's room with `join-note`, 0.12
  // with `note:join` (and leaves with `note:leave`); each ignores the other's, so both go.
  const notes = new Map<string, Set<(change: unknown) => void>>();
  const joinNote = (noteId: string) => {
    const payload = { note_id: noteId, auth: { token: options.token } };
    socket.emit('join-note', payload);
    socket.emit('note:join', payload);
  };
  const onNote = (payload: unknown) => {
    const id = typeof payload === 'object' && payload !== null ? (payload as { id?: unknown }).id : undefined;
    if (typeof id !== 'string') return;
    for (const listener of notes.get(id) ?? []) listener(payload);
  };

  // The server ignores events from a socket that hasn't joined yet, so reads wait for the join.
  const unsentReads = new Set<string>();
  const flushReads = () => {
    for (const chatId of unsentReads) socket.emit('events:chat', { chat_id: chatId, data: { type: 'last_read_at' } });
    unsentReads.clear();
  };

  const join = () => {
    socket
      .timeout(options.joinTimeoutMs ?? 10_000)
      .emit('user-join', { auth: { token: options.token } }, (error: unknown, ack: unknown) => {
        if (closed) return;
        if (error) {
          fail('The server did not answer the socket sign-in in time');
          return;
        }
        if (!isJoinedUser(ack)) {
          fail('The server refused the socket sign-in');
          return;
        }
        if (options.expectedUserId && ack.id !== options.expectedUserId) {
          fail('The socket signed in as a different user');
          close();
          return;
        }
        setStatus('joined');
        flushReads();
        for (const noteId of notes.keys()) joinNote(noteId);
        if (!settled) {
          settled = true;
          resolveJoined(ack);
        }
      });
  };

  const onConnect = () => {
    join();
    startHeartbeat();
  };
  const onDisconnect = () => {
    stopHeartbeat();
    if (!closed) setStatus('reconnecting');
  };
  const onConnectError = (error: unknown) => {
    if (!closed) options.onStatus?.(status, error instanceof Error ? error.message : String(error));
  };
  const onEvents = (payload: unknown, ack?: unknown) => {
    if (!isEnvelope(payload)) return;
    const reply = typeof ack === 'function' ? (ack as (response: unknown) => void) : undefined;
    for (const listener of chatListeners) listener(payload, reply);
  };

  socket.on('connect', onConnect);
  socket.on('disconnect', onDisconnect);
  socket.on('connect_error', onConnectError);
  socket.on('events', onEvents);
  socket.on('events:note', onNote);

  function close() {
    if (closed) return;
    closed = true;
    stopHeartbeat();
    chatListeners.clear();
    socket.off('connect', onConnect);
    socket.off('disconnect', onDisconnect);
    socket.off('connect_error', onConnectError);
    socket.off('events', onEvents);
    socket.off('events:note', onNote);
    socket.disconnect();
    setStatus('closed');
    if (!settled) {
      settled = true;
      rejectJoined(new Error('The socket session was closed'));
    }
  }

  return {
    joined,
    get status() {
      return status;
    },
    get sessionId() {
      return socket.id;
    },
    onChatEvent(listener) {
      chatListeners.add(listener);
      return () => chatListeners.delete(listener);
    },
    markRead(chatId) {
      if (closed) return;
      unsentReads.add(chatId);
      if (status === 'joined' && socket.connected) flushReads();
    },
    watchNote(noteId, listener) {
      const listeners = notes.get(noteId) ?? new Set<(change: unknown) => void>();
      const first = listeners.size === 0;
      listeners.add(listener);
      notes.set(noteId, listeners);
      if (first && !closed && status === 'joined' && socket.connected) joinNote(noteId);
      return () => {
        listeners.delete(listener);
        if (listeners.size) return;
        notes.delete(noteId);
        if (!closed && socket.connected) socket.emit('note:leave', { note_id: noteId });
      };
    },
    close,
  };
}

function isJoinedUser(value: unknown): value is JoinedUser {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as JoinedUser).id === 'string' &&
    typeof (value as JoinedUser).name === 'string'
  );
}

function isEnvelope(value: unknown): value is ChatEventEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const data = (value as { data?: unknown }).data;
  return typeof data === 'object' && data !== null && typeof (data as { type?: unknown }).type === 'string';
}
