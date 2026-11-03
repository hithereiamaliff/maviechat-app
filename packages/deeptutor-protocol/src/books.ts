import type { DtClient } from './http';
import { learningSourceRef, type DtMasterySourceInput } from './mastery';
import { SOCKET_AUTH_FAILED, type DtSocketFactory, type DtSocketHandle, type DtTimers } from './turnConnection';
import { quizQuestion, type DtQuizQuestion, type DtVisual } from './turnReply';

/*
 * DeepTutor's Books (1.7.1): a book written for you from what you want to learn and your
 * sources. It goes `draft` (a proposal to review) → `spine_ready` (an outline of chapters to
 * edit) → `compiling` (each chapter's page written in the background) → `ready`. A page is a
 * list of blocks: prose, callouts, quizzes, figures… Long work runs on DeepTutor and reports on
 * the `/ws/books` socket; REST holds the truth, so the app reads it again when events say so.
 */

export type DtBookStatus = 'draft' | 'spine_ready' | 'compiling' | 'paused' | 'ready' | 'error' | 'archived';
export type DtPageStatus = 'pending' | 'planning' | 'generating' | 'ready' | 'partial' | 'error';
export type DtBookDepth = 'brief' | 'standard' | 'deep';
export const DT_BOOK_DEPTHS: readonly DtBookDepth[] = ['brief', 'standard', 'deep'];
export type DtChapterType = 'theory' | 'derivation' | 'history' | 'practice' | 'concept';
export const DT_CHAPTER_TYPES: readonly DtChapterType[] = ['theory', 'derivation', 'history', 'practice', 'concept'];

/** The languages DeepTutor writes books in. "auto" follows what you asked (and the app's language after that). */
export const DT_BOOK_LANGUAGES: readonly { code: string; label: string }[] = [
  { code: 'auto', label: 'Automatic' },
  { code: 'en', label: 'English' },
  { code: 'zh', label: 'Chinese (Simplified)' },
  { code: 'zh-tw', label: 'Chinese (Traditional)' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'ru', label: 'Russian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'it', label: 'Italian' },
  { code: 'tr', label: 'Turkish' },
  { code: 'vi', label: 'Vietnamese' },
];

/** DeepTutor takes at most this many sources for one book. */
export const DT_BOOK_SOURCES_MAX = 32;
/** The chapter count a proposal may ask for. */
export const DT_PROPOSAL_CHAPTERS = { min: 2, max: 12 } as const;
/** The block type every page has (the chapter's prose); it can't be left out. */
export const DT_ALWAYS_BLOCK = 'section';

export interface DtBookProposal {
  title: string;
  description: string;
  scope: string;
  targetLevel: string;
  estimatedChapters: number;
  /** Not shown; sent back as it came. */
  rationale: string;
}

export interface DtBookReading {
  currentPageId: string;
  visitedPages: number;
  totalPages: number;
  /** 0–100. */
  percent: number;
}

export interface DtBookGeneration {
  status: string;
  /** Unfinished pages can be queued again (Resume). */
  canResume: boolean;
  pauseReason: string;
  /** DeepTutor is writing it right now. */
  working: boolean;
  /** It says it's being written, but nothing is writing it (see `bookActivity` for "first chapter only" books). */
  interrupted: boolean;
  /** Unix seconds this run of writing began; 0 when none has. */
  startedAt: number;
  /** The rest come with a book's own page (not the library). */
  failedBlocks: number;
  queuedPages: number;
  failedPages: number;
  /** Why pages or blocks failed, counted: quota, authentication, rate_limit, missing_dependency, provider, content, unknown. */
  failureCategories: Record<string, number>;
}

export interface DtBook {
  id: string;
  /** DeepTutor's edit counter, sent back with changes so two editors don't overwrite each other. */
  revision: number;
  title: string;
  description: string;
  status: DtBookStatus | string;
  proposal: DtBookProposal | null;
  /** The proposal as DeepTutor sent it, to send back with your changes (keeps what the app doesn't show). */
  rawProposal: Record<string, unknown> | null;
  knowledgeBases: string[];
  language: string;
  depth: string;
  pageCount: number;
  chapterCount: number;
  /** Unix seconds. */
  createdAt: number;
  updatedAt: number;
  /** Each page's chat (yours, on a shared book). */
  pageChats: Record<string, string>;
  pauseReason: string;
  /** "user" (you paused it) or "provider" (the model kept refusing). */
  pauseKind: string;
  /** "First chapter only": each chapter is written when it's opened. */
  lazy: boolean;
  /** The kinds of block the book's pages may have; null when it was never narrowed. */
  blockTypes: string[] | null;
  /** Its sources couldn't be read, so it was written from the proposal alone. */
  explorationFailed: boolean;
  /** One of the admin's books shared with you, rather than your own. */
  shared: boolean;
  /** "read" or "edit" on a shared book; "edit" on your own. */
  permission: string;
  canEdit: boolean;
  canDelete: boolean;
  reading: DtBookReading;
  generation: DtBookGeneration | null;
}

export interface DtChapter {
  id: string;
  title: string;
  objectives: string[];
  contentType: string;
  summary: string;
  order: number;
  pageIds: string[];
  /** Made by DeepTutor: the overview, and the deep dives you asked for. The outline editor leaves them be. */
  overview: boolean;
  deepDive: boolean;
  /** As DeepTutor sent it (sources, prerequisites…), sent back on confirming the outline. */
  raw: Record<string, unknown>;
}

export interface DtConceptGraph {
  nodes: { id: string; label: string; chapterId: string; description: string }[];
  edges: { from: string; to: string; relation: string }[];
}

export interface DtSpine {
  chapters: DtChapter[];
  graph: DtConceptGraph;
  raw: Record<string, unknown>;
}

export interface DtBlockFailure {
  kind: string;
  message: string;
  retryable: boolean;
}

export interface DtBookBlock {
  id: string;
  type: string;
  /** pending, generating, ready, error or hidden. */
  status: string;
  title: string;
  params: Record<string, unknown>;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  error: string;
  failure: DtBlockFailure | null;
}

export interface DtBookPage {
  id: string;
  chapterId: string;
  title: string;
  objectives: string[];
  contentType: string;
  status: DtPageStatus | string;
  order: number;
  /** Empty when the page came without its blocks (see `blockCount`). */
  blocks: DtBookBlock[];
  blockCount: number;
  /** A deep dive's page: the page it goes deeper from. */
  parentPageId: string;
  error: string;
  createdAt: number;
  updatedAt: number;
}

export interface DtQuizAttempt {
  blockId: string;
  pageId: string;
  questionId: string;
  answer: string;
  correct: boolean | null;
  submissionId: string;
  timestamp: number;
}

export interface DtBookProgress {
  currentPageId: string;
  visited: string[];
  bookmarked: string[];
  /** Questions whose latest answer was right. */
  score: number;
  weakChapters: string[];
  quizAttempts: DtQuizAttempt[];
}

export interface DtBookDetail {
  book: DtBook;
  spine: DtSpine | null;
  /** In reading order: the overview first, deep dives last. */
  pages: DtBookPage[];
  progress: DtBookProgress;
}

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const rows = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.map(record) : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');
const number = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
const segment = (value: string) => encodeURIComponent(value);

function proposalOf(raw: unknown): DtBookProposal | null {
  const proposal = record(raw);
  if (!Object.keys(proposal).length) return null;
  return {
    title: text(proposal.title),
    description: text(proposal.description),
    scope: text(proposal.scope),
    targetLevel: text(proposal.target_level),
    estimatedChapters: number(proposal.estimated_chapters),
    rationale: text(proposal.rationale),
  };
}

function generationOf(raw: unknown): DtBookGeneration | null {
  const generation = record(raw);
  if (!Object.keys(generation).length) return null;
  const categories = Object.fromEntries(Object.entries(record(generation.failure_categories)).filter((entry): entry is [string, number] => typeof entry[1] === 'number'));
  return {
    status: text(generation.status),
    canResume: generation.can_resume === true,
    pauseReason: text(generation.pause_reason),
    working: generation.working === true,
    interrupted: generation.interrupted === true,
    startedAt: number(generation.started_at),
    failedBlocks: number(generation.failed_blocks),
    queuedPages: number(generation.queued_pages),
    failedPages: number(generation.failed_pages),
    failureCategories: categories,
  };
}

/** A book as the library and a book's own page send it. */
export function bookOf(raw: unknown, generation?: unknown): DtBook {
  const book = record(raw);
  const metadata = record(book.metadata);
  const reading = record(book.reading);
  const rawProposal = Object.keys(record(book.proposal)).length ? record(book.proposal) : null;
  const pageChats = Object.fromEntries(Object.entries(record(metadata.page_chat_sessions)).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== ''));
  const shared = book.source === 'shared';
  const permission = text(book.permission) || (shared ? 'read' : 'edit');
  return {
    id: text(book.id),
    revision: number(book.revision),
    title: text(book.title),
    description: text(book.description),
    status: text(book.status) || 'draft',
    proposal: proposalOf(rawProposal),
    rawProposal,
    knowledgeBases: strings(book.knowledge_bases),
    language: text(book.language),
    depth: text(book.depth) || 'standard',
    pageCount: number(book.page_count),
    chapterCount: number(book.chapter_count),
    createdAt: number(book.created_at),
    updatedAt: number(book.updated_at),
    pageChats,
    pauseReason: text(metadata.pause_reason),
    pauseKind: text(metadata.pause_kind),
    lazy: metadata.lazy_compile === true,
    blockTypes: Array.isArray(metadata.block_types) ? strings(metadata.block_types) : null,
    explorationFailed: metadata.exploration_failed === true,
    shared,
    permission,
    // Without the capability fields (a socket's result), it's your own book.
    canEdit: typeof book.can_edit === 'boolean' ? book.can_edit : permission === 'edit',
    canDelete: typeof book.can_delete === 'boolean' ? book.can_delete : !shared,
    reading: {
      currentPageId: text(reading.current_page_id),
      visitedPages: number(reading.visited_pages),
      totalPages: number(reading.total_pages),
      percent: Math.min(100, Math.max(0, number(reading.percent))),
    },
    generation: generationOf(generation ?? book.generation),
  };
}

