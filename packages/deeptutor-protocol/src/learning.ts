import type { DtClient } from './http';

/*
 * DeepTutor's learning hub (1.7.1, "All Learning"): every learning activity of the account in one
 * list (books, mastery paths, reading collections, videos and practice), what needs attention
 * (reviews due, books paused or still being written), and which kinds this account may start.
 */

export type DtLearningKind = 'books' | 'mastery' | 'reading' | 'watching' | 'practice';
export const DT_LEARNING_KINDS: readonly DtLearningKind[] = ['books', 'mastery', 'practice', 'reading', 'watching'];

export interface DtLearningActivity {
  /** Unique across kinds, as DeepTutor keys them. */
  key: string;
  kind: DtLearningKind;
  /** The book, path, collection or chat id; for practice, the question's number as text. */
  id: string;
  title: string;
  /** Unix seconds. */
  updatedAt: number;
  createdAt: number;
  /** 0–1: pages read of a book, knowledge points mastered of a path. */
  progress?: number;
}

/** A mastery path with reviews due, and the knowledge points they're for. */
export interface DtReviewsDue {
  pathId: string;
  title: string;
  points: string[];
}

/** A book still being written (`compiling`) or stopped (`paused`, with DeepTutor's reason). */
export interface DtBookInProgress {
  id: string;
  title: string;
  status: 'paused' | 'compiling';
  reason: string;
  updatedAt: number;
}

export interface DtLearningIndex {
  /** Newest first. Archived paths are left out, as DeepTutor does. */
  activities: DtLearningActivity[];
  reviewsDue: DtReviewsDue[];
  booksInProgress: DtBookInProgress[];
  /** Kinds the server couldn't read this time; the rest are still good. */
  failed: DtLearningKind[];
}

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const rows = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.map(record) : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');
const seconds = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const isKind = (value: unknown): value is DtLearningKind => typeof value === 'string' && (DT_LEARNING_KINDS as readonly string[]).includes(value);

function isWatching(session: Record<string, unknown>): boolean {
  const preferences = record(session.preferences);
  return preferences.workspace_mode === 'immersive_watching' || preferences.capability === 'immersive_watching';
}

/** Reads `GET /api/dashboard/learning-index` the way DeepTutor's hub shows it. */
export function learningIndexOf(raw: unknown): DtLearningIndex {
  const body = record(raw);
  const sources = record(body.sources);
  const activities: DtLearningActivity[] = [];
  const reviewsDue: DtReviewsDue[] = [];
  const booksInProgress: DtBookInProgress[] = [];

  for (const entry of rows(sources.practice)) {
    const id = text(entry.id);
    if (!id) continue;
    const updated = seconds(entry.updated_at) || seconds(entry.created_at);
    activities.push({ key: `practice:${id}`, kind: 'practice', id, title: text(entry.question), updatedAt: updated, createdAt: seconds(entry.created_at) || updated });
  }
  for (const book of rows(sources.books)) {
    const id = text(book.id);
    if (!id) continue;
    const percent = seconds(record(book.reading).percent);
    activities.push({
      key: `book:${id}`,
      kind: 'books',
      id,
      title: text(book.title),
      updatedAt: seconds(book.updated_at),
      createdAt: seconds(book.created_at) || seconds(book.updated_at),
      progress: Math.min(1, Math.max(0, percent / 100)),
    });
    if (book.status === 'paused' || book.status === 'compiling') {
      booksInProgress.push({ id, title: text(book.title), status: book.status, reason: text(record(book.metadata).pause_reason), updatedAt: seconds(book.updated_at) });
    }
  }
  for (const topic of rows(sources.mastery)) {
    const id = text(topic.path_id);
    const metadata = record(topic.metadata);
    if (!id || metadata.status !== 'active') continue;
    const counts = record(record(topic.map).counts);
    const total = seconds(counts.total);
    const title = text(topic.name) || text(metadata.goal);
    activities.push({
      key: `topic:${id}`,
      kind: 'mastery',
      id,
      title,
      updatedAt: seconds(topic.updated_at),
      createdAt: seconds(metadata.created_at) || seconds(topic.updated_at),
      progress: total ? Math.min(1, seconds(counts.mastered) / total) : 0,
    });
    const due = rows(topic.reviews).filter((review) => review.due === true);
    if (due.length) reviewsDue.push({ pathId: id, title, points: due.map((review) => text(review.knowledge_point_name)).filter(Boolean) });
  }
  for (const collection of rows(sources.reading)) {
    const id = text(collection.workspace_id);
    if (!id) continue;
    activities.push({
      key: `reading:${id}`,
      kind: 'reading',
      id,
      title: text(collection.title),
      updatedAt: seconds(collection.updated_at),
      createdAt: seconds(collection.created_at) || seconds(collection.updated_at),
    });
  }
  for (const session of rows(sources.watching).filter(isWatching)) {
    const id = text(session.session_id) || text(session.id);
    if (!id) continue;
    activities.push({
      key: `session:${id}`,
      kind: 'watching',
      id,
      title: text(session.title),
      updatedAt: seconds(session.updated_at),
      createdAt: seconds(session.created_at) || seconds(session.updated_at),
    });
  }

  activities.sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key));
  booksInProgress.sort((a, b) => Number(b.status === 'paused') - Number(a.status === 'paused') || b.updatedAt - a.updatedAt);
  return { activities, reviewsDue, booksInProgress, failed: (Array.isArray(body.failed) ? body.failed : []).filter(isKind) };
}

export async function getLearningIndex(client: DtClient): Promise<DtLearningIndex> {
  return learningIndexOf(await client.get<unknown>('/api/dashboard/learning-index'));
}

/** The hub's filter: Reading includes videos, as on DeepTutor. */
export function matchesLearningFilter(activity: DtLearningActivity, filter: DtLearningKind | 'all', query: string): boolean {
  const kindOk = filter === 'all' || activity.kind === filter || (filter === 'reading' && activity.kind === 'watching');
  return kindOk && activity.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

/** What each kind holds now: how many, and the newest one. */
export function learningCounts(activities: DtLearningActivity[]): Record<DtLearningKind, { count: number; latest?: DtLearningActivity }> {
  const counts = Object.fromEntries(DT_LEARNING_KINDS.map((kind) => [kind, { count: 0 }])) as Record<DtLearningKind, { count: number; latest?: DtLearningActivity }>;
  for (const activity of activities) {
    const entry = counts[activity.kind];
    entry.count += 1;
    entry.latest ??= activity;
  }
  return counts;
}

/** A DeepTutor module and the pages it serves (`GET /api/modules`). */
export interface DtModule {
  id: string;
  enabled: boolean;
  ready: boolean;
  navigation: string[];
  capabilities: string[];
}

export async function listModules(client: DtClient): Promise<DtModule[]> {
  const body = record(await client.get<unknown>('/api/modules'));
  return rows(body.modules).flatMap((module): DtModule[] => {
    const id = text(module.id);
    if (!id) return [];
    const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
    return [{ id, enabled: module.enabled === true, ready: module.ready === true, navigation: strings(module.navigation), capabilities: strings(module.capabilities) }];
  });
}

/** Whether a page DeepTutor serves is switched on: some enabled, ready module lists it. */
export function pageAvailable(modules: DtModule[], path: string): boolean {
  return modules.some((module) => module.enabled && module.ready && module.navigation.some((page) => path === page || path.startsWith(`${page}/`)));
}
