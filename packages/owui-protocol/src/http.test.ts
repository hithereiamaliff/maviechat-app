import { describe, expect, it, vi } from 'vitest';
import { errorDetail, normalizeBaseUrl, OwuiClient, OwuiHttpError, OwuiNetworkError, type FetchLike } from './http';

/** Awaits a promise that must reject with `type`, and returns the typed error. */
async function caught<T extends Error>(promise: Promise<unknown>, type: abstract new (...args: never[]) => T): Promise<T> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(type);
    return error as T;
  }
  throw new Error('expected the promise to reject');
}

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(text, { status });
  };
  return { fetch, calls };
}

describe('normalizeBaseUrl', () => {
  it('trims spaces and trailing slashes', () => {
    expect(normalizeBaseUrl('  https://chat.example.com//  ')).toBe('https://chat.example.com');
    expect(normalizeBaseUrl('http://127.0.0.1:3003/')).toBe('http://127.0.0.1:3003');
  });

  it('requires a scheme and host', () => {
    expect(() => normalizeBaseUrl('chat.example.com')).toThrow();
    expect(() => normalizeBaseUrl('https://')).toThrow();
  });
});

describe('OwuiClient', () => {
  it('sends the Bearer token, JSON body and query string', async () => {
    const { fetch, calls } = fakeFetch(200, { ok: true });
    const client = new OwuiClient({ baseUrl: 'https://x.test/', token: 'abc', fetch });
    const result = await client.post<{ ok: boolean }>('/api/v1/chats/new', { a: 1 }, { query: { page: 2, skip: undefined } });

    expect(result).toEqual({ ok: true });
    expect(calls[0]?.url).toBe('https://x.test/api/v1/chats/new?page=2');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer abc');
    expect(headers['Content-Type']).toBe('application/json');
    expect(calls[0]?.init?.body).toBe('{"a":1}');
  });

  it('sends no Authorization header without a token', async () => {
    const { fetch, calls } = fakeFetch(200, { version: '0.11.3' });
    await new OwuiClient({ baseUrl: 'https://x.test', fetch }).get('/api/version');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('withToken keeps the other options', async () => {
    const { fetch, calls } = fakeFetch(200, {});
    const client = new OwuiClient({ baseUrl: 'https://x.test', fetch, headers: { 'X-Proxy': '1' } }).withToken('t');
    await client.get('/api/config');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['X-Proxy']).toBe('1');
    expect(headers.Authorization).toBe('Bearer t');
  });

  it('turns error answers into OwuiHttpError with the server detail', async () => {
    const { fetch } = fakeFetch(400, { detail: 'The email or password provided is incorrect.' });
    const error = await caught(new OwuiClient({ baseUrl: 'https://x.test', fetch }).post('/api/v1/auths/signin', {}), OwuiHttpError);
    expect(error.status).toBe(400);
    expect(error.detail).toBe('The email or password provided is incorrect.');
    expect(error.isUnauthorized).toBe(false);
  });

  it('marks 401 answers as unauthorized', async () => {
    const { fetch } = fakeFetch(401, { detail: 'Invalid token' });
    const error = await caught(new OwuiClient({ baseUrl: 'https://x.test', token: 'old', fetch }).get('/api/config'), OwuiHttpError);
    expect(error.isUnauthorized).toBe(true);
  });

  it('wraps network failures', async () => {
    const fetch: FetchLike = async () => {
      throw new TypeError('Network request failed');
    };
    const error = await caught(new OwuiClient({ baseUrl: 'https://x.test', fetch }).get('/api/version'), OwuiNetworkError);
    expect(error.timedOut).toBe(false);
  });

  it('times out slow requests', async () => {
    vi.useFakeTimers();
    try {
      const fetch: FetchLike = (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      const pending = caught(new OwuiClient({ baseUrl: 'https://x.test', fetch, timeoutMs: 1000 }).get('/api/version'), OwuiNetworkError);
      await vi.advanceTimersByTimeAsync(1000);
      const error = await pending;
      expect(error.timedOut).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('errorDetail', () => {
  it('reads FastAPI validation lists', () => {
    expect(errorDetail({ detail: [{ msg: 'field required' }, { msg: 'bad email' }] }, '')).toBe('field required; bad email');
  });

  it('ignores HTML error pages', () => {
    expect(errorDetail('<html>502</html>', '<html>502</html>')).toBeUndefined();
  });
});
