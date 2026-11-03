import {
  addDaysKey,
  deviceTimeZone,
  fromDateKey,
  getCalendarLayers,
  getTaskBlocks,
  getTaskBoard,
  listAnnotations,
  listBlockTypes,
  listBookmarks,
  listCollectionChats,
  listCollections,
  listLibrary,
  listBooks,
  listCalendars,
  listOccurrences,
  type DateKey,
  DEFAULT_ATTACHMENT_LIMITS,
  getAttachmentLimits,
  getAuthStatus,
  getBook,
  getCollection,
  getMaterial,
  getSupportedFormats,
  getTranscript,
  getUnit,
  getBookPage,
  getEstimateBasis,
  getKbProgress,
  getKnowledgeBase,
  getLearningIndex,
  getLearningJournal,
  getMasteryTopic,
  getPointReport,
  getLlmOptions,
  getNotebook,
  getPracticeSummary,
  getProfile,
  getQuestionBankStats,
  getSuggestions,
  getUiSettings,
  getServerVersion,
  getSession,
  listChatTools,
  listKbFiles,
  listKnowledgeBases,
  listKnowledgeCenter,
  listRagProviders,
  listKnowledgeMaterials,
  listMasterySessions,
  listMasteryTopics,
  listModes,
  listModules,
  listReviewStrategies,
  listNotebooks,
  listQuestionCategories,
  listSessions,
  searchSessions,
  type DtSessionSummary,
  isPreparing,
} from '@maviechat/deeptutor-protocol';
import { useQuery } from '@tanstack/react-query';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { kbBusy } from './knowledge/status';

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

/** The Knowledge Center's list; while one is indexing, it's read again every few seconds. */
export function useDtKnowledgeCenter() {
  const { client, session } = useDtAuthed();
  return useQuery({
    queryKey: [DT_QUERY_ROOT, session.baseUrl, 'knowledge-bases', 'center'],
    queryFn: () => listKnowledgeCenter(client),
    refetchInterval: (query) => (query.state.data?.some((kb) => kbBusy(kb.status)) ? 2500 : false),
  });
}

/** One knowledge base, its documents and its indexing progress (read again while it indexes). */
export function useDtKnowledgeBase(name: string) {
  const { client, session } = useDtAuthed();
  const info = useQuery({
    queryKey: [DT_QUERY_ROOT, session.baseUrl, 'knowledge-bases', 'one', name],
    queryFn: () => getKnowledgeBase(client, name),
    enabled: Boolean(name),
    refetchInterval: (query) => (query.state.data && kbBusy(query.state.data.status) ? 2500 : false),
  });
  const busy = info.data ? kbBusy(info.data.status) : false;
  const files = useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'knowledge-bases', 'files', name], queryFn: () => listKbFiles(client, name), enabled: Boolean(name) });
  const progress = useQuery({
    queryKey: [DT_QUERY_ROOT, session.baseUrl, 'knowledge-bases', 'progress', name],
    queryFn: () => getKbProgress(client, name),
    enabled: Boolean(name) && busy,
    refetchInterval: busy ? 2000 : false,
  });
  return { info, files, progress, busy };
}

/** The engines DeepTutor offers for a new knowledge base. */
export function useDtRagProviders(enabled: boolean) {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'rag-providers'], queryFn: () => listRagProviders(client), enabled, staleTime: 60_000 });
}

/** One notebook with its records. */
export function useDtNotebook(id: string) {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'notebooks', id], queryFn: () => getNotebook(client, id), enabled: Boolean(id) });
}

/** What DeepTutor keeps about your learning between chats. */
export function useDtLearningJournal() {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'learning-journal'], queryFn: () => getLearningJournal(client) });
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

/** The phone's time zone (DeepTutor's practice and calendar take it). */
export { deviceTimeZone };

/** Today's practice: what's due, mistakes, the bank's size, the next review. */
export function useDtPracticeSummary() {
  const { client, session } = useDtAuthed();
  const timeZone = deviceTimeZone();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'practice', 'summary', timeZone], queryFn: () => getPracticeSummary(client, timeZone) });
}

