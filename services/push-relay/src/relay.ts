import { createHash } from 'node:crypto';
import { pushFor, type WebhookBody } from './notification.ts';
import { seal, unseal } from './seal.ts';

export interface RelayConfig {
  key: Buffer;
  /** This relay's public address, e.g. `https://push.example.com`. */
  publicUrl: string;
  /** The one Open WebUI server whose users may register. */
  owuiUrl: string;
  /** Expo's push endpoint (overridable in tests). */
  expoUrl?: string;
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

/**
 * The relay's two jobs:
 * - `POST /v1/devices`: a phone signed in to Open WebUI trades its Expo push token for a
 *   webhook link (the token sealed inside, so nothing is stored here);
 * - `POST /v1/hooks/<sealed>`: Open WebUI calls that link when a reply finishes, and the
 *   relay sends the notification through Expo's push service.
 */
export function createRelay(config: RelayConfig, fetchImpl: Fetch, now: () => number = Date.now) {
  const registrations = new RateLimiter(10, now);
  const hooks = new RateLimiter(120, now);
  const owuiUrl = config.owuiUrl.replace(/\/+$/, '');
  const publicUrl = config.publicUrl.replace(/\/+$/, '');

  async function register(request: RelayRequest): Promise<RelayResponse> {
    if (!registrations.allow(request.ip)) return { status: 429, body: { error: 'Too many requests' } };
    const token = /^Bearer\s+(\S+)$/i.exec(request.authorization ?? '')?.[1];
    if (!token) return { status: 401, body: { error: 'Sign in to Open WebUI first' } };
    const pushToken = (parseJson(request.body) as { pushToken?: unknown } | undefined)?.pushToken;
    if (typeof pushToken !== 'string' || !PUSH_TOKEN.test(pushToken)) return { status: 400, body: { error: 'pushToken must be an Expo push token' } };

    let userId: unknown;
    try {
      const response = await fetchImpl(`${owuiUrl}/api/v1/auths/`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      if (!response.ok) return { status: 401, body: { error: 'Open WebUI did not accept this sign-in' } };
      userId = ((await response.json()) as { id?: unknown }).id;
    } catch {
      return { status: 502, body: { error: 'Could not reach Open WebUI' } };
    }
    if (typeof userId !== 'string' || !userId) return { status: 401, body: { error: 'Open WebUI did not accept this sign-in' } };
    return { status: 200, body: { webhookUrl: `${publicUrl}/v1/hooks/${seal(config.key, { pushToken, userId })}` } };
  }

  async function deliver(sealed: string, request: RelayRequest): Promise<RelayResponse> {
    const target = unseal(config.key, sealed);
    if (!target) return { status: 404, body: { error: 'Unknown link' } };
    if (!hooks.allow(createHash('sha256').update(sealed).digest('hex'))) return { status: 429, body: { error: 'Too many requests' } };
    const body = parseJson(request.body);
    const message = typeof body === 'object' && body !== null ? pushFor(body as WebhookBody, target.pushToken) : null;
    if (!message) return { status: 202, body: { ignored: true } };

    try {
      const response = await fetchImpl(config.expoUrl ?? EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify([message]),
      });
      const result = (await response.json().catch(() => undefined)) as
        | { data?: Array<{ status?: string; details?: { error?: string } }> }
        | undefined;
      const ticket = result?.data?.[0];
      if (response.ok && ticket?.status === 'ok') return { status: 200, body: { sent: true } };
      // The app was removed or its notifications revoked: the phone must register again.
      if (ticket?.details?.error === 'DeviceNotRegistered') return { status: 410, body: { error: 'This phone no longer accepts notifications' } };
      return { status: 502, body: { error: 'The push service refused the notification' } };
    } catch {
      return { status: 502, body: { error: 'Could not reach the push service' } };
    }
  }

  return async function handle(request: RelayRequest): Promise<RelayResponse> {
    if (request.method === 'GET' && request.path === '/health') return { status: 200, body: { ok: true } };
    if (request.method === 'POST' && request.path === '/v1/devices') return register(request);
    const hook = /^\/v1\/hooks\/([\w-]+)$/.exec(request.path);
    if (request.method === 'POST' && hook?.[1]) return deliver(hook[1], request);
    return { status: 404, body: { error: 'Not found' } };
  };
}
