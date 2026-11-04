import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { checkRequest, withApprovals } from './rules.ts';
import { isPushToken } from './push.ts';
import { cleanAgents, cleanConfig, cleanProviders, defaultModelPatch, eventFilter } from './sanitize.ts';
import type { DeviceStore } from './store.ts';
import type { Watcher } from './watch.ts';

/** Answers cut down before they reach the phone: provider API keys, agent prompts, the config but its default model. */
const CLEANERS = new Map<string, (body: unknown) => unknown>([
  ['/config/providers', cleanProviders],
  ['/config', cleanConfig],
  ['/global/config', cleanConfig],
  ['/agent', cleanAgents],
]);

/** OpenCode's settings: their answers and errors never reach the phone as they came. */
const SETTINGS = new Set(['/config', '/global/config']);

/** An OpenCode server on this machine, as one login the app can pick. */
export interface Login {
  id: string;
  name: string;
  url: string;
  username: string;
  password: string;
}

export interface GatewayConfig {
  machineName: string;
  publicUrl: string;
  /** Project folders OpenCode may work in from the phone. */
  folders: string[];
  logins: Login[];
  log: (line: string) => void;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Prompts may carry photos as data URLs. */
const MAX_BODY = 20 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;

/** Too many wrong tokens from one address locks it out for a while. */
export class Lockout {
  private readonly failures = new Map<string, number[]>();
  private readonly lockedUntil = new Map<string, number>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly lockMs: number;
  private readonly now: () => number;

  constructor(limit: number, windowMs: number, lockMs: number, now: () => number) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.lockMs = lockMs;
    this.now = now;
  }

  locked(key: string): boolean {
    const until = this.lockedUntil.get(key);
    if (until === undefined) return false;
    if (until > this.now()) return true;
    this.lockedUntil.delete(key);
    return false;
  }

  fail(key: string): void {
    const since = this.now() - this.windowMs;
    const recent = [...(this.failures.get(key) ?? []).filter((time) => time > since), this.now()];
    this.failures.set(key, recent);
    if (recent.length >= this.limit) {
      this.lockedUntil.set(key, this.now() + this.lockMs);
      this.failures.delete(key);
    }
    if (this.failures.size > 10_000) this.failures.clear();
  }

  succeed(key: string): void {
    this.failures.delete(key);
  }
}

