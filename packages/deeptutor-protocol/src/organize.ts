import type { DtClient } from './http';
import type { DtSessionSummary } from './sessions';

/*
 * How DeepTutor files a session (1.7.1, read from its preferences). Its sidebar lists ordinary
 * conversations; chats held inside a learning activity (a mastery path, a reading collection, a
 * book page, a video) are listed under Learning and open in that activity; side chats, note
 * chats and archived sessions are not listed at all (archived ones have their own page).
 */

type Preferences = Record<string, unknown>;

function preferencesOf(session: DtSessionSummary): Preferences {
  const value = session.preferences;
  return typeof value === 'object' && value !== null ? (value as Preferences) : {};
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const segment = (value: string) => encodeURIComponent(value);

export function isPinned(session: DtSessionSummary): boolean {
  return preferencesOf(session).pinned === true;
}

export function isArchived(session: DtSessionSummary): boolean {
  return preferencesOf(session).archived === true;
}

/**
 * Where a learning chat lives in DeepTutor's web app, or null for an ordinary conversation:
 * its mastery path, reading collection, book page or video.
 */
export function learningPath(session: DtSessionSummary): string | null {
  const preferences = preferencesOf(session);
  const id = segment(session.id);
  const mode = text(preferences.workspace_mode);
  if (mode === 'mastery_path' && text(preferences.mastery_path_id)) {
    return `/learning/mastery/${segment(text(preferences.mastery_path_id))}/sessions/${id}`;
  }
  if (mode === 'immersive_reading' && text(preferences.reading_workspace_id)) {
    return `/learning/reading/${segment(text(preferences.reading_workspace_id))}/sessions/${id}`;
  }
  const bookId = text(preferences.book_id);
  if (bookId) {
    const pageId = text(preferences.book_page_id);
    return `/learning/books/${segment(bookId)}${pageId ? `/pages/${segment(pageId)}` : ''}?chat=${id}`;
  }
  if (mode === 'immersive_watching' || text(preferences.capability) === 'immersive_watching' || session.capability === 'immersive_watching') {
    return `/learning/watching/${id}`;
  }
  return null;
}

/** Which list a session belongs in: your conversations, Learning, or neither (archived, side chats, note chats). */
export function listedUnder(session: DtSessionSummary): 'conversations' | 'learning' | null {
  const preferences = preferencesOf(session);
  if (preferences.archived === true || text(preferences.parent_session_id) || text(preferences.note_document_id)) return null;
  return learningPath(session) ? 'learning' : 'conversations';
}

/** Pins or archives a session (`PATCH /api/sessions/{id}/organization`); archiving takes its side chats along. */
export async function organizeSession(client: DtClient, id: string, change: { pinned?: boolean; archived?: boolean }): Promise<void> {
  await client.send('PATCH', `/api/sessions/${encodeURIComponent(id)}/organization`, { body: change });
}