function chapterOf(raw: Record<string, unknown>): DtChapter {
  return {
    id: text(raw.id),
    title: text(raw.title),
    objectives: strings(raw.learning_objectives),
    contentType: text(raw.content_type) || 'theory',
    summary: text(raw.summary),
    order: number(raw.order),
    pageIds: strings(raw.page_ids),
    overview: raw.auto_overview === true || raw.content_type === 'overview',
    deepDive: raw.deep_dive === true,
    raw,
  };
}

function graphOf(raw: unknown): DtConceptGraph {
  const graph = record(raw);
  return {
    nodes: rows(graph.nodes)
      .map((node) => ({ id: text(node.id), label: text(node.label) || text(node.id), chapterId: text(node.chapter_id), description: text(node.description) }))
      .filter((node) => node.id),
    edges: rows(graph.edges)
      .map((edge) => ({ from: text(edge.src), to: text(edge.dst), relation: text(edge.relation) || 'depends_on' }))
      .filter((edge) => edge.from && edge.to),
  };
}

export function spineOf(raw: unknown): DtSpine | null {
  const spine = record(raw);
  if (!Array.isArray(spine.chapters)) return null;
  return { chapters: rows(spine.chapters).map(chapterOf), graph: graphOf(spine.concept_graph), raw: spine };
}

function blockOf(raw: Record<string, unknown>): DtBookBlock {
  const metadata = record(raw.metadata);
  const failure = record(metadata.failure);
  return {
    id: text(raw.id),
    type: text(raw.type),
    status: text(raw.status) || 'pending',
    title: text(raw.title),
    params: record(raw.params),
    payload: record(raw.payload),
    metadata,
    error: text(raw.error),
    failure: Object.keys(failure).length ? { kind: text(failure.kind), message: text(failure.message), retryable: failure.retryable !== false } : null,
  };
}

export function bookPageOf(raw: unknown): DtBookPage {
  const page = record(raw);
  const blocks = rows(page.blocks).map(blockOf);
  return {
    id: text(page.id),
    chapterId: text(page.chapter_id),
    title: text(page.title),
    objectives: strings(page.learning_objectives),
    contentType: text(page.content_type),
    status: text(page.status) || 'pending',
    order: number(page.order),
    blocks,
    blockCount: Math.max(blocks.length, number(page.block_count)),
    parentPageId: text(page.parent_page_id),
    error: text(page.error),
    createdAt: number(page.created_at),
    updatedAt: number(page.updated_at),
  };
}

export function bookProgressOf(raw: unknown): DtBookProgress {
  const progress = record(raw);
  return {
    currentPageId: text(progress.current_page_id),
    visited: strings(progress.visited_page_ids),
    bookmarked: strings(progress.bookmarked_page_ids),
    score: number(progress.score),
    weakChapters: strings(progress.weak_chapters),
    quizAttempts: rows(progress.quiz_attempts).map((attempt) => ({
      blockId: text(attempt.block_id),
      pageId: text(attempt.page_id),
      questionId: text(attempt.question_id),
      answer: text(attempt.user_answer),
      correct: typeof attempt.is_correct === 'boolean' ? attempt.is_correct : null,
      submissionId: text(attempt.submission_id),
      timestamp: number(attempt.timestamp),
    })),
  };
}

