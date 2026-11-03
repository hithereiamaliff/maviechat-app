import { describe, expect, it } from 'vitest';
import {
  applyBookEvent,
  blockVisual,
  bookActivity,
  bookDetailOf,
  bookEstimate,
  bookOf,
  bookOfPreferences,
  bookQuizQuestions,
  bookSocketUrl,
  bookTurnFields,
  bookView,
  chapterDrafts,
  conceptMapMermaid,
  createBookMessage,
  deepDivesOf,
  DtBookWatch,
  EMPTY_BOOK_LIVE,
  initialBlockTypes,
  landingPage,
  looseJson,
  newChapterDraft,
  parseBookMessage,
  proposalForConfirm,
  runBookAction,
  sectionOf,
  spineForConfirm,
  type DtBookEvent,
} from './books';
import type { DtSocketHandlers } from './turnConnection';
import { startTurnCommand } from './turns';

const rawBook = {
  id: 'bk_0123456789',
  revision: 4,
  title: 'Waves',
  description: 'Sound and light',
  status: 'compiling',
  proposal: { title: 'Waves', description: 'Sound and light', scope: 'Intro', target_level: 'beginner', estimated_chapters: 3, rationale: 'why', extra_field: 1 },
  knowledge_bases: ['physics'],
  language: 'en',
  depth: 'standard',
  page_count: 4,
  chapter_count: 3,
  created_at: 100.5,
  updated_at: 200.25,
  metadata: { page_chat_sessions: { pg_b: 'sess_1', pg_c: '' }, lazy_compile: true, block_types: ['section', 'quiz'], pause_reason: '' },
  source: 'own',
  permission: 'edit',
  can_edit: true,
  can_delete: true,
  reading: { current_page_id: 'pg_b', visited_pages: 2, total_pages: 4, percent: 50 },
};

const spine = {
  book_id: 'bk_0123456789',
  version: 2,
  exploration_summary: 'summary',
  concept_graph: {
    nodes: [
      { id: 'waves', label: 'Waves', chapter_id: 'ch_b' },
      { id: 'sound', label: 'Sound "pressure"', chapter_id: 'ch_c' },
    ],
    edges: [{ src: 'waves', dst: 'sound', relation: 'extends' }],
  },
  chapters: [
    { id: 'ch_a', title: 'Overview', content_type: 'overview', auto_overview: true, order: 0, page_ids: ['pg_a'] },
    { id: 'ch_b', title: 'What a wave is', content_type: 'theory', order: 1, learning_objectives: ['Define a wave'], source_anchors: [{ kind: 'kb' }], covers: ['waves'], page_ids: ['pg_b'] },
    { id: 'ch_c', title: 'Sound', content_type: 'concept', order: 2, summary: 'Pressure waves', page_ids: ['pg_c'] },
    { id: 'ch_d', title: 'Deeper: Doppler', content_type: 'concept', order: 3, deep_dive: true, page_ids: ['pg_d'] },
  ],
};

const detail = (overrides: Record<string, unknown> = {}, pages?: unknown[]) =>
  bookDetailOf({
    book: { ...rawBook, ...overrides },
    spine,
    pages: pages ?? [
      { id: 'pg_c', chapter_id: 'ch_c', title: 'Sound', status: 'generating', order: 2, blocks: [], block_count: 0, created_at: 3 },
      { id: 'pg_a', chapter_id: 'ch_a', title: 'Overview', content_type: 'overview', status: 'ready', order: 0, blocks: [], block_count: 3, created_at: 1 },
      { id: 'pg_d', chapter_id: 'ch_d', title: 'Doppler', status: 'pending', order: 3, parent_page_id: 'pg_c', blocks: [], created_at: 4 },
      { id: 'pg_b', chapter_id: 'ch_b', title: 'What a wave is', status: 'ready', order: 1, blocks: [], block_count: 5, created_at: 2 },
    ],
    progress: { current_page_id: 'pg_b', visited_page_ids: ['pg_a', 'pg_b'], bookmarked_page_ids: ['pg_b'], quiz_attempts: [{ block_id: 'blk_1', question_id: 'q1', user_answer: 'A', is_correct: true }] },
    generation: { status: 'compiling', working: false, interrupted: true, started_at: 150, failed_pages: 1, failure_categories: { rate_limit: 2, junk: 'x' } },
  });

