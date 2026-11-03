import {
  DEFAULT_ATTACHMENT_LIMITS,
  getAttachmentLimits,
  getLlmOptions,
  getProfile,
  getSuggestions,
  getUiSettings,
  getServerVersion,
  getSession,
  listChatTools,
  listKnowledgeBases,
  listModes,
  listNotebooks,
  listSessions,
  searchSessions,
  type DtSessionSummary,
} from '@maviechat/deeptutor-protocol';
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

/** The account's models (an admin grants them) and the default one. */
export function useDtLlmOptions() {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'llm-options'], queryFn: () => getLlmOptions(client), staleTime: 5 * 60_000 });
}

/** The tools a chat can switch on. */
export function useDtChatTools() {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'chat-tools'], queryFn: () => listChatTools(client), staleTime: 5 * 60_000 });
}

/** The modes (capabilities) the server offers. */
export function useDtModes() {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'modes'], queryFn: () => listModes(client), staleTime: 10 * 60_000 });
}

/** Knowledge bases a turn can search. */
export function useDtKnowledgeBases() {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'knowledge-bases'], queryFn: () => listKnowledgeBases(client), staleTime: 60_000 });
}

/** Notebooks a turn can refer to. */
export function useDtNotebooks(enabled = true) {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'notebooks'], queryFn: () => listNotebooks(client), enabled, staleTime: 60_000 });
}

/** How large attachments may be (DeepTutor's defaults until the server answers). */
export function useDtAttachmentLimits() {
  const { client, session } = useDtAuthed();
  return useQuery({
    queryKey: [DT_QUERY_ROOT, session.baseUrl, 'attachment-limits'],
    queryFn: () => getAttachmentLimits(client),
    staleTime: 10 * 60_000,
    placeholderData: DEFAULT_ATTACHMENT_LIMITS,
  });
}

/** Who you are on DeepTutor (role, learner or not, whether you can change your password). */
export function useDtProfile() {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'profile'], queryFn: () => getProfile(client), staleTime: 5 * 60_000 });
}

/** The account's DeepTutor languages (its own interface, and replies). */
export function useDtUiSettings() {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'ui-settings'], queryFn: () => getUiSettings(client), staleTime: 60_000 });
}

/**
 * DeepTutor's ideas for the home screen. While it writes a fresh set ("stale"), it's asked
 * again every few seconds, a few times, as its web app does.
 */
export function useDtSuggestions() {
  const { client, session } = useDtAuthed();
  return useQuery({
    queryKey: [DT_QUERY_ROOT, session.baseUrl, 'suggestions'],
    queryFn: () => getSuggestions(client),
    staleTime: 5 * 60_000,
    refetchInterval: (query) => (query.state.data?.stale && query.state.dataUpdateCount < 10 ? 3500 : false),
  });
}

/** The DeepTutor version the server runs (null when it doesn't say). */
export function useDtServerVersion() {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'version'], queryFn: () => getServerVersion(client), staleTime: 5 * 60_000 });
}

/** A session time (Unix seconds or milliseconds, or ISO text) as a short date. */
export function sessionDate(value: number | string | undefined): string {
  if (value === undefined || value === '') return '';
  const time = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}