const byReadingOrder = (a: DtBookPage, b: DtBookPage) => a.order - b.order || a.createdAt - b.createdAt;

export function bookDetailOf(raw: unknown): DtBookDetail {
  const detail = record(raw);
  return {
    book: bookOf(detail.book, detail.generation),
    spine: spineOf(detail.spine),
    pages: rows(detail.pages).map(bookPageOf).sort(byReadingOrder),
    progress: bookProgressOf(detail.progress),
  };
}

// ── Reading and the library ──────────────────────────────────────────────────

/** Your books and the ones shared with you, newest first; and whether you may write new ones. */
export async function listBooks(client: DtClient): Promise<{ books: DtBook[]; canCreate: boolean }> {
  const body = record(await client.get<unknown>('/api/dashboard/learning-library/books'));
  return { books: rows(body.items).map((item) => bookOf(item)), canCreate: body.can_create !== false };
}

/** A book with its outline and pages (without their blocks: `getBookPage` brings one page's). */
export async function getBook(client: DtClient, bookId: string): Promise<DtBookDetail> {
  return bookDetailOf(await client.get<unknown>(`/api/books/${segment(bookId)}`, { query: { include_blocks: false } }));
}

export async function getBookPage(client: DtClient, bookId: string, pageId: string): Promise<DtBookPage> {
  return bookPageOf(record(await client.get<unknown>(`/api/books/${segment(bookId)}/pages/${segment(pageId)}`)).page);
}

/** Deletes your own book, with its pages and progress. */
export async function deleteBook(client: DtClient, bookId: string): Promise<void> {
  await client.delete(`/api/books/${segment(bookId)}`);
}

/** The whole book as Markdown: its written pages, and a note for each one not written yet. */
export async function exportBook(client: DtClient, bookId: string): Promise<string> {
  const body = await client.get<unknown>(`/api/books/${segment(bookId)}/export`, { timeoutMs: 60_000 });
  return typeof body === 'string' ? body : '';
}

/** Marks a page as read and where you are now. */
export async function recordPageVisit(client: DtClient, bookId: string, pageId: string): Promise<DtBookProgress> {
  return bookProgressOf(record(await client.post<unknown>('/api/books/progress/visit', { book_id: bookId, page_id: pageId })).progress);
}

/** Bookmarks a page, or removes its bookmark: DeepTutor toggles it, so send it once per tap. */
export async function toggleBookmark(client: DtClient, bookId: string, pageId: string): Promise<DtBookProgress> {
  return bookProgressOf(record(await client.post<unknown>('/api/books/progress/bookmark', { book_id: bookId, page_id: pageId })).progress);
}

/**
 * Your answer to one of a page's quiz questions. DeepTutor keeps it with your progress and, when
 * it knows whether you were right, in your learning record. `submissionId` makes a retry the same
 * answer (one id per answer).
 */
export async function recordQuizAttempt(
  client: DtClient,
  attempt: { bookId: string; pageId: string; blockId: string; questionId: string; answer: string; correct: boolean | null; submissionId: string },
): Promise<DtBookProgress> {
  const body = await client.post<unknown>('/api/books/quiz-attempt', {
    book_id: attempt.bookId,
    page_id: attempt.pageId,
    block_id: attempt.blockId,
    question_id: attempt.questionId,
    user_answer: attempt.answer,
    is_correct: attempt.correct,
    submission_id: attempt.submissionId,
  });
  return bookProgressOf(record(body).progress);
}

/**
 * Files a chat under a page: the page's chat from now on, and DeepTutor lists it with the book.
 * Fine on a book shared with you (the link is yours alone).
 */
export async function linkPageChat(client: DtClient, bookId: string, pageId: string, sessionId: string): Promise<void> {
  await client.post('/api/books/page-chat-session', { book_id: bookId, page_id: pageId, session_id: sessionId });
}

/** Stops the writing: what's queued waits, and a page being written goes back to the queue. */
export async function pauseBook(client: DtClient, book: Pick<DtBook, 'id' | 'revision'>): Promise<number> {
  return number(record(await client.post<unknown>('/api/books/pause', { book_id: book.id, expected_revision: book.revision })).book_revision);
}

/** Writes the unfinished pages again (failed ones too; partly written ones keep what they have). */
export async function resumeBook(client: DtClient, book: Pick<DtBook, 'id' | 'revision'>): Promise<number> {
  return number(record(await client.post<unknown>('/api/books/resume', { book_id: book.id, expected_revision: book.revision })).book_revision);
}

/**
 * A new page that goes deeper into one of a page's suggestions. DeepTutor writes the whole page
 * before answering, which takes minutes; it carries on if the app stops waiting.
 */
export async function writeDeepDive(client: DtClient, input: { book: Pick<DtBook, 'id' | 'revision'>; pageId: string; topic: string; blockId: string }): Promise<DtBookPage> {
  const body = await client.send<unknown>('POST', '/api/books/deep-dive', {
    body: { book_id: input.book.id, parent_page_id: input.pageId, topic: input.topic, block_id: input.blockId, expected_revision: input.book.revision },
    timeoutMs: 15 * 60_000,
  });
  return bookPageOf(record(body.data).page);
}

// ── Making a book ─────────────────────────────────────────────────────────────

/** The kinds of block DeepTutor can write, and which ones a book gets unless you narrow them. */
export async function listBlockTypes(client: DtClient): Promise<{ type: string; plannerDefault: boolean }[]> {
  const body = record(await client.get<unknown>('/api/books/block-types'));
  return rows(body.block_types)
    .map((option) => ({ type: text(option.value), plannerDefault: option.planner_default === true }))
    .filter((option) => option.type);
}

export interface DtChapterCost {
  blocks: number;
  words: number;
  /** About how long DeepTutor takes to write one. */
  seconds: number;
}

/** What one chapter of each kind costs at a depth, by DeepTutor's own estimate. */
export async function getEstimateBasis(client: DtClient, depth: string): Promise<Record<string, DtChapterCost>> {
  const body = record(await client.get<unknown>('/api/books/estimate-basis', { query: { depth } }));
  return Object.fromEntries(
    Object.entries(record(body.basis)).map(([type, cost]) => [type, { blocks: number(record(cost).blocks), words: number(record(cost).words), seconds: number(record(cost).seconds) }]),
  );
}

/** A chapter as the outline editor holds it; `id` is DeepTutor's, or a new one. */
export interface DtChapterDraft {
  id: string;
  title: string;
  contentType: string;
  summary: string;
  objectives: string[];
}

