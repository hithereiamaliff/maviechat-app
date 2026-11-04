export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OcClientOptions {
  /** The gateway's address, e.g. `https://code.example.com`. */
  gatewayUrl: string;
  /** The device token from pairing. */
  token: string;
  /** Which OpenCode server on the machine (the gateway's login id). */
  login: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

/** The gateway or OpenCode answered with an error status. */
export class OcHttpError extends Error {
  readonly status: number;
  readonly detail: string | undefined;
  readonly path: string;

  constructor(status: number, detail: string | undefined, path: string) {
    super(detail ? `${detail} (HTTP ${status})` : `HTTP ${status} from ${path}`);
    this.name = 'OcHttpError';
    this.status = status;
    this.detail = detail;
    this.path = path;
  }

  /** The phone isn't paired with that machine any more (revoked, or the gateway was reset). */
  get isUnpaired(): boolean {
    return this.status === 401;
  }
}

/** No answer at all: offline, DNS, TLS, timeout or abort. */
export class OcNetworkError extends Error {
  readonly path: string;
  readonly timedOut: boolean;

  constructor(path: string, cause: unknown, timedOut: boolean) {
    super(timedOut ? `Timed out waiting for ${path}` : `Could not reach the machine (${cause instanceof Error ? cause.message : String(cause)})`);
    this.name = 'OcNetworkError';
    this.path = path;
    this.timedOut = timedOut;
  }
}

export type QueryValue = string | number | boolean | null | undefined;

export interface OcRequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

async function errorDetail(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown; data?: { message?: unknown } };
    const detail = body.error ?? body.message ?? body.data?.message;
    return typeof detail === 'string' ? detail : undefined;
  } catch {
    return undefined;
  }
}

/** Requests to one OpenCode login through the gateway, signed in with the device token. */
export class OcClient {
  readonly gatewayUrl: string;
  readonly login: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: OcClientOptions) {
    this.gatewayUrl = options.gatewayUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.login = options.login;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** A gateway address: `/v1/machine`, or OpenCode's own paths under `/v1/oc/<login>`. */
  url(path: string, query?: Record<string, QueryValue>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== null) search.set(key, String(value));
    const text = search.toString();
    return `${this.gatewayUrl}${path}${text ? `?${text}` : ''}`;
  }

  /** Headers that sign a request in (also for the event stream, which is read elsewhere). */
  authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` };
  }

  async request<T>(method: string, path: string, options: OcRequestOptions = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort);
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path, options.query), {
        method,
        headers: {
          ...this.authHeaders(),
          Accept: 'application/json',
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...options.headers,
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      throw new OcNetworkError(path, error, controller.signal.aborted && !options.signal?.aborted);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    }
    if (!response.ok) throw new OcHttpError(response.status, await errorDetail(response), path);
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** OpenCode's own route for this login, e.g. `/session`. */
  oc<T>(method: string, path: string, options: OcRequestOptions = {}): Promise<T> {
    return this.request<T>(method, `/v1/oc/${encodeURIComponent(this.login)}${path}`, options);
  }
}
