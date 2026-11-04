import type { OcEvent } from './types';

/**
 * Reads a server-sent event stream as it arrives: feed it text chunks, get back each complete
 * event's data. Handles events split across chunks, several `data:` lines, comments and CRLF.
 */
export class SseParser {
  private buffer = '';

  push(chunk: string): string[] {
    this.buffer += chunk.replace(/\r\n?/g, '\n');
    const out: string[] = [];
    let end = this.buffer.indexOf('\n\n');
    while (end >= 0) {
      const block = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''));
      if (data.length) out.push(data.join('\n'));
      end = this.buffer.indexOf('\n\n');
    }
    return out;
  }
}

/** One event's data as an OpenCode event, or null when it isn't one. */
export function parseEvent(data: string): OcEvent | null {
  try {
    const value = JSON.parse(data) as { type?: unknown; properties?: unknown; payload?: { type?: unknown; properties?: unknown } };
    // `/global/event` wraps each event as `{directory, payload}`.
    const event = value.payload && typeof value.payload === 'object' ? value.payload : value;
    if (typeof event.type !== 'string') return null;
    const properties = typeof event.properties === 'object' && event.properties !== null ? (event.properties as Record<string, unknown>) : {};
    return { type: event.type, properties };
  } catch {
    return null;
  }
}

/**
 * Reads an event stream from a fetch response body until it ends or `signal` aborts, handing
 * each OpenCode event over as it arrives.
 */
export async function readEvents(body: ReadableStream<Uint8Array>, onEvent: (event: OcEvent) => void, signal?: AbortSignal): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  const stop = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener('abort', stop);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const data of parser.push(decoder.decode(value, { stream: true }))) {
        const event = parseEvent(data);
        if (event) onEvent(event);
      }
    }
  } finally {
    signal?.removeEventListener('abort', stop);
  }
}
