/** One source a response cited, numbered as the `[n]` markers in its text. */
export interface SourceRef {
  index: number;
  title: string;
  url?: string;
}

/**
 * Normalises a message's `sources` (`{source, document[], metadata[]}` entries)
 * into a numbered list of unique sources with a title and, when known, a URL.
 */
export function normalizeSources(raw: unknown): SourceRef[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const refs: SourceRef[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { source, metadata } = entry as { source?: Record<string, unknown>; metadata?: Record<string, unknown>[] };
    const firstMeta = Array.isArray(metadata) ? metadata[0] : undefined;
    const url = [source?.url, firstMeta?.source, source?.id].find(isHttpUrl) as string | undefined;
    const title =
      [source?.name, firstMeta?.title, firstMeta?.name, url, source?.id].find((value) => typeof value === 'string' && value.trim()) ??
      'Source';
    const key = url ?? String(title);
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ index: refs.length + 1, title: String(title).trim(), ...(url ? { url } : {}) });
  }
  return refs;
}

/** The latest visible status line of a response (e.g. "Searched 5 sites"), if any. */
export function latestStatus(statusHistory: unknown): { description: string; done: boolean } | null {
  if (!Array.isArray(statusHistory)) return null;
  for (let i = statusHistory.length - 1; i >= 0; i -= 1) {
    const status = statusHistory[i] as { description?: unknown; done?: unknown; hidden?: unknown } | undefined;
    if (status && !status.hidden && typeof status.description === 'string' && status.description.trim()) {
      return { description: status.description.trim(), done: status.done !== false };
    }
  }
  return null;
}

/** A response's error text, if it failed. */
export function errorText(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null && 'content' in error) {
    const content = (error as { content?: unknown }).content;
    if (typeof content === 'string' && content.trim()) return content;
  }
  return 'Something went wrong while generating this response.';
}

function isHttpUrl(value: unknown): boolean {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}
