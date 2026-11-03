import { isArchived, type DtSessionSummary } from '@maviechat/deeptutor-protocol';

export type HistoryStatus = 'active' | 'archived' | 'all';
export type HistoryKind = 'all' | 'main' | 'threads';

/** A side chat opened from a passage or a whole conversation (DeepTutor's "tutor threads"). */
export function isTutorThread(session: DtSessionSummary): boolean {
  const preferences = typeof session.preferences === 'object' && session.preferences !== null ? (session.preferences as Record<string, unknown>) : {};
  return preferences.session_kind === 'selection_tutor';
}

/** Chat History's filters, as DeepTutor's own page has them: active, archived or both; main chats, threads or both. */
export function filterHistory(sessions: DtSessionSummary[], status: HistoryStatus, kind: HistoryKind): DtSessionSummary[] {
  return sessions.filter((session) => {
    const archived = isArchived(session);
    if ((status === 'active' && archived) || (status === 'archived' && !archived)) return false;
    const thread = isTutorThread(session);
    return kind === 'all' || (kind === 'threads' ? thread : !thread);
  });
}
