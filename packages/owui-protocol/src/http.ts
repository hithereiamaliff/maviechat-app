export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type QueryValue = string | number | boolean | null | undefined;

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface OwuiClientOptions {
  /** Server root, e.g. `https://chat.example.com`. Trailing slashes are removed. */
  baseUrl: string;
  /** Session JWT sent as `Authorization: Bearer`. */
  token?: string | null;
  /** Extra headers sent with every request (e.g. for a reverse proxy). */
  headers?: Record<string, string>;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** Multipart body (uploads). */
  form?: FormData;
  signal?: AbortSignal;
  /** Overrides the client's timeout for this request (uploads can be slow). */
  timeoutMs?: number;
  /** Headers for this request only (an `Accept` other than JSON, say). */
  headers?: Record<string, string>;
}

/** A non-2xx answer from the server. `detail` is Open WebUI's error text when it sent one. */
export class OwuiHttpError extends Error {
  readonly status: number;
  readonly detail: string | undefined;
  readonly path: string;

  constructor(status: number, detail: string | undefined, path: string) {
    super(detail ? `${detail} (HTTP ${status})` : `HTTP ${status} from ${path}`);
    this.name = 'OwuiHttpError';
    this.status = status;
    this.detail = detail;
    this.path = path;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

/** The request never got an HTTP answer: offline, DNS, TLS, timeout or abort. */
export class OwuiNetworkError extends Error {
  readonly path: string;
  readonly timedOut: boolean;

  constructor(path: string, cause: unknown, timedOut: boolean) {
    super(timedOut ? `Timed out waiting for ${path}` : `Could not reach the server (${describe(cause)})`);
    this.name = 'OwuiNetworkError';
    this.path = path;
    this.timedOut = timedOut;
  }
}

export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+/i.test(trimmed)) {
    throw new Error('Enter the server address starting with https:// or http://');
  }
  return trimmed;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class OwuiClient {
  readonly baseUrl: string;
  readonly token: string | null;
  private readonly options: OwuiClientOptions;
  private readonly fetchImpl: FetchLike;

  constructor(options: OwuiClientOptions) {
    this.options = options;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.token = options.token ?? null;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  withToken(token: string | null): OwuiClient {
    return new OwuiClient({ ...this.options, token });
  }

  url(path: string, query?: Record<string, QueryValue>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) search.set(key, String(value));
    }
    const qs = search.toString();
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}${qs ? `?${qs}` : ''}`;
  }

  get<T>(path: string, options?: Omit<RequestOptions, 'body'>): Promise<T> {
    return this.request<T>('GET', path, options);
  }

  post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<T> {
    return this.request<T>('POST', path, { ...options, body });
  }

  delete<T>(path: string, options?: Omit<RequestOptions, 'body'>): Promise<T> {
    return this.request<T>('DELETE', path, options);
  }

  /** A GET whose answer is kept as text (a stream of JSON lines, say); refusals throw as for `request`. */
  async getText(path: string, options: Omit<RequestOptions, 'body' | 'form'> = {}): Promise<string> {
    const response = await this.open('GET', path, options);
    const text = await response.text();
    if (!response.ok) throw new OwuiHttpError(response.status, errorDetail(parseJson(text), text), path);
    return text;
  }

  /** Multipart upload; fetch sets the boundary, so no Content-Type header is sent. */
  postForm<T>(path: string, form: FormData, options?: Omit<RequestOptions, 'body'>): Promise<T> {
    return this.request<T>('POST', path, { ...options, form });
  }

  async request<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.open(method, path, options);
    const text = await response.text();
    const data = parseJson(text);
    if (!response.ok) throw new OwuiHttpError(response.status, errorDetail(data, text), path);
    return data as T;
  }

  /**
   * A POST whose answer is read as it arrives (server-sent events): the response itself, once the
   * server has accepted the request. Refusals throw as they do for `request`.
   */
  async stream(path: string, body: unknown, options: Omit<RequestOptions, 'body' | 'form'> = {}): Promise<Response> {
    const response = await this.open('POST', path, { ...options, body });
    if (response.ok) return response;
    const text = await response.text();
    throw new OwuiHttpError(response.status, errorDetail(parseJson(text), text), path);
  }

  private async open(method: Method, path: string, options: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json', ...this.options.headers, ...options.headers };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let body: string | FormData | undefined;
    if (options.form) {
      body = options.form;
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
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort);

    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path, options.query), {
        method,
        headers,
        body,
        signal: controller.signal,
      });
    } catch (error) {
      throw new OwuiNetworkError(path, error, timedOut);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }

    return response;
  }
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Open WebUI answers errors as `{detail: string}`, or FastAPI's `{detail: [{msg}]}` for bad input. */
export function errorDetail(data: unknown, rawText: string): string | undefined {
  if (data && typeof data === 'object' && 'detail' in data) {
    const detail = (data as { detail: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      const messages = detail
        .map((item) => (item && typeof item === 'object' && 'msg' in item ? String((item as { msg: unknown }).msg) : ''))
        .filter(Boolean);
      if (messages.length) return messages.join('; ');
    }
  }
  if (typeof data === 'string' && data.length > 0 && data.length <= 200 && !/<html/i.test(rawText)) return data;
  return undefined;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
