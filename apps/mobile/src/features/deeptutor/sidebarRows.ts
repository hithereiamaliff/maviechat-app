import { isPinned, learningPath, listedUnder, type DtSessionSummary } from '@maviechat/deeptutor-protocol';
import type { DtPage, DtShelf } from './pages';

export type DtSidebarRow =
  | { type: 'header'; key: string; label: string }
  | { type: 'page'; key: string; page: DtPage }
  | { type: 'chat'; key: string; session: DtSessionSummary; pinned: boolean }
  /** A chat held in a learning activity: it opens there, in DeepTutor's own page. */
  | { type: 'learning-chat'; key: string; session: DtSessionSummary; path: string }
  | { type: 'note'; key: string; label: string };

const DAY_MS = 24 * 60 * 60 * 1000;

/** A session time (Unix seconds or milliseconds, or ISO text) in Unix seconds; 0 when unreadable. */
export function sessionSeconds(value: number | string | undefined): number {
  if (value === undefined || value === '') return 0;
  const time = typeof value === 'number' ? (value < 1e12 ? value : value / 1000) : Date.parse(value) / 1000;
  return Number.isFinite(time) ? time : 0;
}

/** DeepTutor's date groups for chats: Today, Within a week (1–6 days ago), Earlier. */
export function dtTimeGroup(seconds: number, now: Date = new Date()): { key: string; label: string } {
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(new Date(seconds * 1000))) / DAY_MS);
  if (days <= 0) return { key: 'today', label: 'Today' };
  if (days < 7) return { key: 'week', label: 'Within a week' };
  return { key: 'earlier', label: 'Earlier' };
}

const updatedSeconds = (session: DtSessionSummary) => sessionSeconds(session.updated_at ?? session.created_at);

interface BuildInput {
  shelf: DtShelf;
  search: { active: boolean; results: DtSessionSummary[] | undefined; loading: boolean };
  sessions: DtSessionSummary[];
  loading: boolean;
  failed: boolean;
  now?: Date;
}

/**
 * The DeepTutor sidebar's list for one shelf: its pages, then on Home your chats (Pinned, then
 * by date, as DeepTutor groups them) and on Learning the chats held in learning activities.
 * While searching, only the chats found.
 */
export function buildDtSidebarRows(input: BuildInput): DtSidebarRow[] {
  const rows: DtSidebarRow[] = [];
  const chatRow = (session: DtSessionSummary, prefix: string): DtSidebarRow | null => {
    const under = listedUnder(session);
    if (under === 'conversations') return { type: 'chat', key: `${prefix}-${session.id}`, session, pinned: isPinned(session) };
    const path = under === 'learning' ? learningPath(session) : null;
    return path ? { type: 'learning-chat', key: `${prefix}-${session.id}`, session, path } : null;
  };

  if (input.search.active) {
    const found = (input.search.results ?? []).flatMap((session) => chatRow(session, 'search') ?? []);
    if (input.search.loading && !input.search.results) rows.push({ type: 'note', key: 'search-loading', label: 'Searching…' });
    else if (found.length === 0) rows.push({ type: 'note', key: 'search-empty', label: 'No chats found' });
    return [...rows, ...found];
  }

  input.shelf.groups.forEach((group, index) => {
    if (group.heading) rows.push({ type: 'header', key: `h-${input.shelf.key}-${index}`, label: group.heading });
    for (const page of group.pages) rows.push({ type: 'page', key: `page-${page.key}`, page });
  });

  const empty = (label: string): DtSidebarRow => ({
    type: 'note',
    key: `note-${input.shelf.key}`,
    label: input.loading ? 'Loading chats…' : input.failed ? "Couldn't load your chats" : label,
  });

  if (input.shelf.key === 'home') {
    const listed = input.sessions.filter((session) => listedUnder(session) === 'conversations');
    const pinned = listed.filter(isPinned);
    if (pinned.length > 0) {
      rows.push({ type: 'header', key: 'h-pinned', label: 'Pinned' });
      for (const session of pinned) rows.push({ type: 'chat', key: `pinned-${session.id}`, session, pinned: true });
    }
    let group: string | null = null;
    for (const session of listed.filter((item) => !isPinned(item))) {
      const time = dtTimeGroup(updatedSeconds(session), input.now);
      if (time.key !== group) {
        rows.push({ type: 'header', key: `h-${time.key}`, label: time.label });
        group = time.key;
      }
      rows.push({ type: 'chat', key: `chat-${session.id}`, session, pinned: false });
    }
    if (listed.length === 0) rows.push(empty('No chats yet'));
  } else if (input.shelf.key === 'learning') {
    rows.push({ type: 'header', key: 'h-learning-chats', label: 'Learning chats' });
    const learning = input.sessions.flatMap((session) => {
      const path = listedUnder(session) === 'learning' ? learningPath(session) : null;
      return path ? [{ type: 'learning-chat' as const, key: `learning-${session.id}`, session, path }] : [];
    });
    rows.push(...learning);
    if (learning.length === 0) rows.push(empty('No learning chats yet'));
  }
  return rows;
}