/** The question bank's categories (yours to make on the web). */
export function useDtQuestionCategories() {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'practice', 'categories'], queryFn: () => listQuestionCategories(client), staleTime: 60_000 });
}

/** Counts for the question bank: all, wrong, bookmarked. */
export function useDtQuestionBankStats() {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'practice', 'stats'], queryFn: () => getQuestionBankStats(client) });
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

/** The Task Board (the default workspace's); changes answer with the whole board, which replaces this. */
export function useDtTaskBoard(enabled = true) {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'task-board'], queryFn: () => getTaskBoard(client), enabled, staleTime: 30_000 });
}

/** How many calendar time blocks each task has. */
export function useDtTaskBlocks() {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'calendar', 'task-blocks'], queryFn: () => getTaskBlocks(client), staleTime: 60_000 });
}

export function useDtCalendars() {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'calendar', 'calendars'], queryFn: () => listCalendars(client), staleTime: 60_000 });
}

/** Events and DeepTutor's own schedule for the days from `from` up to (not including) `to`, in the phone's time zone. */
export function useDtCalendarRange(from: DateKey, to: DateKey) {
  const { client, session } = useDtAuthed();
  const timeZone = deviceTimeZone();
  const start = fromDateKey(from);
  const end = fromDateKey(to);
  const occurrences = useQuery({
    queryKey: [DT_QUERY_ROOT, session.baseUrl, 'calendar', 'events', from, to, timeZone],
    queryFn: () => listOccurrences(client, start, end, timeZone),
    staleTime: 30_000,
  });
  const layers = useQuery({
    queryKey: [DT_QUERY_ROOT, session.baseUrl, 'calendar', 'layers', from, to, timeZone],
    queryFn: () => getCalendarLayers(client, start, end, timeZone),
    staleTime: 60_000,
  });
  return { occurrences, layers };
}

/** The six weeks a month view shows: from its first row's Monday, 42 days. */
export const monthRange = (firstShown: DateKey) => ({ from: firstShown, to: addDaysKey(firstShown, 42) });


/** Every learning activity (books, paths, collections, videos, practice), as DeepTutor's hub shows them; refreshed every 30 s while shown, as there. */
export function useDtLearningIndex() {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'learning-index'], queryFn: () => getLearningIndex(client), refetchInterval: 30_000, staleTime: 10_000 });
}

/** DeepTutor's modules, to know which learning pages this server has switched on. */
export function useDtModules() {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'modules'], queryFn: () => listModules(client), staleTime: 5 * 60_000 });
}

/** Sign-in status, which carries a learner account's limits (`learning_policy`). */
export function useDtAuthStatus() {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'auth-status'], queryFn: () => getAuthStatus(client), staleTime: 5 * 60_000 });
}

/** Your mastery paths. */
export function useDtMasteryTopics() {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'mastery', 'topics'], queryFn: () => listMasteryTopics(client), staleTime: 15_000 });
}

/** One path; read again every 15 s while shown (the tutor changes it as you study). */
export function useDtMasteryTopic(pathId: string) {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'mastery', 'topic', pathId], queryFn: () => getMasteryTopic(client, pathId), enabled: Boolean(pathId), refetchInterval: 15_000, staleTime: 5_000 });
}

export function useDtMasterySessions(pathId: string) {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'mastery', 'sessions', pathId], queryFn: () => listMasterySessions(client, pathId), enabled: Boolean(pathId), refetchInterval: 15_000, staleTime: 5_000 });
}

export function useDtReviewStrategies(enabled = true) {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'mastery', 'strategies'], queryFn: () => listReviewStrategies(client), enabled, staleTime: 5 * 60_000 });
}

/** What a knowledge point's mastery rests on: attempts, the bar to pass, its review. */
export function useDtPointReport(pathId: string, pointId: string | null) {
  const { client, session } = useDtAuthed();
  return useQuery({
    queryKey: [DT_QUERY_ROOT, session.baseUrl, 'mastery', 'point', pathId, pointId],
    queryFn: () => getPointReport(client, pathId, pointId as string),
    enabled: Boolean(pathId && pointId),
  });
}