function readBody(request: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY) chunks.push(chunk);
    });
    request.on('end', () => resolve(size > MAX_BODY ? null : Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function parseJson(buffer: Buffer): unknown {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    return undefined;
  }
}

/** How the gateway signs in to one of this machine's OpenCode servers. */
export const basic = (login: Login) => `Basic ${Buffer.from(`${login.username}:${login.password}`).toString('base64')}`;

/**
 * The gateway's jobs:
 * - `POST /v1/pair`: a pairing code (from `maviechat-gateway pair`) becomes a device token;
 * - `GET /v1/machine`, `GET /v1/devices`, `DELETE /v1/devices/:id`: what's on this machine, and
 *   the paired phones;
 * - `/v1/oc/:login/…`: OpenCode's API for that login, limited by `rules.ts`, with OpenCode's
 *   password added here so the phone never holds it.
 * Every `/v1` call but pairing needs `Authorization: Bearer <device token>`. A prompt that carries
 * the phone's push token (`x-maviechat-push`) has its session watched for notifications (watch.ts).
 */
export function createGateway(config: GatewayConfig, store: DeviceStore, fetchImpl: Fetch, now: () => number = Date.now, watcher: Watcher | null = null) {
  const lockout = new Lockout(10, 10 * 60_000, 15 * 60_000, now);
  const pairing = new Lockout(5, 60_000, 5 * 60_000, now);

  return async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const started = now();
    const url = new URL(request.url ?? '/', 'http://gateway');
    const method = request.method ?? 'GET';
    // Traefik is the only way in, so its X-Forwarded-For names the caller.
    const ip = String(request.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim() || request.socket.remoteAddress || 'unknown';
    let label = url.pathname.startsWith('/v1/') ? '/v1/…' : url.pathname;

    // Never logs tokens, query strings or message text.
    const finish = (status: number) => config.log(`${method} ${label} ${status} ${now() - started}ms`);
    const reply = (status: number, body: unknown) => {
      if (!response.headersSent) response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(body));
      finish(status);
    };

    if (method === 'GET' && url.pathname === '/health') {
      label = '/health';
      return reply(200, { ok: true });
    }

    if (method === 'POST' && url.pathname === '/v1/pair') {
      label = '/v1/pair';
      if (pairing.locked(ip)) return reply(429, { error: 'Too many tries. Wait a few minutes.' });
      const body = await readBody(request);
      const input = body ? (parseJson(body) as { code?: unknown; deviceName?: unknown } | undefined) : undefined;
      const code = typeof input?.code === 'string' ? input.code : '';
      const result = code ? store.redeem(code, typeof input?.deviceName === 'string' ? input.deviceName : 'iPhone') : null;
      if (!result) {
        pairing.fail(ip);
        return reply(401, { error: 'That pairing code is wrong, used or expired. Run `maviechat-gateway pair` again.' });
      }
      pairing.succeed(ip);
      return reply(200, { deviceId: result.device.id, token: result.token, machine: { name: config.machineName, url: config.publicUrl } });
    }

    if (!url.pathname.startsWith('/v1/')) return reply(404, { error: 'Not found' });

    if (lockout.locked(ip)) return reply(429, { error: 'Too many wrong tokens from here. Wait a few minutes.' });
    const authorization = String(request.headers.authorization ?? '');
    const device = authorization.startsWith('Bearer ') ? store.authenticate(authorization.slice(7).trim()) : null;
    if (!device) {
      lockout.fail(ip);
      return reply(401, { error: 'This phone is not paired with this machine any more. Pair it again.' });
    }
    lockout.succeed(ip);

    if (method === 'GET' && url.pathname === '/v1/machine') {
      label = '/v1/machine';
      const logins = await Promise.all(
        config.logins.map(async (login) => {
          let version: string | null = null;
          try {
            const health = await fetchImpl(`${login.url}/global/health`, { headers: { Authorization: basic(login) }, signal: AbortSignal.timeout(5000) });
            const value = (await health.json()) as { version?: unknown };
            version = health.ok && typeof value.version === 'string' ? value.version : null;
          } catch {
            version = null;
          }
          return { id: login.id, name: login.name, version, online: version !== null };
        }),
      );
      return reply(200, { name: config.machineName, url: config.publicUrl, folders: config.folders, logins, device: { id: device.id, name: device.name } });
    }

    if (method === 'GET' && url.pathname === '/v1/devices') {
      label = '/v1/devices';
      return reply(
        200,
        store.list().map((item) => ({ id: item.id, name: item.name, createdAt: item.createdAt, lastSeenAt: item.lastSeenAt, current: item.id === device.id })),
      );
    }

    const revoke = /^\/v1\/devices\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
    if (method === 'DELETE' && revoke?.[1]) {
      label = '/v1/devices/:id';
      if (!store.revoke(revoke[1])) return reply(404, { error: 'No such device' });
      watcher?.forgetDevice(revoke[1]);
      return reply(200, { revoked: true });
    }

    const forwarded = /^\/v1\/oc\/([A-Za-z0-9_-]{1,64})(\/.*)$/.exec(url.pathname);
    const login = forwarded ? config.logins.find((item) => item.id === forwarded[1]) : undefined;
    if (!forwarded?.[2] || !login) return reply(404, { error: 'Not found' });
    const verdict = checkRequest(method, forwarded[2], url.searchParams, config.folders);
    label = `/v1/oc/${login.id}${verdict.label}`;
    if (!verdict.ok) return reply(verdict.status, { error: verdict.error });

    let body: Buffer | null = null;
    if (method === 'POST' || method === 'PATCH') {
      body = await readBody(request);
      if (!body) return reply(413, { error: 'Too large' });
      if (method === 'POST' && forwarded[2] === '/session') {
        const approvals = String(request.headers['x-maviechat-approvals'] ?? '') || undefined;
        body = Buffer.from(JSON.stringify(withApprovals(body.length ? parseJson(body) : {}, approvals)));
      }
      // The phone may change one setting, the default model: nothing else in the body goes on.
      if (method === 'PATCH' && forwarded[2] === '/global/config') {
        const patch = defaultModelPatch(parseJson(body));
        if (!patch) return reply(400, { error: 'That isn’t a model name (provider/model).' });
        body = Buffer.from(JSON.stringify(patch));
      }
    }

    // A prompt from a phone that wants notifications: its session is watched from now on.
    const prompt = method === 'POST' ? /^\/session\/([A-Za-z0-9_-]+)\/prompt_async$/.exec(forwarded[2]) : null;
    const pushToken = request.headers['x-maviechat-push'];
    const unwatch =
      watcher && prompt?.[1] && isPushToken(pushToken)
        ? watcher.watch({ deviceId: device.id, pushToken, loginId: login.id, sessionId: prompt[1], directory: url.searchParams.get('directory') ?? '' })
        : null;

    const streaming = forwarded[2] === '/event';
    const controller = new AbortController();
    const timer = streaming ? null : setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    response.on('close', () => controller.abort());
    let upstream: Response;
    try {
      upstream = await fetchImpl(`${login.url}${forwarded[2]}${url.search}`, {
        method,
        headers: {
          Authorization: basic(login),
          Accept: String(request.headers.accept ?? (streaming ? 'text/event-stream' : 'application/json')),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ?? undefined,
        signal: controller.signal,
      });
    } catch {
      if (timer) clearTimeout(timer);
      unwatch?.();
      return reply(502, { error: `OpenCode (${login.name}) isn't answering on this machine.` });
    }
    if (unwatch && !upstream.ok) unwatch();

    // Answers that carry more than the phone should hold are cut down here. Not even an error
    // from the settings routes is passed on as it came.
    const settings = SETTINGS.has(forwarded[2]);
    const clean = method === 'GET' || settings ? CLEANERS.get(forwarded[2]) : undefined;
    if (clean && (upstream.ok || settings)) {
      if (timer) clearTimeout(timer);
      if (!upstream.ok) {
        await upstream.body?.cancel().catch(() => undefined);
        return reply(upstream.status, { error: `OpenCode (${login.name}) couldn't ${method === 'GET' ? 'read' : 'change'} its settings.` });
      }
      let body: unknown;
      try {
        body = clean(await upstream.json());
      } catch {
        return reply(502, { error: `OpenCode (${login.name}) answered oddly.` });
      }
      return reply(upstream.status, body);
    }

    const headers: Record<string, string> = { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store' };
    if (streaming) headers['X-Accel-Buffering'] = 'no';
    response.writeHead(upstream.status, headers);
    if (!upstream.body) {
      if (timer) clearTimeout(timer);
      response.end();
      return finish(upstream.status);
    }
    if (streaming) config.log(`${method} ${label} ${upstream.status} open`);
    // The event stream only carries the kinds of event the app uses.
    const source = streaming && upstream.ok ? upstream.body.pipeThrough(eventFilter()) : upstream.body;
    const stream = Readable.fromWeb(source as unknown as WebReadableStream<Uint8Array>);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
    response.on('close', () => {
      if (timer) clearTimeout(timer);
      stream.destroy();
      finish(upstream.status);
    });
  };
}

/**
 * The admin side, for `maviechat-gateway` inside the container only (it listens on 127.0.0.1):
 * a new pairing code and link, the paired devices, and revoking one.
 */
export function createAdmin(config: GatewayConfig, store: DeviceStore, watcher: Watcher | null = null) {
  return async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://admin');
    const reply = (status: number, body: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.method === 'POST' && url.pathname === '/admin/pair') {
      const { code, expiresAt } = store.createPairing();
      const link = `maviechat://pair?url=${encodeURIComponent(config.publicUrl)}&code=${encodeURIComponent(code)}`;
      return reply(200, { code, expiresAt, link, machine: config.machineName, url: config.publicUrl });
    }
    if (request.method === 'GET' && url.pathname === '/admin/devices') return reply(200, store.list().map(({ tokenHash: _hash, ...rest }) => rest));
    const revoke = /^\/admin\/devices\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
    if (request.method === 'DELETE' && revoke?.[1]) {
      if (!store.revoke(revoke[1])) return reply(404, {});
      watcher?.forgetDevice(revoke[1]);
      return reply(200, {});
    }
    return reply(404, { error: 'Not found' });
  };
}