describe('books', () => {
  it('reads a book row, its proposal and its chats', () => {
    const book = bookOf(rawBook);
    expect(book).toMatchObject({ id: 'bk_0123456789', revision: 4, status: 'compiling', lazy: true, blockTypes: ['section', 'quiz'], shared: false, canEdit: true, canDelete: true });
    expect(book.proposal).toEqual({ title: 'Waves', description: 'Sound and light', scope: 'Intro', targetLevel: 'beginner', estimatedChapters: 3, rationale: 'why' });
    expect(book.pageChats).toEqual({ pg_b: 'sess_1' });
    expect(book.reading).toEqual({ currentPageId: 'pg_b', visitedPages: 2, totalPages: 4, percent: 50 });
    // A shared book seen through a socket result (no capability fields) can't be deleted.
    expect(bookOf({ id: 'x', source: 'shared', permission: 'read' })).toMatchObject({ shared: true, canEdit: false, canDelete: false });
  });

  it('sends the proposal back with your changes and what the app does not show', () => {
    const book = bookOf(rawBook);
    const sent = proposalForConfirm(book, { ...(book.proposal as NonNullable<typeof book.proposal>), title: '  Waves 101 ', estimatedChapters: 40 });
    expect(sent).toMatchObject({ title: 'Waves 101', estimated_chapters: 12, target_level: 'beginner', rationale: 'why', extra_field: 1 });
  });

  it('orders pages for reading and picks where to land', () => {
    const book = detail();
    expect(book.pages.map((page) => page.id)).toEqual(['pg_a', 'pg_b', 'pg_c', 'pg_d']);
    expect(book.book.generation).toMatchObject({ interrupted: true, failedPages: 1, failureCategories: { rate_limit: 2 } });
    expect(landingPage(book)?.id).toBe('pg_b');
    expect(landingPage(book, 'pg_c')?.id).toBe('pg_c');
    expect(landingPage(book, 'nope')?.id).toBe('pg_b');
    expect(book.progress.quizAttempts[0]).toMatchObject({ blockId: 'blk_1', questionId: 'q1', answer: 'A', correct: true });
  });

  it('knows which step a book is at', () => {
    expect(bookView(detail({ status: 'draft' }))).toBe('proposal');
    const fresh = detail({ status: 'spine_ready' }, [{ id: 'pg_b', chapter_id: 'ch_b', status: 'pending', blocks: [] }]);
    expect(bookView(fresh)).toBe('outline');
    expect(bookView(detail({ status: 'spine_ready' }))).toBe('reader');
    expect(bookView(detail({ status: 'draft', can_edit: false }))).toBe('reader');
  });

  it("tells writing from stopped, and a first-chapter-only book from either", () => {
    // Lazy and nothing written now: idle, though DeepTutor says interrupted.
    expect(bookActivity(detail()).kind).toBe('writing'); // pg_c is generating
    const quiet = detail({}, [{ id: 'pg_b', chapter_id: 'ch_b', status: 'ready', blocks: [] }]);
    expect(bookActivity(quiet)).toMatchObject({ kind: 'idle', ready: 1, total: 1, startedAt: 150 });
    const eager = bookDetailOf({ book: { ...rawBook, metadata: {} }, spine, pages: [{ id: 'pg_b', chapter_id: 'ch_b', status: 'pending' }], generation: { working: false } });
    expect(bookActivity(eager).kind).toBe('stopped');
    expect(bookActivity(eager, true).kind).toBe('writing');
    expect(bookActivity(detail({ status: 'paused' })).kind).toBe('paused');
  });

  it('edits the outline and confirms it with the overview first and deep dives last', () => {
    const parsed = detail().spine!;
    const drafts = chapterDrafts(parsed);
    expect(drafts.map((draft) => draft.id)).toEqual(['ch_b', 'ch_c']);
    const added = { ...newChapterDraft(), title: 'Light', objectives: [' See ', ''] };
    expect(added.id).toMatch(/^ch_[0-9a-f]{10}$/);
    const sent = spineForConfirm(parsed, 'bk_0123456789', [drafts[1]!, { ...drafts[0]!, title: 'Waves, defined', contentType: 'nonsense' }, { ...added }, { ...newChapterDraft(), title: '   ' }]);
    const chapters = sent.chapters as Record<string, unknown>[];
    expect(chapters.map((chapter) => chapter.id)).toEqual(['ch_a', 'ch_c', 'ch_b', added.id, 'ch_d']);
    expect(chapters.map((chapter) => chapter.order)).toEqual([0, 1, 2, 3, 4]);
    expect(chapters[2]).toMatchObject({ title: 'Waves, defined', content_type: 'theory', covers: ['waves'], source_anchors: [{ kind: 'kb' }] });
    expect(chapters[3]).toMatchObject({ title: 'Light', learning_objectives: ['See'], prerequisites: [], page_ids: [] });
    expect(sent).toMatchObject({ book_id: 'bk_0123456789', version: 2, exploration_summary: 'summary' });
  });

  it('estimates the outline and picks the block types', () => {
    const basis = { theory: { blocks: 8, words: 3600, seconds: 210 }, concept: { blocks: 7, words: 2649, seconds: 165 } };
    expect(bookEstimate(basis, [{ ...newChapterDraft(), title: 'a' }, { ...newChapterDraft(), title: 'b', contentType: 'concept' }, { ...newChapterDraft() }])).toEqual({ chapters: 2, words: 6200, minutes: 7 });
    expect(bookEstimate({}, [])).toBeNull();
    const catalog = [
      { type: 'animation', plannerDefault: true },
      { type: 'quiz', plannerDefault: true },
      { type: 'section', plannerDefault: true },
      { type: 'text', plannerDefault: false },
    ];
    expect(initialBlockTypes(catalog, null)).toEqual(['animation', 'quiz']);
    expect(initialBlockTypes(catalog, ['section', 'text'])).toEqual(['text']);
  });

  it('asks for a book as the web app does', () => {
    const message = createBookMessage({
      intent: '  Learn waves ',
      sources: [{ kind: 'knowledge_base', sourceId: 'physics', label: 'Physics', metadata: { content_workspace_id: '' } }],
      knowledgeBases: ['physics'],
      language: '',
      fallbackLanguage: 'en',
      depth: 'deep',
    });
    expect(message).toMatchObject({ type: 'create', user_intent: 'Learn waves', language: 'auto', depth: 'deep', knowledge_bases: ['physics'], chat_selections: [] });
    expect(message.source_refs).toEqual([{ kind: 'knowledge_base', label: 'Physics', source_id: 'physics', excerpt: '', available: true, metadata: { content_workspace_id: '' } }]);
  });

  it('reads blocks', () => {
    const section = sectionOf({ id: 'b', type: 'section', status: 'ready', title: '', params: {}, metadata: {}, error: '', failure: null, payload: { intro: 'Hi', focus: 'f', subsections: [{ heading: 'One', body: '### One\nText' }, { heading: 'Two', body: '' }], key_takeaway: 'k' } });
    expect(section).toEqual({ intro: 'Hi', focus: 'f', parts: ['### One\nText', '### Two'], takeaway: 'k' });

    const quiz = bookQuizQuestions({
      id: 'blk_q',
      type: 'quiz',
      status: 'ready',
      title: '',
      params: {},
      metadata: {},
      error: '',
      failure: null,
      payload: { questions: [{ question: 'Q1', question_type: 'mcq', options: { A: 'x', B: 'y' }, correct_answer: 'B' }, { question_id: 'own', question: 'Q2', question_type: 'true_false', correct_answer: 'true' }, { question: '' }] },
    });
    expect(quiz.map((question) => [question.id, question.type])).toEqual([
      ['blk_q:1', 'choice'],
      ['own', 'concept'],
    ]);

    const dives = deepDivesOf({ id: 'd', type: 'deep_dive', status: 'ready', title: '', params: {}, error: '', failure: null, payload: { suggestions: [{ topic: 'A' }, { topic: 'B' }] }, metadata: { deep_dive_page_id: 'pg_old', deep_dive_pages: { B: 'pg_b2' } } });
    expect(dives.map((dive) => dive.pageId)).toEqual(['pg_old', 'pg_b2']);
  });

  it('reads figures, loose Chart.js settings included', () => {
    const block = (payload: Record<string, unknown>, type = 'figure') => ({ id: 'f', type, status: 'ready', title: '', params: {}, metadata: {}, error: '', failure: null, payload });
    expect(blockVisual(block({ code: { language: 'svg', content: '<svg/>' } })).renderType).toBe('svg');
    expect(blockVisual(block({ code: { language: 'html', content: '<p>x</p>' } }, 'interactive')).renderType).toBe('html');
    const chart = blockVisual(block({ render_type: 'chartjs', code: { language: 'javascript', content: "```js\n{type: 'bar', data: {labels: ['a', \"b's\"], datasets: [{data: [1, 2,],},]}, // note\n}\n```" } }));
    expect(JSON.parse(chart.data)).toEqual({ type: 'bar', data: { labels: ['a', "b's"], datasets: [{ data: [1, 2] }] } });
    expect(looseJson('{"title": "Speed, time: distance", note: \'it\\\'s\'}')).toEqual({ title: 'Speed, time: distance', note: "it's" });
    expect(looseJson('function () {}')).toBeUndefined();
  });

  it("draws the overview's map from its graph", () => {
    const mermaid = conceptMapMermaid({
      id: 'g',
      type: 'concept_graph',
      status: 'ready',
      title: '',
      params: {},
      metadata: {},
      error: '',
      failure: null,
      payload: { graph: spine.concept_graph, index: { chapters: [{ id: 'ch_b', title: 'What a wave is' }, { id: 'ch_c', title: 'Sound' }] }, code: { content: 'graph LR' } },
    });
    expect(mermaid).toBe(['flowchart TD', '  n0["01 · Waves"]', `  n1["02 · Sound 'pressure'"]`, '  n0 ==> n1'].join('\n'));
  });

  it('chats about a page with the page in the turn', () => {
    const fields = bookTurnFields(bookOf(rawBook), 'pg_b');
    const command = startTurnCommand({ content: 'Explain', sessionId: 's', ...fields });
    expect(command).toMatchObject({ capability: 'chat', knowledge_bases: ['physics'], language: 'en', book_references: [{ book_id: 'bk_0123456789', page_ids: ['pg_b'] }] });
    expect(command.tools).toBeUndefined();
    expect(bookOfPreferences({ book_id: 'bk_1', book_page_id: 'pg_1' })).toEqual({ bookId: 'bk_1', pageId: 'pg_1' });
    expect(bookOfPreferences({ workspace_mode: 'mastery_path' })).toBeNull();
  });

  it('reads socket frames', () => {
    expect(bookSocketUrl('https://learn.example.com/')).toBe('wss://learn.example.com/ws/books');
    expect(parseBookMessage('{"type":"subscribed","book_id":"b","latest_seq":7,"reset":true}')).toEqual({ type: 'subscribed', bookId: 'b', latestSeq: 7, reset: true });
    expect(parseBookMessage({ type: 'error', content: 'Paused', status: 409, code: 'book_paused' })).toMatchObject({ type: 'error', status: 409, code: 'book_paused' });
    expect(parseBookMessage({ type: 'compile_page_result', page: {} })).toMatchObject({ type: 'result', action: 'compile_page' });
    expect(parseBookMessage({ type: 'progress', content: 'block_ready', metadata: { kind: 'block_ready', page_id: 'p' }, seq: 3 })).toMatchObject({ type: 'event', event: { kind: 'block_ready', pageId: 'p', seq: 3 } });
    expect(parseBookMessage('nonsense')).toBeNull();
  });
});