/** The outline's chapters you edit: DeepTutor's overview and deep dives are left out. */
export function chapterDrafts(spine: DtSpine): DtChapterDraft[] {
  return spine.chapters
    .filter((chapter) => !chapter.overview && !chapter.deepDive)
    .sort((a, b) => a.order - b.order)
    .map((chapter) => ({ id: chapter.id, title: chapter.title, contentType: chapter.contentType, summary: chapter.summary, objectives: chapter.objectives }));
}

function hexId(): string {
  let id = '';
  for (let i = 0; i < 10; i += 1) id += Math.floor(Math.random() * 16).toString(16);
  return id;
}

export function newChapterDraft(): DtChapterDraft {
  return { id: `ch_${hexId()}`, title: '', contentType: 'theory', summary: '', objectives: [] };
}

/**
 * The outline to confirm, as DeepTutor's editor sends it: the overview first, your chapters (those
 * with a title) in your order, deep dives last, numbered again. What the app doesn't edit of a
 * chapter (its sources, prerequisites…) goes back as it came.
 */
export function spineForConfirm(spine: DtSpine, bookId: string, drafts: DtChapterDraft[]): Record<string, unknown> {
  const known = new Map(spine.chapters.map((chapter) => [chapter.id, chapter.raw]));
  const edited = drafts
    .filter((draft) => draft.title.trim())
    .map((draft) => ({
      ...(known.get(draft.id) ?? { source_anchors: [], prerequisites: [], page_ids: [] }),
      id: draft.id,
      title: draft.title.trim(),
      content_type: (DT_CHAPTER_TYPES as readonly string[]).includes(draft.contentType) ? draft.contentType : 'theory',
      summary: draft.summary.trim(),
      learning_objectives: draft.objectives.map((line) => line.trim()).filter(Boolean),
    }));
  const overview = spine.chapters.filter((chapter) => chapter.overview).map((chapter) => chapter.raw);
  const deepDives = spine.chapters.filter((chapter) => chapter.deepDive && !chapter.overview).map((chapter) => chapter.raw);
  const chapters = [...overview, ...edited, ...deepDives].map((chapter, order) => ({ ...chapter, order }));
  return { ...spine.raw, book_id: text(spine.raw.book_id) || bookId, chapters };
}

/** About how many words the outline makes and how long it takes to write, or null without DeepTutor's figures. */
export function bookEstimate(basis: Record<string, DtChapterCost> | undefined, drafts: DtChapterDraft[]): { chapters: number; words: number; minutes: number } | null {
  if (!basis || !Object.keys(basis).length) return null;
  let words = 0;
  let seconds = 0;
  const chapters = drafts.filter((draft) => draft.title.trim());
  for (const chapter of chapters) {
    const cost = basis[chapter.contentType] ?? basis.theory;
    if (!cost) continue;
    words += cost.words;
    seconds += cost.seconds;
  }
  return { chapters: chapters.length, words: Math.round(words / 100) * 100, minutes: Math.ceil(seconds / 60) };
}

/** The block types picked at first: the book's own choice, else DeepTutor's defaults (the prose is always in). */
export function initialBlockTypes(catalog: { type: string; plannerDefault: boolean }[], saved: string[] | null): string[] {
  const options = catalog.filter((option) => option.type !== DT_ALWAYS_BLOCK);
  if (saved?.length) return options.filter((option) => saved.includes(option.type)).map((option) => option.type);
  return options.filter((option) => option.plannerDefault).map((option) => option.type);
}

/**
 * Starts the writing from your outline (no model call by itself): the overview is ready at once,
 * then every chapter in turn (`autoCompile`), or each one when you open it. `blockTypes` narrows
 * the kinds of block (null leaves the book's choice).
 */
export async function confirmSpine(
  client: DtClient,
  input: { book: Pick<DtBook, 'id' | 'revision'>; spine: Record<string, unknown>; autoCompile: boolean; blockTypes: string[] | null },
): Promise<number> {
  const body = record(
    (
      await client.send<unknown>('POST', '/api/books/confirm-spine', {
        body: {
          book_id: input.book.id,
          spine: input.spine,
          auto_compile: input.autoCompile,
          expected_revision: input.book.revision,
          ...(input.blockTypes ? { block_types: [DT_ALWAYS_BLOCK, ...input.blockTypes.filter((type) => type !== DT_ALWAYS_BLOCK)] } : {}),
        },
        timeoutMs: 120_000,
      })
    ).data,
  );
  return number(body.book_revision);
}

/** The proposal to confirm: DeepTutor's own, with your changes. */
export function proposalForConfirm(book: Pick<DtBook, 'rawProposal'>, edits: DtBookProposal): Record<string, unknown> {
  const chapters = Math.round(Math.min(DT_PROPOSAL_CHAPTERS.max, Math.max(DT_PROPOSAL_CHAPTERS.min, edits.estimatedChapters || DT_PROPOSAL_CHAPTERS.min)));
  return {
    ...(book.rawProposal ?? {}),
    title: edits.title.trim(),
    description: edits.description.trim(),
    scope: edits.scope.trim(),
    target_level: edits.targetLevel.trim(),
    estimated_chapters: chapters,
    rationale: edits.rationale,
  };
}

/** What a book is made from: what you want to learn, the sources, and how. */
export interface DtBookRequest {
  intent: string;
  /** Knowledge bases, favorites, chats, other books… (whole knowledge bases go in `knowledgeBases` too). */
  sources: DtMasterySourceInput[];
  /** The knowledge bases DeepTutor searches while writing, and the page chats use. */
  knowledgeBases: string[];
  language: string;
  /** For "auto" when what you asked doesn't settle it: the app's language. */
  fallbackLanguage: string;
  depth: DtBookDepth;
}

export function createBookMessage(request: DtBookRequest): Record<string, unknown> {
  return {
    type: 'create',
    user_intent: request.intent.trim(),
    source_refs: request.sources.slice(0, DT_BOOK_SOURCES_MAX).map(learningSourceRef),
    chat_session_id: '',
    chat_selections: [],
    notebook_refs: [],
    knowledge_bases: request.knowledgeBases,
    question_categories: [],
    question_entries: [],
    language: request.language || 'auto',
    fallback_language: request.fallbackLanguage || 'en',
    depth: request.depth,
  };
}

/** Another book as a source: its outline, as DeepTutor's picker reads it. */
export function bookMaterial(book: Pick<DtBook, 'id' | 'title'>, spine: DtSpine | null): DtMasterySourceInput {
  if (!spine) return { kind: 'book', sourceId: book.id, label: book.title || 'Book', available: false, metadata: { content_workspace_id: '' } };
  const chapters = spine.chapters.filter((chapter) => !chapter.overview);
  const excerpt = chapters
    .map((chapter) => [chapter.title, chapter.objectives.join('; '), chapter.summary].filter(Boolean).join('\n'))
    .join('\n\n')
    .slice(0, 8000);
  return { kind: 'book', sourceId: book.id, label: book.title || 'Book', excerpt, metadata: { chapter_count: chapters.length, content_workspace_id: '' } };
}

