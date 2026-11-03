import { describe, expect, it } from 'vitest';
import { changePassword, getSuggestions, refreshSuggestions, REPLY_LANGUAGES, updateUiSettings } from './account';
import { DtClient } from './http';
import { isArchived, isPinned, learningPath, listedUnder, organizeSession } from './organize';
import type { DtSessionSummary } from './sessions';

const session = (preferences: Record<string, unknown>, extra: Partial<DtSessionSummary> = {}): DtSessionSummary => ({ id: 's 1', title: 'T', preferences, ...extra });

function recordingClient(body: unknown = {}) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const client = new DtClient({
    baseUrl: 'https://learn.example.com',
    token: 'tok',
    fetch: async (url, init) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(body), { status: 200 });
    },
  });
  return { client, calls };
}

describe('filing sessions', () => {
  it('lists ordinary chats as conversations, pinned or not', () => {
    expect(listedUnder(session({}))).toBe('conversations');
    expect(listedUnder({ id: 'x', title: '' })).toBe('conversations');
    expect(isPinned(session({ pinned: true }))).toBe(true);
    expect(isPinned(session({}))).toBe(false);
  });

  it('leaves out archived, side and note chats', () => {
    expect(listedUnder(session({ archived: true }))).toBeNull();
    expect(isArchived(session({ archived: true }))).toBe(true);
    expect(listedUnder(session({ parent_session_id: 'p' }))).toBeNull();
    expect(listedUnder(session({ note_document_id: 'n' }))).toBeNull();
  });

  it('files learning chats under Learning, opening in their activity', () => {
    expect(learningPath(session({ workspace_mode: 'mastery_path', mastery_path_id: 'm/1' }))).toBe('/learning/mastery/m%2F1/sessions/s%201');
    expect(learningPath(session({ workspace_mode: 'immersive_reading', reading_workspace_id: 'r1' }))).toBe('/learning/reading/r1/sessions/s%201');
    expect(learningPath(session({ book_id: 'b1', book_page_id: 'p2' }))).toBe('/learning/books/b1/pages/p2?chat=s%201');
    expect(learningPath(session({ book_id: 'b1' }))).toBe('/learning/books/b1?chat=s%201');
    expect(learningPath(session({ workspace_mode: 'immersive_watching' }))).toBe('/learning/watching/s%201');
    expect(learningPath(session({}, { capability: 'immersive_watching' }))).toBe('/learning/watching/s%201');
    expect(listedUnder(session({ book_id: 'b1' }))).toBe('learning');
    // A mode without its record is an ordinary conversation.
    expect(learningPath(session({ workspace_mode: 'mastery_path' }))).toBeNull();
  });

  it('pins and archives through the organization endpoint', async () => {
    const { client, calls } = recordingClient({ session: {} });
    await organizeSession(client, 'a/b', { pinned: true });
    await organizeSession(client, 'a/b', { archived: false });
    expect(calls).toEqual([
      { url: 'https://learn.example.com/api/sessions/a%2Fb/organization', method: 'PATCH', body: { pinned: true } },
      { url: 'https://learn.example.com/api/sessions/a%2Fb/organization', method: 'PATCH', body: { archived: false } },
    ]);
  });
});

describe('account', () => {
  it('changes the password with the current one', async () => {
    const { client, calls } = recordingClient({ ok: true });
    await changePassword(client, 'old secret', 'new secret');
    expect(calls[0]).toEqual({ url: 'https://learn.example.com/api/auth/profile/password', method: 'PUT', body: { current_password: 'old secret', new_password: 'new secret' } });
  });

  it('sends only the language that changed', async () => {
    const { client, calls } = recordingClient({ theme: 'system', language: 'en', response_language: 'ms' });
    expect((await updateUiSettings(client, { response_language: 'ms' })).response_language).toBe('ms');
    expect(calls[0]).toMatchObject({ method: 'PUT', body: { response_language: 'ms' } });
    expect(REPLY_LANGUAGES.map((language) => language.code)).toContain('ms');
    expect(new Set(REPLY_LANGUAGES.map((language) => language.code)).size).toBe(17);
  });

  it('keeps only usable suggestions', async () => {
    const { client } = recordingClient({
      suggestions: [{ label: ' Revise fractions ', prompt: 'Quiz me on fractions' }, { label: '', prompt: 'x' }, { label: 'No prompt' }, 'junk'],
      stale: false,
    });
    expect(await getSuggestions(client)).toEqual({ suggestions: [{ label: 'Revise fractions', prompt: 'Quiz me on fractions' }], stale: false });
    const empty = recordingClient({ suggestions: [], stale: true, status: 'working' });
    expect(await refreshSuggestions(empty.client)).toEqual({ suggestions: [], stale: true });
    expect(empty.calls[0]).toMatchObject({ url: 'https://learn.example.com/api/dashboard/suggestions/refresh', method: 'POST' });
  });
});
