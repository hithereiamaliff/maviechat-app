import { getSession, listSessions, searchSessions, type DtSessionSummary } from '@maviechat/deeptutor-protocol';
import { useQuery } from '@tanstack/react-query';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';

/** Recent sessions, or those matching `query` (title or message text). */
export function useDtSessions(query: string) {
  const { client, session } = useDtAuthed();
  const search = query.trim();
  return useQuery({
    queryKey: [DT_QUERY_ROOT, session.baseUrl, 'sessions', search],
    queryFn: async (): Promise<DtSessionSummary[]> =>
      search ? (await searchSessions(client, search, { limit: 50 })).sessions : listSessions(client, { limit: 100 }),
  });
}

export function useDtSession(id: string) {
  const { client, session } = useDtAuthed();
  return useQuery({
    queryKey: [DT_QUERY_ROOT, session.baseUrl, 'session', id],
    queryFn: () => getSession(client, id),
    enabled: Boolean(id),
  });
}

/** A session time (Unix seconds or milliseconds, or ISO text) as a short date. */
export function sessionDate(value: number | string | undefined): string {
  if (value === undefined || value === '') return '';
  const time = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}