export async function getBookSpine(client: DtClient, bookId: string): Promise<DtSpine | null> {
  return spineOf(record(await client.get<unknown>(`/api/books/${segment(bookId)}/spine`)).spine);
}

// ── What to show ─────────────────────────────────────────────────────────────

/** Which step a book is at for you: its proposal to review, its outline to edit, or reading. */
export function bookView(detail: DtBookDetail): 'proposal' | 'outline' | 'reader' {
  const { book } = detail;
  if (!book.canEdit) return 'reader';
  if (book.status === 'draft' && book.proposal) return 'proposal';
  const untouched = detail.pages.every((page) => page.status === 'pending' && page.blockCount === 0);
  if (book.status === 'spine_ready' && detail.spine && untouched) return 'outline';
  return 'reader';
}

/** Where reading picks up: the page asked for, else where you were, else the first written page, else the first. */
export function landingPage(detail: DtBookDetail, requested?: string | null): DtBookPage | null {
  const find = (id: string | null | undefined) => (id ? detail.pages.find((page) => page.id === id) : undefined);
  return find(requested) ?? find(detail.progress.currentPageId) ?? detail.pages.find((page) => page.status === 'ready') ?? detail.pages[0] ?? null;
}

/** The overview page DeepTutor adds at the front (a map of the chapters). */
export function isOverviewPage(detail: DtBookDetail, page: DtBookPage): boolean {
  return page.contentType === 'overview' || Boolean(detail.spine?.chapters.find((chapter) => chapter.id === page.chapterId)?.overview);
}

/** The chapters to write: neither the overview nor deep dives. */
export function bookChapters(detail: DtBookDetail): DtBookPage[] {
  return detail.pages.filter((page) => !page.parentPageId && !isOverviewPage(detail, page));
}

export type DtBookActivityKind = 'writing' | 'paused' | 'stopped' | 'idle';

/**
 * What the writing is doing, for a strip above the book: writing, paused, or stopped (it says it's
 * being written and nothing is, as after DeepTutor restarts). A "first chapter only" book between
 * chapters is idle, not stopped (DeepTutor reports it as stopped).
 */
export function bookActivity(detail: DtBookDetail, liveWriting = false): { kind: DtBookActivityKind; ready: number; total: number; startedAt: number } {
  const { book } = detail;
  const chapters = bookChapters(detail);
  const ready = chapters.filter((page) => page.status === 'ready' || page.status === 'partial').length;
  const base = { ready, total: chapters.length, startedAt: book.generation?.startedAt ?? 0 };
  if (book.status === 'paused') return { ...base, kind: 'paused' };
  if (book.status !== 'compiling') return { ...base, kind: 'idle' };
  const busy = chapters.some((page) => page.status === 'planning' || page.status === 'generating');
  if (book.generation?.working || liveWriting || busy) return { ...base, kind: 'writing' };
  return { ...base, kind: book.lazy ? 'idle' : 'stopped' };
}

// ── Blocks ───────────────────────────────────────────────────────────────────

/** A text block's Markdown (the overview's use `content`). */
export function blockMarkdown(block: DtBookBlock): string {
  return text(block.payload.body) || text(block.payload.content);
}

/** The short bridge from the block before, when there is one. */
export function blockBridge(block: DtBookBlock): string {
  return text(block.payload.bridge_text);
}

export interface DtSectionPart {
  intro: string;
  focus: string;
  /** Each part's Markdown, its heading included. */
  parts: string[];
  takeaway: string;
}

export function sectionOf(block: DtBookBlock): DtSectionPart {
  const payload = block.payload;
  return {
    intro: text(payload.intro),
    focus: text(payload.focus),
    parts: rows(payload.subsections)
      .map((part) => text(part.body) || (text(part.heading) ? `### ${text(part.heading)}` : ''))
      .filter(Boolean),
    takeaway: text(payload.key_takeaway),
  };
}

export function calloutOf(block: DtBookBlock): { variant: string; label: string; body: string } {
  const variant = text(block.payload.variant) || 'key_idea';
  return { variant, label: text(block.payload.label), body: text(block.payload.body) };
}

/** A quiz block's questions; one without its own id is "block:number", as DeepTutor records it. */
export function bookQuizQuestions(block: DtBookBlock): DtQuizQuestion[] {
  return rows(block.payload.questions).flatMap((raw, index) => {
    const question = quizQuestion(raw);
    if (!question) return [];
    return [{ ...question, id: text(raw.question_id) || `${block.id}:${index + 1}` }];
  });
}

export function flashCardsOf(block: DtBookBlock): { front: string; back: string; hint: string }[] {
  return rows(block.payload.cards)
    .map((card) => ({ front: text(card.front), back: text(card.back), hint: text(card.hint) }))
    .filter((card) => card.front || card.back);
}

export function timelineOf(block: DtBookBlock): { date: string; title: string; description: string }[] {
  return rows(block.payload.events)
    .map((event) => ({ date: text(event.date), title: text(event.title), description: text(event.description) }))
    .filter((event) => event.title || event.description);
}

export function codeOf(block: DtBookBlock): { language: string; code: string; explanation: string } {
  return { language: text(block.payload.language) || 'python', code: text(block.payload.code), explanation: text(block.payload.explanation) };
}

/** A deep-dive block's topics, and the page already written for each (if any). */
export function deepDivesOf(block: DtBookBlock): { topic: string; rationale: string; pageId: string }[] {
  const pages = record(block.metadata.deep_dive_pages);
  const legacy = text(block.metadata.deep_dive_page_id);
  return rows(block.payload.suggestions)
    .map((suggestion, index) => {
      const topic = text(suggestion.topic);
      return { topic, rationale: text(suggestion.rationale), pageId: text(pages[topic]) || (index === 0 ? legacy : '') };
    })
    .filter((suggestion) => suggestion.topic);
}

/** The Markdown of a note you added to a page. */
export function noteOf(block: DtBookBlock): string {
  return text(block.payload.body);
}

const LANGUAGE_RENDER: Record<string, string> = { svg: 'svg', mermaid: 'mermaid', javascript: 'chartjs', js: 'chartjs', json: 'chartjs', html: 'html' };

/**
 * A figure or interactive block as a visual the app draws (in a sandboxed web view). A Chart.js
 * figure's settings come as loose JSON (fences, bare keys, single quotes, trailing commas), which
 * is tidied into JSON; settings that still don't read come back empty.
 */
