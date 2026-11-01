import { timingSafeEqual } from 'node:crypto';
import type { TurnWatcher } from './deeptutor.ts';
import { chatOutcome, notificationFor, testNotification, type OwuiEvent, type PushMessage } from './notification.ts';
import type { DeviceStore } from './store.ts';

export interface RelayConfig {
  /** The secret path segment Open WebUI's server-wide webhook posts to. */
  eventsSecret: string;
  /** The one Open WebUI server whose users may register. */
  owuiUrl: string;
  /** Expo's push endpoint (overridable in tests). */
  expoUrl?: string;
  /** DeepTutor reply notifications: the DeepTutor the relay serves, and its turn watcher. Off without it. */
  deeptutor?: {
    /** Where the relay reaches DeepTutor (inside the server). */
    url: string;
    /** DeepTutor's public address, as the app knows it. */
    publicUrl: string;
    watcher: TurnWatcher;
  };
}

export interface RelayRequest {
  method: string;
  path: string;
  authorization?: string;
  body: string;
  /** The caller's address, for rate limits. */
  ip: string;
}

export interface RelayResponse {
  status: number;
  body: unknown;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const PUSH_TOKEN = /^Expo(nent)?PushToken\[[\w-]+\]$/;
/** DeepTutor session and turn ids ("unified_…", "turn_…"). */
const DT_ID = /^[\w.-]{1,128}$/;
/** Expo takes at most 100 messages a request. */
const EXPO_BATCH = 100;

/** Sends through Expo; phones Apple says are gone leave the list. Resolves with how many were accepted. */
export function expoSender(fetchImpl: Fetch, store: DeviceStore, expoUrl = EXPO_PUSH_URL) {
  return async function send(messages: PushMessage[]): Promise<number> {
    let accepted = 0;
    for (let start = 0; start < messages.length; start += EXPO_BATCH) {
      const batch = messages.slice(start, start + EXPO_BATCH);
      const response = await fetchImpl(expoUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(batch),
      });
      const result = (await response.json().catch(() => undefined)) as
        | { data?: Array<{ status?: string; details?: { error?: string } }> }
        | undefined;
      batch.forEach((message, index) => {
        const ticket = result?.data?.[index];
        if (ticket?.status === 'ok') accepted += 1;
        else if (ticket?.details?.error === 'DeviceNotRegistered') store.forget(message.to);
      });
    }
    return accepted;
  };
}

const sameAddress = (a: string, b: string) => a.trim().replace(/\/+$/, '').toLowerCase() === b.trim().replace(/\/+$/, '').toLowerCase();

/** At most `limit` calls per key per minute. In memory: a restart forgets. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly now: () => number;

  constructor(limit: number, now: () => number) {
    this.limit = limit;
    this.now = now;
  }

  allow(key: string): boolean {
    const since = this.now() - 60_000;
    const recent = (this.hits.get(key) ?? []).filter((time) => time > since);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(this.now());
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.hits.clear();
    return true;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The relay's jobs:
 * - `POST /v1/devices`, `DELETE /v1/devices`: a phone signed in to Open WebUI adds or removes
 *   its Expo push token under its user id (the relay checks the sign-in with Open WebUI);
 * - `POST /v1/devices/test`: a test notification to the caller's phones;
 * - `POST /v1/events/<secret>`: Open WebUI's server-wide webhook. For each finished or failed
 *   reply the relay notifies that user's phones through Expo's push service, whatever the
 *   account's permissions.
 */