/** Knowledge bases a new path can be built from. */
export function useDtKnowledgeMaterials(enabled: boolean) {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'mastery', 'kb-materials'], queryFn: () => listKnowledgeMaterials(client), enabled, staleTime: 60_000 });
}

/** Your books and those shared with you; read again every 30 s while shown (they're written in the background). */
export function useDtBooks() {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'books', 'list'], queryFn: () => listBooks(client), refetchInterval: 30_000, staleTime: 5_000 });
}

/** A book with its outline, pages (without their blocks) and your progress. */
export function useDtBook(bookId: string) {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'books', 'book', bookId], queryFn: () => getBook(client, bookId), enabled: Boolean(bookId), staleTime: 5_000 });
}

/** One page with its blocks. */
export function useDtBookPage(bookId: string, pageId: string) {
  const { client, session } = useDtAuthed();
  return useQuery({
    queryKey: [DT_QUERY_ROOT, session.baseUrl, 'books', 'book', bookId, 'page', pageId],
    queryFn: () => getBookPage(client, bookId, pageId),
    enabled: Boolean(bookId && pageId),
    staleTime: 5_000,
  });
}

export function useDtBlockTypes(enabled: boolean) {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'books', 'block-types'], queryFn: () => listBlockTypes(client), enabled, staleTime: 10 * 60_000 });
}

export function useDtEstimateBasis(depth: string, enabled: boolean) {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'books', 'estimate', depth], queryFn: () => getEstimateBasis(client, depth), enabled, staleTime: 10 * 60_000 });
}

/** Your reading collections; read again every 4 s while a material in one is being prepared. */
export function useDtCollections() {
  const { client, session } = useDtAuthed();
  return useQuery({
    queryKey: [DT_QUERY_ROOT, session.baseUrl, 'reading', 'collections'],
    queryFn: () => listCollections(client),
    refetchInterval: (query) => (query.state.data?.collections.some((collection) => collection.materials.some(isPreparing)) ? 4000 : 30_000),
    staleTime: 3000,
  });
}

/** A collection and its chats; read again every 4 s while a material is being prepared, as DeepTutor's page does. */
export function useDtCollection(id: string) {
  const { client, session } = useDtAuthed();
  return useQuery({
    queryKey: [DT_QUERY_ROOT, session.baseUrl, 'reading', 'collection', id],
    queryFn: () => getCollection(client, id),
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data?.collection.materials.some(isPreparing) ? 4000 : false),
    staleTime: 3000,
  });
}

export function useDtCollectionChats(id: string) {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'reading', 'chats', id], queryFn: () => listCollectionChats(client, id), enabled: Boolean(id), staleTime: 5000 });
}

export function useDtLibrary(enabled: boolean) {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'reading', 'library'], queryFn: () => listLibrary(client), enabled, staleTime: 10_000 });
}

export function useDtSupportedFormats() {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'reading', 'formats'], queryFn: () => getSupportedFormats(client), staleTime: 30 * 60_000 });
}

export function useDtMaterial(id: string) {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'reading', 'material', id], queryFn: () => getMaterial(client, id), enabled: Boolean(id), staleTime: 60_000 });
}

/** One unit's text (kept a while: units don't change unless the material is fetched again). */
export function useDtUnit(id: string, locator: number) {
  const { client, session } = useDtAuthed();
  return useQuery({
    queryKey: [DT_QUERY_ROOT, session.baseUrl, 'reading', 'material', id, 'unit', locator],
    queryFn: () => getUnit(client, id, locator),
    enabled: Boolean(id) && locator >= 1,
    staleTime: 10 * 60_000,
  });
}

export function useDtAnnotations(id: string) {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'reading', 'material', id, 'annotations'], queryFn: () => listAnnotations(client, id), enabled: Boolean(id) });
}

export function useDtBookmarks(id: string) {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'reading', 'material', id, 'bookmarks'], queryFn: () => listBookmarks(client, id), enabled: Boolean(id) });
}

export function useDtTranscript(id: string, enabled: boolean) {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'reading', 'material', id, 'transcript'], queryFn: () => getTranscript(client, id), enabled: Boolean(id) && enabled, staleTime: 10 * 60_000 });
}
