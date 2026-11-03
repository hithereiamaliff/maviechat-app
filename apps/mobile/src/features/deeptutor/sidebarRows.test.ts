import type { DtSessionSummary } from '@maviechat/deeptutor-protocol';
import { describe, expect, it } from 'vitest';
import { DT_SHELVES, shelvesFor } from './pages';
import { buildDtSidebarRows, dtTimeGroup, sessionSeconds, type DtSidebarRow } from './sidebarRows';

const now = new Date(2026, 10, 3, 12, 0, 0);
const at = (daysAgo: number) => (now.getTime() - daysAgo * 24 * 60 * 60 * 1000) / 1000;
const session = (id: string, updated: number | string, preferences: Record<string, unknown> = {}): DtSessionSummary => ({ id, title: id, updated_at: updated, preferences });
const idle = { active: false, results: undefined, loading: false };
const shelf = (key: string) => DT_SHELVES.find((item) => item.key === key)!;
const labels = (rows: DtSidebarRow[]) =>
  rows.map((row) => (row.type === 'chat' || row.type === 'learning-chat' ? row.session.id : row.type === 'page' ? `[${row.page.label}]` : row.label));

describe('sessionSeconds', () => {
  it('reads seconds, milliseconds and ISO text', () => {
    expect(sessionSeconds(1_700_000_000)).toBe(1_700_000_000);
    expect(sessionSeconds(1_700_000_000_000)).toBe(1_700_000_000);
    expect(sessionSeconds('2023-11-14T22:13:20Z')).toBe(1_700_000_000);
    expect(sessionSeconds(undefined)).toBe(0);
    expect(sessionSeconds('not a date')).toBe(0);
  });
});

describe('dtTimeGroup', () => {
  it('groups as DeepTutor does', () => {
    expect(dtTimeGroup(at(0.25), now).label).toBe('Today');
    expect(dtTimeGroup(at(1), now).label).toBe('Within a week');
    expect(dtTimeGroup(at(6), now).label).toBe('Within a week');
    expect(dtTimeGroup(at(7), now).label).toBe('Earlier');
  });
});

describe('buildDtSidebarRows', () => {
  it('shows Home with its pages, pinned chats, then chats by date', () => {
    const rows = buildDtSidebarRows({
      shelf: shelf('home'),
      search: idle,
      sessions: [
        session('a', at(0)),
        session('p', at(30), { pinned: true }),
        session('b', at(2)),
        session('archived', at(0), { archived: true }),
        session('side', at(0), { parent_session_id: 'a' }),
        session('book', at(0), { book_id: 'b1' }),
        session('c', new Date(at(9) * 1000).toISOString()),
      ],
      loading: false,
      failed: false,
      now,
    });
    expect(labels(rows)).toEqual(['Workspace', '[Calendar]', '[Task Board]', '[Co-Writer]', 'Pinned', 'p', 'Today', 'a', 'Within a week', 'b', 'Earlier', 'c']);
    expect(rows.find((row) => row.key === 'pinned-p')).toMatchObject({ pinned: true });
  });

  it('shows learning chats on Learning, opening in their activity', () => {
    const rows = buildDtSidebarRows({
      shelf: shelf('learning'),
      search: idle,
      sessions: [session('a', at(0)), session('book', at(0), { book_id: 'b1', book_page_id: 'p1' })],
      loading: false,
      failed: false,
      now,
    });
    expect(labels(rows)).toEqual(['[New Learning Activity]', '[All Learning]', 'Learning chats', 'book']);
    expect(rows[3]).toMatchObject({ type: 'learning-chat', path: '/learning/books/b1/pages/p1?chat=book' });
  });

  it('says why a list is empty', () => {
    const home = (loading: boolean, failed: boolean) => buildDtSidebarRows({ shelf: shelf('home'), search: idle, sessions: [], loading, failed, now }).at(-1);
    expect(home(true, false)).toMatchObject({ type: 'note', label: 'Loading chats…' });
    expect(home(false, true)).toMatchObject({ label: "Couldn't load your chats" });
    expect(home(false, false)).toMatchObject({ label: 'No chats yet' });
    expect(buildDtSidebarRows({ shelf: shelf('learning'), search: idle, sessions: [], loading: false, failed: false, now }).at(-1)).toMatchObject({
      label: 'No learning chats yet',
    });
    expect(labels(buildDtSidebarRows({ shelf: shelf('partners'), search: idle, sessions: [session('a', at(0))], loading: false, failed: false, now }))).toEqual([
      '[All Partners]',
      '[New Partner]',
      '[New Group]',
    ]);
  });

  it('shows only the chats found while searching', () => {
    const searching = { active: true, loading: false, results: [session('x', at(40)), session('gone', at(1), { archived: true }), session('book', at(0), { book_id: 'b' })] };
    const rows = buildDtSidebarRows({ shelf: shelf('home'), search: searching, sessions: [session('a', at(0))], loading: false, failed: false, now });
    expect(labels(rows)).toEqual(['x', 'book']);
    expect(rows[1]).toMatchObject({ type: 'learning-chat' });
    expect(labels(buildDtSidebarRows({ shelf: shelf('home'), search: { ...searching, results: [] }, sessions: [], loading: false, failed: false, now }))).toEqual([
      'No chats found',
    ]);
    expect(labels(buildDtSidebarRows({ shelf: shelf('home'), search: { active: true, loading: true, results: undefined }, sessions: [], loading: false, failed: false, now }))).toEqual([
      'Searching…',
    ]);
  });
});

describe('shelvesFor', () => {
  it('gives learners Home and Learning only, without Co-Writer', () => {
    const learner = shelvesFor(true);
    expect(learner.map((item) => item.key)).toEqual(['home', 'learning']);
    expect(learner[0]!.groups[0]!.pages.map((page) => page.key)).toEqual(['calendar', 'kanban']);
    expect(shelvesFor(false)).toBe(DT_SHELVES);
  });
});