export function createRelay(config: RelayConfig, store: DeviceStore, fetchImpl: Fetch, now: () => number = Date.now) {
  const accountCalls = new RateLimiter(20, now);
  const events = new RateLimiter(600, now);
  const watchCalls = new RateLimiter(30, now);
  const owuiUrl = config.owuiUrl.replace(/\/+$/, '');
  const send = expoSender(fetchImpl, store, config.expoUrl);

  /** The Open WebUI user behind a bearer token, or a response refusing the call. */
  async function signedInUser(request: RelayRequest): Promise<string | RelayResponse> {
    if (!accountCalls.allow(request.ip)) return { status: 429, body: { error: 'Too many requests' } };
    const token = /^Bearer\s+(\S+)$/i.exec(request.authorization ?? '')?.[1];
    if (!token) return { status: 401, body: { error: 'Sign in to Open WebUI first' } };
    try {
      const response = await fetchImpl(`${owuiUrl}/api/v1/auths/`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      const id = response.ok ? ((await response.json()) as { id?: unknown }).id : undefined;
      return typeof id === 'string' && id ? id : { status: 401, body: { error: 'Open WebUI did not accept this sign-in' } };
    } catch {
      return { status: 502, body: { error: 'Could not reach Open WebUI' } };
    }
  }

  function pushTokenOf(request: RelayRequest): string | null {
    const pushToken = (parseJson(request.body) as { pushToken?: unknown } | undefined)?.pushToken;
    return typeof pushToken === 'string' && PUSH_TOKEN.test(pushToken) ? pushToken : null;
  }

  async function register(request: RelayRequest): Promise<RelayResponse> {
    const user = await signedInUser(request);
    if (typeof user !== 'string') return user;
    const pushToken = pushTokenOf(request);
    if (!pushToken) return { status: 400, body: { error: 'pushToken must be an Expo push token' } };
    store.add(user, pushToken);
    return { status: 200, body: { registered: true, lastEventAt: store.lastEventAt } };
  }

  async function unregister(request: RelayRequest): Promise<RelayResponse> {
    const user = await signedInUser(request);
    if (typeof user !== 'string') return user;
    const pushToken = pushTokenOf(request);
    if (!pushToken) return { status: 400, body: { error: 'pushToken must be an Expo push token' } };
    return { status: 200, body: { removed: store.remove(user, pushToken) } };
  }

  async function test(request: RelayRequest): Promise<RelayResponse> {
    const user = await signedInUser(request);
    if (typeof user !== 'string') return user;
    const pushToken = pushTokenOf(request);
    const tokens = store.tokensFor(user).filter((token) => !pushToken || token === pushToken);
    if (tokens.length === 0) return { status: 404, body: { error: 'This phone is not registered for notifications' } };
    try {
      const sent = await send(tokens.map(testNotification));
      return sent > 0
        ? { status: 200, body: { sent, lastEventAt: store.lastEventAt } }
        : { status: 502, body: { error: 'The push service refused the notification' } };
    } catch {
      return { status: 502, body: { error: 'Could not reach the push service' } };
    }
  }

  /**
   * `POST /v1/deeptutor/watch`: notify this phone when a DeepTutor turn ends or asks a question.
   * The DeepTutor sign-in comes as the bearer token; it must work on the DeepTutor the relay serves.
   */
  async function watchDeepTutor(request: RelayRequest): Promise<RelayResponse> {
    const deeptutor = config.deeptutor;
    if (!deeptutor) return { status: 404, body: { error: 'Not found' } };
    if (!watchCalls.allow(request.ip)) return { status: 429, body: { error: 'Too many requests' } };
    const token = /^Bearer\s+(\S+)$/i.exec(request.authorization ?? '')?.[1];
    if (!token) return { status: 401, body: { error: 'Sign in to DeepTutor first' } };
    const body = parseJson(request.body) as { pushToken?: unknown; sessionId?: unknown; turnId?: unknown; title?: unknown; server?: unknown } | undefined;
    const pushToken = typeof body?.pushToken === 'string' && PUSH_TOKEN.test(body.pushToken) ? body.pushToken : null;
    const sessionId = typeof body?.sessionId === 'string' && DT_ID.test(body.sessionId) ? body.sessionId : null;
    const turnId = typeof body?.turnId === 'string' && DT_ID.test(body.turnId) ? body.turnId : null;
    if (!pushToken || !sessionId || !turnId) return { status: 400, body: { error: 'pushToken, sessionId and turnId are required' } };
    if (typeof body?.server !== 'string' || !sameAddress(body.server, deeptutor.publicUrl)) {
      return { status: 404, body: { error: 'This relay serves another DeepTutor' } };
    }
    try {
      const response = await fetchImpl(`${deeptutor.url.replace(/\/+$/, '')}/api/auth/status`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      const status = response.ok ? ((await response.json()) as { authenticated?: unknown }) : null;
      if (status?.authenticated !== true) return { status: 401, body: { error: 'DeepTutor did not accept this sign-in' } };
    } catch {
      return { status: 502, body: { error: 'Could not reach DeepTutor' } };
    }
    const title = typeof body.title === 'string' ? body.title.replace(/\s+/g, ' ').trim().slice(0, 80) || null : null;
    const outcome = deeptutor.watcher.watch({ pushToken, sessionId, turnId, title, token });
    return outcome === 'full' ? { status: 503, body: { error: 'Too many replies watched right now' } } : { status: 202, body: { watching: true } };
  }

  async function event(secret: string, request: RelayRequest): Promise<RelayResponse> {
    if (!sameSecret(secret, config.eventsSecret)) return { status: 404, body: { error: 'Not found' } };
    if (!events.allow('events')) return { status: 429, body: { error: 'Too many requests' } };
    store.noteEvent();
    const body = parseJson(request.body);
    const outcome = typeof body === 'object' && body !== null ? chatOutcome(body as OwuiEvent) : null;
    if (!outcome) return { status: 202, body: { ignored: true } };
    const tokens = store.tokensFor(outcome.userId);
    if (tokens.length === 0) return { status: 202, body: { ignored: true } };
    try {
      return { status: 200, body: { sent: await send(tokens.map((token) => notificationFor(outcome, token))) } };
    } catch {
      return { status: 502, body: { error: 'Could not reach the push service' } };
    }
  }

  return async function handle(request: RelayRequest): Promise<RelayResponse> {
    if (request.method === 'GET' && request.path === '/health') return { status: 200, body: { ok: true } };
    if (request.path === '/v1/devices' && request.method === 'POST') return register(request);
    if (request.path === '/v1/devices' && request.method === 'DELETE') return unregister(request);
    if (request.path === '/v1/devices/test' && request.method === 'POST') return test(request);
    if (request.path === '/v1/deeptutor/watch' && request.method === 'POST') return watchDeepTutor(request);
    const secret = /^\/v1\/events\/([\w-]+)$/.exec(request.path)?.[1];
    if (secret && request.method === 'POST') return event(secret, request);
    return { status: 404, body: { error: 'Not found' } };
  };
}