export function blockVisual(block: DtBookBlock): DtVisual {
  const code = record(block.payload.code);
  const language = text(code.language).toLowerCase();
  const content = text(code.content);
  const renderType = (text(block.payload.render_type) || LANGUAGE_RENDER[language] || (block.type === 'interactive' ? 'html' : 'svg')).toLowerCase();
  let data = content;
  if (renderType === 'chartjs') {
    const parsed = looseJson(content);
    data = parsed === undefined ? '' : JSON.stringify(parsed);
  }
  return { renderType, data, title: block.title, description: text(block.payload.description), code: { language: language || renderType, content } };
}

/** Reads JSON as models tend to write it: in a code fence, keys unquoted, single quotes, comments, trailing commas. */
export function looseJson(source: string): unknown {
  const unfenced = source
    .trim()
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    // Tidied below.
  }
  try {
    return JSON.parse(tidyJson(unfenced));
  } catch {
    return undefined;
  }
}

/** One pass outside strings: single-quoted strings and bare keys get double quotes; comments and trailing commas go. */
function tidyJson(source: string): string {
  let out = '';
  let i = 0;
  // Past spaces and comments.
  const skipSpace = (from: number) => {
    let at = from;
    for (;;) {
      while (at < source.length && /\s/.test(source[at] as string)) at += 1;
      if (source.startsWith('//', at)) {
        while (at < source.length && source[at] !== '\n') at += 1;
      } else if (source.startsWith('/*', at)) {
        const end = source.indexOf('*/', at + 2);
        at = end < 0 ? source.length : end + 2;
      } else {
        return at;
      }
    }
  };
  while (i < source.length) {
    const char = source[i] as string;
    if (char === '"') {
      let end = i + 1;
      while (end < source.length && source[end] !== '"') end += source[end] === '\\' ? 2 : 1;
      out += source.slice(i, end + 1);
      i = end + 1;
    } else if (char === "'") {
      let end = i + 1;
      let inner = '';
      while (end < source.length && source[end] !== "'") {
        const at = source[end] as string;
        if (at === '\\' && end + 1 < source.length) {
          const next = source[end + 1] as string;
          inner += next === "'" ? "'" : `\\${next}`;
          end += 2;
        } else {
          inner += at === '"' ? '\\"' : at;
          end += 1;
        }
      }
      out += `"${inner}"`;
      i = end + 1;
    } else if (char === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
    } else if (char === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
    } else if (char === ',' && /[}\]]/.test(source[skipSpace(i + 1)] ?? '')) {
      i += 1;
    } else if (/[A-Za-z_$]/.test(char)) {
      let end = i + 1;
      while (end < source.length && /[\w$]/.test(source[end] as string)) end += 1;
      const word = source.slice(i, end);
      out += source[skipSpace(end)] === ':' ? `"${word}"` : word;
      i = end;
    } else {
      out += char;
      i += 1;
    }
  }
  return out;
}

/** The video of an animation block (its address on DeepTutor), or "" when it has none. */
export function animationVideo(block: DtBookBlock): { url: string; caption: string } {
  const payload = block.payload;
  const artifacts = rows(payload.artifacts);
  const video = artifacts.find((artifact) => text(artifact.content_type).startsWith('video/') || /\.(mp4|webm|mov)$/i.test(text(artifact.url)));
  const url = text(payload.video_url) || text(video?.url) || text(artifacts[0]?.url);
  return { url, caption: text(payload.summary) || text(payload.description) };
}

