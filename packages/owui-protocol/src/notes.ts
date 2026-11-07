import type { FileItem } from './files';
import type { OwuiClient } from './http';

/** A note you can attach (the + menu's Attach Notes). Open WebUI keeps times in nanoseconds. */
export interface NoteChoice {
  id: string;
  title: string;
  /** Milliseconds. */
  updatedAt: number;
}

function noteChoice(raw: unknown): NoteChoice | null {
  const row = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  if (typeof row.id !== 'string') return null;
  const updated = typeof row.updated_at === 'number' ? row.updated_at : 0;
  return { id: row.id, title: typeof row.title === 'string' && row.title ? row.title : 'Untitled', updatedAt: Math.round(updated / 1_000_000) };
}

/** Your notes, newest first, a page at a time; or those matching `query`. */
export async function listNoteChoices(client: OwuiClient, query: string, page = 1): Promise<NoteChoice[]> {
  const words = query.trim();
  const raw = words
    ? ((await client.get<{ items?: unknown }>('/api/v1/notes/search', { query: { query: words, page } })).items ?? [])
    : await client.get<unknown>('/api/v1/notes/', { query: { page } });
  return (Array.isArray(raw) ? raw : []).map(noteChoice).filter((note): note is NoteChoice => note !== null);
}

/** A note for the model to read, as the web attaches it. */
export function noteReferenceItem(note: NoteChoice, itemId: string): FileItem {
  return { type: 'note', id: note.id, url: '', name: note.title, status: 'processed', itemId };
}