const event = (type: string, stage: string, kind: string, metadata: Record<string, unknown> = {}, seq = 0): DtBookEvent => ({
  type,
  stage,
  kind,
  pageId: typeof metadata.page_id === 'string' ? metadata.page_id : '',
  content: '',
  metadata,
  seq,
});

describe('book events', () => {
  it('follows the outline being made', () => {
    let live = applyBookEvent(EMPTY_BOOK_LIVE, event('stage_start', 'spine', ''));
    expect(live.outline?.phase).toBe('reading');
    live = applyBookEvent(live, event('progress', 'exploration', 'exploration_ready', { queries: ['a', 'b'], coverage: { physics: 5, chat: 2 } }));
    expect(live.outline).toMatchObject({ queries: 2, passages: 7 });
    live = applyBookEvent(live, event('stage_start', 'synthesis', ''));
    live = applyBookEvent(live, event('progress', 'critique', 'spine_round', { round: 'critique_1' }));
    expect(live.outline).toMatchObject({ phase: 'checking', rounds: 1 });
    live = applyBookEvent(live, event('progress', 'spine', 'spine_ready'));
    expect(live.outline).toBeNull();
  });

  it('follows a page being written', () => {
    let live = applyBookEvent(EMPTY_BOOK_LIVE, event('progress', 'compilation', 'page_compile_started', { page_id: 'p', title: 'Sound' }));
    live = applyBookEvent(live, event('progress', 'page_plan', 'page_planning', { page_id: 'p' }));
    expect(live.pages.p).toMatchObject({ title: 'Sound', planning: true });
    live = applyBookEvent(live, event('progress', 'page_plan', 'page_planned', { page_id: 'p', block_types: ['section', 'quiz'] }));
    live = applyBookEvent(live, event('progress', 'block', 'block_started', { page_id: 'p', block_type: 'section' }));
    expect(live.pages.p).toMatchObject({ planning: false, planned: ['section', 'quiz'], current: 'section', done: 0 });
    live = applyBookEvent(live, event('progress', 'block', 'block_ready', { page_id: 'p' }));
    expect(live.pages.p).toMatchObject({ done: 1, current: '' });
    live = applyBookEvent(live, event('progress', 'compilation', 'page_compiled', { page_id: 'p' }));
    expect(live.pages.p).toBeUndefined();
    expect(live.latestPageId).toBe('p');
  });
});