/** The overview's chapter map as a Mermaid diagram (top to bottom, chapters numbered), or "". */
export function conceptMapMermaid(block: DtBookBlock): string {
  const graph = graphOf(block.payload.graph);
  const index = rows(record(block.payload.index).chapters);
  if (!graph.nodes.length) return text(record(block.payload.code).content);
  const chapterNumber = new Map(index.map((chapter, position) => [text(chapter.id), position + 1]));
  const ids = new Map(graph.nodes.map((node, position) => [node.id, `n${position}`]));
  const label = (value: string) => value.replace(/["\\]/g, "'").replace(/[\r\n]+/g, ' ').slice(0, 80);
  const chapterMode = graph.nodes.some((node) => node.chapterId);
  const lines = ['flowchart TD'];
  for (const node of graph.nodes) {
    const id = ids.get(node.id) as string;
    const number = chapterNumber.get(node.chapterId);
    if (chapterMode && node.chapterId) lines.push(`  ${id}["${number ? `${String(number).padStart(2, '0')} · ` : ''}${label(node.label)}"]`);
    else lines.push(`  ${id}("${label(node.label)}")`);
  }
  for (const edge of graph.edges) {
    const from = ids.get(edge.from);
    const to = ids.get(edge.to);
    if (!from || !to) continue;
    lines.push(`  ${from} ${edge.relation === 'extends' ? '==>' : edge.relation === 'related' ? '-.->' : '-->'} ${to}`);
  }
  return lines.join('\n');
}

/** The overview's chapter index: each chapter and its page. */
export function conceptMapIndex(block: DtBookBlock): { title: string; pageId: string; summary: string }[] {
  return rows(record(block.payload.index).chapters)
    .map((chapter) => ({ title: text(chapter.title), pageId: text(chapter.page_id), summary: text(chapter.summary) }))
    .filter((chapter) => chapter.title);
}

/** Counts for the overview's map: chapters (or concepts) and the links between them. */
export function conceptMapCounts(block: DtBookBlock): { chapters: boolean; nodes: number; edges: number } {
  const graph = graphOf(block.payload.graph);
  return { chapters: graph.nodes.some((node) => node.chapterId), nodes: graph.nodes.length, edges: graph.edges.length };
}

// ── Chat about a page ────────────────────────────────────────────────────────

/**
 * What a chat about a page sends with every message: the page, which DeepTutor reads to the
 * tutor, and the book's knowledge bases and language. No tool list, so your own tool settings
 * apply, as on DeepTutor.
 */
export function bookTurnFields(book: Pick<DtBook, 'id' | 'knowledgeBases' | 'language'>, pageId: string) {
  return {
    capability: 'chat',
    knowledgeBases: book.knowledgeBases,
    ...(book.language && book.language !== 'auto' ? { language: book.language } : {}),
    bookReferences: [{ book_id: book.id, page_ids: [pageId] }],
  };
}

/** The book and page a chat is about, from its saved preferences; null for any other chat. */
export function bookOfPreferences(preferences: Record<string, unknown> | null | undefined): { bookId: string; pageId: string } | null {
  const bookId = text(preferences?.book_id).trim();
  if (!bookId) return null;
  return { bookId, pageId: text(preferences?.book_page_id).trim() };
}

// ── The /ws/books socket ─────────────────────────────────────────────────────

/** The `/ws/books` address behind a DeepTutor web address. */
export function bookSocketUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '').replace(/^http/i, 'ws')}/ws/books`;
}

/** One event of a book's writing. What happened is `kind` (DeepTutor's own name for it), else `type`. */
export interface DtBookEvent {
  type: string;
  stage: string;
  kind: string;
  /** The page it's about, for page events. */
  pageId: string;
  content: string;
  metadata: Record<string, unknown>;
  seq: number;
}

export type DtBookMessage =
  | { type: 'subscribed'; bookId: string; latestSeq: number; reset: boolean }
  | { type: 'result'; action: string; body: Record<string, unknown> }
  | { type: 'error'; message: string; status: number; code: string; currentRevision: number | null }
  | { type: 'event'; event: DtBookEvent };

/** Reads one frame of the `/ws/books` socket; null for anything else. */
export function parseBookMessage(raw: unknown): DtBookMessage | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const message = record(value);
  const type = text(message.type);
  if (!type) return null;
  if (type === 'subscribed') return { type, bookId: text(message.book_id), latestSeq: number(message.latest_seq), reset: message.reset === true };
  if (type.endsWith('_result')) return { type: 'result', action: type.slice(0, -'_result'.length), body: message };
  if (type === 'error') {
    return {
      type,
      message: text(message.content) || 'DeepTutor refused.',
      status: number(message.status),
      code: text(message.code),
      currentRevision: typeof message.current_revision === 'number' ? message.current_revision : null,
    };
  }
  const metadata = record(message.metadata);
  return {
    type: 'event',
    event: {
      type,
      stage: text(message.stage),
      kind: text(metadata.kind) || (type === 'progress' ? '' : type),
      pageId: text(metadata.page_id),
      content: text(message.content),
      metadata,
      seq: number(message.seq),
    },
  };
}

/** DeepTutor refused a book action; `code` is "book_paused", "book_revision_conflict", "disconnected", "timeout"… */
export class DtBookActionError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'DtBookActionError';
    this.status = status;
    this.code = code;
  }
}

export interface DtBookSocketOptions {
  url: string;
  connect: DtSocketFactory;
  timers?: DtTimers;
}

const defaultTimers: DtTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => {
    if (handle !== null && handle !== undefined) clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/** As DeepTutor's web app: an action gives up after this long without a word from the socket. */
const ACTION_IDLE_MS = 5 * 60_000;

/**
 * Runs one action on a socket of its own, as DeepTutor's web app does (results carry no id, so
 * one action per socket), and resolves with its result. The book's events on the way go to
 * `onEvent`. If the socket drops, DeepTutor carries on: read the book again to see where it got.
 */
export function runBookAction(options: DtBookSocketOptions, message: Record<string, unknown>, onEvent?: (event: DtBookEvent) => void, idleMs = ACTION_IDLE_MS): Promise<Record<string, unknown>> {
  const timers = options.timers ?? defaultTimers;
  return new Promise((resolve, reject) => {
    let settled = false;
    let socket: DtSocketHandle | null = null;
    let opened = false;
    let sent = false;
    let idle: unknown = null;
    const finish = (error: Error | null, body?: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      timers.clear(idle);
      socket?.close();
      if (error) reject(error);
      else resolve(body ?? {});
    };
    const wait = () => {
      timers.clear(idle);
      idle = timers.set(() => finish(new DtBookActionError('DeepTutor went quiet. It may still be working on it.', 0, 'timeout')), idleMs);
    };
    // A socket may open before `connect` returns it.
    const send = () => {
      if (!opened || !socket || sent || settled) return;
      sent = true;
      socket.send(JSON.stringify(message));
    };
    wait();
    socket = options.connect(options.url, {
      onOpen: () => {
        opened = true;
        send();
      },
      onMessage: (data) => {
        const parsed = parseBookMessage(data);
        if (!parsed) return;
        wait();
        if (parsed.type === 'result') finish(null, parsed.body);
        else if (parsed.type === 'error') finish(new DtBookActionError(parsed.message, parsed.status, parsed.code));
        else if (parsed.type === 'event') onEvent?.(parsed.event);
      },
      onClose: (code) =>
        finish(
          code === SOCKET_AUTH_FAILED
            ? new DtBookActionError('DeepTutor no longer accepts this sign-in.', 401, 'signed_out')
            : new DtBookActionError('The connection to DeepTutor dropped. It may still be working on it.', 0, 'disconnected'),
        ),
    });
    send();
  });
}

/** Writes a book's proposal (one model call, up to about a minute). */
export async function createBook(options: DtBookSocketOptions, request: DtBookRequest, onEvent?: (event: DtBookEvent) => void): Promise<DtBook> {
  const body = await runBookAction(options, createBookMessage(request), onEvent);
  const book = bookOf(body.book);
  // The socket's result has the proposal beside the book; the book itself is yours to edit.
  return { ...book, proposal: book.proposal ?? proposalOf(body.proposal), rawProposal: book.rawProposal ?? (Object.keys(record(body.proposal)).length ? record(body.proposal) : null) };
}

/**
 * Confirms the proposal: DeepTutor reads your sources and drafts the outline, then checks it
 * (several model calls; minutes with large sources). Resolves with the book's new revision.
 */
export async function confirmProposal(options: DtBookSocketOptions, book: Pick<DtBook, 'id' | 'revision'>, proposal: Record<string, unknown> | null, onEvent?: (event: DtBookEvent) => void): Promise<number> {
  const body = await runBookAction(options, { type: 'confirm_proposal', book_id: book.id, proposal, expected_revision: book.revision }, onEvent);
  return number(body.book_revision);
}

/**
 * Writes a page (joins the writing already under way, if any). Without `force`, only what isn't
 * written yet is written; with it, the page's blocks are written again (your notes stay).
 */
export async function compileBookPage(options: DtBookSocketOptions, book: Pick<DtBook, 'id' | 'revision'>, pageId: string, force = false): Promise<DtBookPage> {
  const body = await runBookAction(options, { type: 'compile_page', book_id: book.id, page_id: pageId, force, expected_revision: book.revision });
  return bookPageOf(body.page);
}

/** Writes one block again (a failed one, say). */
export async function regenerateBookBlock(options: DtBookSocketOptions, book: Pick<DtBook, 'id' | 'revision'>, pageId: string, blockId: string): Promise<void> {
  await runBookAction(options, { type: 'regenerate_block', book_id: book.id, page_id: pageId, block_id: blockId, expected_revision: book.revision });
}

/** Seconds to wait before each reconnect, as DeepTutor's web app waits. */
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 5000, 10_000];

export type DtBookWatchState = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'signed-out';

export interface DtBookWatchOptions extends DtBookSocketOptions {
  bookId: string;
  onEvent(event: DtBookEvent): void;
  /** DeepTutor's stream started again (it restarted): forget what the events built up. */
  onReset?(): void;
  onState?(state: DtBookWatchState): void;
}

/**
 * Follows one book's events. DeepTutor replays the recent ones on subscribing, so after a drop
 * (iOS closes sockets in the background) it subscribes again from the last one seen.
 */
export class DtBookWatch {
  private readonly options: DtBookWatchOptions;
  private readonly timers: DtTimers;
  private socket: DtSocketHandle | null = null;
  private generation = 0;
  private cursor = 0;
  private attempt = 0;
  private retry: unknown = null;
  private stopped = true;

  constructor(options: DtBookWatchOptions) {
    this.options = options;
    this.timers = options.timers ?? defaultTimers;
  }

  start(): void {
    this.stopped = false;
    if (!this.socket) this.connect();
  }

  /** Back in the foreground: subscribe again now rather than at the next retry. */
  wake(): void {
    if (this.stopped || this.socket) return;
    this.timers.clear(this.retry);
    this.attempt = 0;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    this.timers.clear(this.retry);
    this.socket?.close();
    this.socket = null;
    this.options.onState?.('closed');
  }

  private connect(): void {
    const generation = ++this.generation;
    const current = () => generation === this.generation;
    this.options.onState?.(this.attempt ? 'reconnecting' : 'connecting');
    let handle: DtSocketHandle | null = null;
    let opened = false;
    let closed = false;
    let subscribed = false;
    // A socket may open (or close) before `connect` returns it.
    const subscribe = () => {
      if (!opened || closed || subscribed || !handle || !current()) return;
      subscribed = true;
      handle.send(JSON.stringify({ type: 'subscribe', book_id: this.options.bookId, after_seq: this.cursor }));
      this.options.onState?.('open');
    };
    handle = this.options.connect(this.options.url, {
      onOpen: () => {
        if (!current()) return;
        this.attempt = 0;
        opened = true;
        subscribe();
      },
      onMessage: (data) => {
        if (!current()) return;
        const message = parseBookMessage(data);
        if (!message) return;
        if (message.type === 'subscribed') {
          if (message.reset) {
            this.cursor = 0;
            this.options.onReset?.();
          }
          return;
        }
        if (message.type !== 'event') return;
        const { seq } = message.event;
        if (seq > 0) {
          if (seq <= this.cursor) return;
          this.cursor = seq;
        }
        this.options.onEvent(message.event);
      },
      onClose: (code) => {
        if (!current() || closed) return;
        closed = true;
        this.socket = null;
        if (code === SOCKET_AUTH_FAILED) {
          this.stopped = true;
          this.options.onState?.('signed-out');
          return;
        }
        if (this.stopped) return;
        const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)] as number;
        this.attempt += 1;
        this.options.onState?.('reconnecting');
        this.retry = this.timers.set(() => {
          if (!this.stopped && !this.socket) this.connect();
        }, delay);
      },
    });
    if (!closed) this.socket = handle;
    subscribe();
  }
}

/** A page being written now: its planned blocks and how far it got. */
export interface DtPageWriting {
  title: string;
  planning: boolean;
  planned: string[];
  done: number;
  /** The block type being written now, or "". */
  current: string;
}

/** What the outline's making is doing now. */
export interface DtOutlineWriting {
  phase: 'reading' | 'drafting' | 'checking';
  queries: number;
  passages: number;
  /** Rounds of checking so far. */
  rounds: number;
  /** The sources couldn't be read: the outline comes from the proposal alone. */
  sourcesFailed: boolean;
}

/** What the book's events say is under way; REST says what's done. */
export interface DtBookLive {
  outline: DtOutlineWriting | null;
  pages: Record<string, DtPageWriting>;
  /** The chapter written last (its page). */
  latestPageId: string;
}

export const EMPTY_BOOK_LIVE: DtBookLive = { outline: null, pages: {}, latestPageId: '' };

/** Kinds after which a page should be read again. */
export const PAGE_EVENT_KINDS = new Set(['page_compile_started', 'page_planned', 'block_ready', 'block_error', 'page_compiled']);
/** Kinds after which the book (its status, its pages' statuses) should be read again. */
export const BOOK_EVENT_KINDS = new Set(['spine_ready', 'overview_ready', 'book_ready', 'compilation_paused', 'page_compiled', 'exploration_failed']);

export function applyBookEvent(live: DtBookLive, event: DtBookEvent): DtBookLive {
  const { kind, pageId } = event;
  const metadata = event.metadata;
  const page = (patch: Partial<DtPageWriting>): DtBookLive => {
    if (!pageId) return live;
    const before = live.pages[pageId] ?? { title: '', planning: false, planned: [], done: 0, current: '' };
    return { ...live, pages: { ...live.pages, [pageId]: { ...before, ...patch } }, latestPageId: pageId };
  };
  const outline = (patch: Partial<DtOutlineWriting>): DtBookLive => ({
    ...live,
    outline: { ...(live.outline ?? { phase: 'reading', queries: 0, passages: 0, rounds: 0, sourcesFailed: false }), ...patch },
  });

  if (event.type === 'stage_start' && (event.stage === 'spine' || event.stage === 'exploration')) return outline({ phase: 'reading' });
  if (event.type === 'stage_start' && event.stage === 'synthesis') return outline({ phase: 'drafting' });
  if (event.type === 'stage_end' && event.stage === 'spine') return { ...live, outline: null };
  switch (kind) {
    case 'exploration_ready': {
      const coverage = Object.values(record(metadata.coverage)).reduce<number>((sum, count) => sum + number(count), 0);
      return outline({ queries: strings(metadata.queries).length, passages: coverage });
    }
    case 'exploration_failed':
      return outline({ sourcesFailed: true });
    case 'spine_round': {
      const round = text(metadata.round);
      if (round.startsWith('critique')) return outline({ phase: 'checking', rounds: (live.outline?.rounds ?? 0) + 1 });
      return outline({ phase: 'drafting' });
    }
    case 'spine_ready':
      return { ...live, outline: null };
    case 'page_compile_started':
      return page({ title: text(metadata.title), planning: false, done: 0, current: '' });
    case 'page_planning':
      return page({ title: text(metadata.title) || live.pages[pageId]?.title || '', planning: true });
    case 'page_planned':
      return page({ planning: false, planned: strings(metadata.block_types) });
    case 'block_started':
      return page({ current: text(metadata.block_type) });
    case 'block_ready':
    case 'block_error':
      return page({ done: (live.pages[pageId]?.done ?? 0) + 1, current: '' });
    case 'page_compiled': {
      if (!pageId) return live;
      const pages = { ...live.pages };
      delete pages[pageId];
      return { ...live, pages };
    }
    case 'compilation_paused':
    case 'book_ready':
      return { ...live, pages: {} };
    default:
      return live;
  }
}
