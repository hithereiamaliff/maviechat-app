export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type QueryValue = string | number | boolean | null | undefined;

export interface DtClientOptions {
  /** The address of DeepTutor's web front end, e.g. `https://learn.example.com`. The API lives behind it. */
  baseUrl: string;
  /** The sign-in token, sent as `Authorization: Bearer`. Without one, the platform's cookie store carries the sign-in. */
  token?: string | null;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export interface DtRequestOptions {
  query?: Record<string, QueryValue>;
  /** JSON, or a `FormData` sent as multipart (uploads). */
  body?: unknown;
  signal?: AbortSignal;
  /** Longer than the client's default for uploads. */
  timeoutMs?: number;
}

/** DeepTutor answered with an error status. `detail` is its message when it sent one. */
export class DtHttpError extends Error {
  readonly status: number;
  readonly detail: string | undefined;
  readonly path: string;
  /** DeepTutor's own name for the error, when it sends one (`book_revision_conflict`, `book_paused`…). */
  readonly code: string | undefined;
  /** The answer as DeepTutor sent it (some carry details by field). */
  readonly body: unknown;

  constructor(status: number, detail: string | undefined, path: string, code?: string, body?: unknown) {
    super(detail ? `${detail} (HTTP ${status})` : `HTTP ${status} from ${path}`);
    this.name = 'DtHttpError';
    this.status = status;
    this.detail = detail;
    this.path = path;
    this.code = code;
    this.body = body;
  }

  /** The sign-in is missing or no longer accepted. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

/** No HTTP answer at all: offline, DNS, TLS, timeout or abort. */
export class DtNetworkError extends Error {
  readonly path: string;
  readonly timedOut: boolean;

  constructor(path: string, cause: unknown, timedOut: boolean) {
    super(timedOut ? `Timed out waiting for ${path}` : `Could not reach DeepTutor (${cause instanceof Error ? cause.message : String(cause)})`);
    this.name = 'DtNetworkError';
    this.path = path;
    this.timedOut = timedOut;
  }
}

/** Accepts an address as typed (spaces, trailing slashes) and checks it is http(s). */
export function normalizeDtUrl(input: string): string {
  const address = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+/i.test(address)) throw new Error('Enter the DeepTutor address starting with https:// or http://');
  return address;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** A small JSON client for DeepTutor's REST API, reached through its web front end. */
export class DtClient {
  readonly baseUrl: string;
  readonly token: string | null;
  private readonly options: DtClientOptions;
  private readonly fetchImpl: FetchLike;

  constructor(options: DtClientOptions) {
    this.options = options;
    this.baseUrl = normalizeDtUrl(options.baseUrl);
    this.token = options.token ?? null;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  withToken(token: string | null): DtClient {
    return new DtClient({ ...this.options, token });
  }

  url(path: string, query?: Record<string, QueryValue>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) params.set(key, String(value));
    }
    const search = params.toString();
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}${search ? `?${search}` : ''}`;
  }

  async get<T>(path: string, options?: Omit<DtRequestOptions, 'body'>): Promise<T> {
    return (await this.send<T>('GET', path, options)).data;
  }

  async post<T>(path: string, body?: unknown, options?: Omit<DtRequestOptions, 'body'>): Promise<T> {
    return (await this.send<T>('POST', path, { ...options, body })).data;
  }

  async delete<T>(path: string, options?: Omit<DtRequestOptions, 'body'>): Promise<T> {
    return (await this.send<T>('DELETE', path, options)).data;
  }

  /** Sends a request and keeps the response headers (sign-in reads its cookie from them). */
  async send<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, options: DtRequestOptions = {}): Promise<{ data: T; headers: Headers }> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let body: string | FormData | undefined;
    if (typeof FormData !== 'undefined' && options.body instanceof FormData) {
      // fetch sets the multipart boundary itself.
      body = options.body;
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const forwardAbort = () => controller.abort();
    options.signal?.addEventListener('abort', forwardAbort);

    let response: Response;
    try {
      // `include`: on iOS the sign-in cookie then lands in the shared cookie store, where the web view finds it.
      response = await this.fetchImpl(this.url(path, options.query), { method, headers, body, signal: controller.signal, credentials: 'include' });
    } catch (error) {
      throw new DtNetworkError(path, error, timedOut);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', forwardAbort);
    }

    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = text;
    }
    if (!response.ok) throw new DtHttpError(response.status, detailOf(data), path, codeOf(data), data);
    return { data: data as T, headers: response.headers };
  }
}

/** FastAPI errors: `{detail: "text"}`, `{detail: [{msg}]}` when the input was invalid, or `{detail: {code, message}}`. */
function detailOf(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null || !('detail' in data)) return undefined;
  const { detail } = data as { detail: unknown };
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const messages = detail.flatMap((item) => (typeof item === 'object' && item !== null && 'msg' in item ? [String((item as { msg: unknown }).msg)] : []));
    return messages.length ? messages.join('; ') : undefined;
  }
  if (typeof detail === 'object' && detail !== null) {
    const { message, code } = detail as { message?: unknown; code?: unknown };
    if (typeof message === 'string' && message) return message;
    if (typeof code === 'string' && code) return code;
  }
  return undefined;
}

function codeOf(data: unknown): string | undefined {
  const detail = typeof data === 'object' && data !== null && 'detail' in data ? (data as { detail: unknown }).detail : undefined;
  const code = typeof detail === 'object' && detail !== null && !Array.isArray(detail) ? (detail as { code?: unknown }).code : undefined;
  return typeof code === 'string' && code ? code : undefined;
}