function fakeSockets() {
  const sockets: { url: string; handlers: DtSocketHandlers; sent: string[]; closed: boolean }[] = [];
  const timers: { run: () => void; ms: number; id: number }[] = [];
  let next = 0;
  return {
    sockets,
    timers,
    options: {
      url: 'wss://x/ws/books',
      connect: (url: string, handlers: DtSocketHandlers) => {
        const socket = { url, handlers, sent: [] as string[], closed: false };
        sockets.push(socket);
        return {
          send: (data: string) => socket.sent.push(data),
          close: () => {
            socket.closed = true;
          },
        };
      },
      timers: {
        set: (run: () => void, ms: number) => {
          next += 1;
          timers.push({ run, ms, id: next });
          return next;
        },
        clear: (id: unknown) => {
          const index = timers.findIndex((timer) => timer.id === id);
          if (index >= 0) timers.splice(index, 1);
        },
      },
    },
  };
}

describe('book sockets', () => {
  it('runs one action per socket and resolves with its result', async () => {
    const { sockets, options } = fakeSockets();
    const seen: string[] = [];
    const running = runBookAction(options, { type: 'compile_page', book_id: 'b' }, (item) => seen.push(item.kind));
    const socket = sockets[0]!;
    socket.handlers.onOpen();
    expect(JSON.parse(socket.sent[0]!)).toEqual({ type: 'compile_page', book_id: 'b' });
    socket.handlers.onMessage(JSON.stringify({ type: 'progress', metadata: { kind: 'block_ready', page_id: 'p' }, seq: 4 }));
    socket.handlers.onMessage(JSON.stringify({ type: 'compile_page_result', page: { id: 'p' }, book_revision: 5 }));
    await expect(running).resolves.toMatchObject({ book_revision: 5 });
    expect(seen).toEqual(['block_ready']);
    expect(socket.closed).toBe(true);
  });

  it('fails an action on refusal, a drop or silence', async () => {
    const { sockets, timers, options } = fakeSockets();
    const refused = runBookAction(options, { type: 'compile_page' });
    sockets[0]!.handlers.onMessage({ type: 'error', content: 'Paused', status: 409, code: 'book_paused' });
    await expect(refused).rejects.toMatchObject({ code: 'book_paused', status: 409 });

    const dropped = runBookAction(options, { type: 'create' });
    sockets[1]!.handlers.onClose(1006);
    await expect(dropped).rejects.toMatchObject({ code: 'disconnected' });

    const quiet = runBookAction(options, { type: 'create' }, undefined, 1000);
    timers.find((timer) => timer.ms === 1000)!.run();
    await expect(quiet).rejects.toMatchObject({ code: 'timeout' });
  });

  it('follows a book, replays after a drop and starts over on a reset', () => {
    const { sockets, timers, options } = fakeSockets();
    const seen: number[] = [];
    let resets = 0;
    const watch = new DtBookWatch({ ...options, bookId: 'b', onEvent: (item) => seen.push(item.seq), onReset: () => (resets += 1) });
    watch.start();
    sockets[0]!.handlers.onOpen();
    expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual({ type: 'subscribe', book_id: 'b', after_seq: 0 });
    for (const seq of [1, 2, 2, 3]) sockets[0]!.handlers.onMessage({ type: 'progress', metadata: { kind: 'block_ready' }, seq });
    expect(seen).toEqual([1, 2, 3]);

    sockets[0]!.handlers.onClose(1006);
    expect(timers.map((timer) => timer.ms)).toEqual([500]);
    timers[0]!.run();
    sockets[1]!.handlers.onOpen();
    expect(JSON.parse(sockets[1]!.sent[0]!)).toMatchObject({ after_seq: 3 });

    sockets[1]!.handlers.onMessage({ type: 'subscribed', book_id: 'b', latest_seq: 1, reset: true });
    sockets[1]!.handlers.onMessage({ type: 'progress', metadata: { kind: 'block_ready' }, seq: 1 });
    expect(resets).toBe(1);
    expect(seen).toEqual([1, 2, 3, 1]);

    watch.stop();
    expect(sockets[1]!.closed).toBe(true);
    sockets[1]!.handlers.onClose(1000);
    expect(timers).toHaveLength(0);
  });

  it('stops following when the sign-in is refused', () => {
    const { sockets, timers, options } = fakeSockets();
    const states: string[] = [];
    const watch = new DtBookWatch({ ...options, bookId: 'b', onEvent: () => undefined, onState: (state) => states.push(state) });
    watch.start();
    sockets[0]!.handlers.onClose(4001);
    expect(states).toEqual(['connecting', 'signed-out']);
    expect(timers).toHaveLength(0);
    watch.wake();
    expect(sockets).toHaveLength(1);
  });
});
