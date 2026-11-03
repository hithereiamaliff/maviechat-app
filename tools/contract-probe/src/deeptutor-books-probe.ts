import {
  applyBookEvent,
  applyTurnEvent,
  bookActivity,
  bookOfPreferences,
  bookQuizQuestions,
  bookSocketUrl,
  bookTurnFields,
  bookView,
  chapterDrafts,
  compileBookPage,
  conceptMapMermaid,
  confirmProposal,
  confirmSpine,
  createBook,
  deleteBook,
  deleteSession,
  DtBookWatch,
  DtTurnConnection,
  EMPTY_BOOK_LIVE,
  emptyReply,
  exportBook,
  getBook,
  getBookPage,
  getEstimateBasis,
  getSession,
  initialBlockTypes,
  linkPageChat,
  listBlockTypes,
  listBooks,
  pauseBook,
  proposalForConfirm,
  randomId,
  recordPageVisit,
  recordQuizAttempt,
  sectionOf,
  socketCookieHeader,
  spineForConfirm,
  toggleBookmark,
  turnSocketUrl,
  type DtBookEvent,
  type DtBookSocketOptions,
  type DtClient,
  type DtReply,
  type DtSocketFactory,
} from '@maviechat/deeptutor-protocol';
import { shapeOf } from './shape';

const NodeWebSocket = WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocket;

/** The app's sockets, in Node: the sign-in rides in the Cookie header, never the address. */
function nodeSockets(token: string): DtSocketFactory {
  return (url, handlers) => {
    const socket = new NodeWebSocket(url, { headers: { Cookie: socketCookieHeader(token) } });
    socket.onopen = () => handlers.onOpen();
    socket.onmessage = (event) => handlers.onMessage(event.data);
    socket.onclose = (event) => handlers.onClose(event.code);
    return { send: (data) => socket.send(data), close: () => socket.close() };
  };
}

/**
 * B5.2 against a live DeepTutor, in the test account: a small book made as the app makes one (a
 * brief proposal, renamed "APP PROBE:" and cut to two chapters, its outline confirmed "first
 * chapter only" with prose and a quiz), one chapter written over `/ws/books` while a second
 * socket follows the book's events; the page read, visited, bookmarked and unbookmarked, a
 * quiz answer recorded (with no verdict, so no learning record is made), the book exported, a
 * chat about the page linked to it, the writing paused; then the chat and the book deleted. Uses
 * the account's model for about twenty calls (a few minutes).
 */
export async function probeBooks(baseUrl: string, token: string, client: DtClient): Promise<{ note: string; fixture: Record<string, unknown> }> {
  const notes: string[] = [];
  const fixture: Record<string, unknown> = {};
  const connect = nodeSockets(token);
  const socket: DtBookSocketOptions = { url: bookSocketUrl(baseUrl), connect };
  let bookId: string | null = null;
  let sessionId: string | null = null;
  let watch: DtBookWatch | null = null;
  let reply: DtReply = emptyReply();
  let wake: () => void = () => undefined;
  const connection = new DtTurnConnection({
    url: turnSocketUrl(baseUrl),
    connect,
    onEvent: (event) => {
      reply = applyTurnEvent(reply, event);
      if (event.type === 'done') wake();
    },
    onError: (error) => {
      reply = { ...reply, status: 'failed', error: `${error.error_code}: ${error.message}` };
      wake();
    },
  });

  try {
    const library = await listBooks(client);
    fixture.library = { canCreate: library.canCreate, count: library.books.length };
    if (!library.canCreate) throw new Error('the test account may not write books');
    const catalog = await listBlockTypes(client);
    const basis = await getEstimateBasis(client, 'brief');
    fixture.blockTypes = catalog.map((option) => option.type);
    fixture.estimateBasis = shapeOf(basis);
    if (!catalog.some((option) => option.type === 'quiz') || !basis.theory) throw new Error('no quiz block type, or no estimate for theory chapters');
    notes.push(`${catalog.length} block types, ${initialBlockTypes(catalog, null).length} on by default; estimates read`);

    // The proposal: one model call, on a socket of its own.
    const creating: string[] = [];
    const created = await createBook(
      socket,
      { intent: 'A very short primer on the water cycle: evaporation and condensation only.', sources: [], knowledgeBases: [], language: 'auto', fallbackLanguage: 'en', depth: 'brief' },
      (event) => creating.push(event.kind || event.type),
    );
    bookId = created.id;
    if (!/^bk_[0-9a-f]{10}$/.test(created.id) || created.status !== 'draft' || !created.proposal?.title) throw new Error(`create gave ${created.status} without a proposal`);
    fixture.create = { events: [...new Set(creating)], book: shapeOf(created.rawProposal) };
    notes.push(`proposal written (${creating.length} events)`);

    // The book's own events, as the reader follows them, from here on.
    const seen: DtBookEvent[] = [];
    let live = EMPTY_BOOK_LIVE;
    watch = new DtBookWatch({
      ...socket,
      bookId: created.id,
      onEvent: (event) => {
        seen.push(event);
        live = applyBookEvent(live, event);
      },
    });
    watch.start();

    const draft = await getBook(client, created.id);
    if (bookView(draft) !== 'proposal') throw new Error(`a fresh draft opens as ${bookView(draft)}`);
    const proposal = proposalForConfirm(draft.book, { ...(draft.book.proposal as NonNullable<typeof draft.book.proposal>), title: 'APP PROBE: water cycle', estimatedChapters: 2 });
    const outlining: string[] = [];
    const revision = await confirmProposal(socket, draft.book, proposal, (event) => outlining.push(event.kind || `${event.type}:${event.stage}`));
    const outlined = await getBook(client, created.id);
    if (outlined.book.status !== 'spine_ready' || !outlined.spine || bookView(outlined) !== 'outline') throw new Error(`after the proposal: ${outlined.book.status}, view ${bookView(outlined)}`);
    if (outlined.book.title !== 'APP PROBE: water cycle') throw new Error("the proposal's new title didn't stick");
    fixture.outline = { events: [...new Set(outlining)], spine: shapeOf(outlined.spine.raw, 3), revision: typeof revision };
    notes.push(`outline: ${outlined.spine.chapters.length} chapters (${outlining.length} events)`);

    // The outline: two chapters, the first renamed; prose and a quiz; first chapter only.
    const drafts = chapterDrafts(outlined.spine).slice(0, 2);
    drafts[0] = { ...drafts[0]!, title: `${drafts[0]!.title} (probe)` };
    await confirmSpine(client, { book: outlined.book, spine: spineForConfirm(outlined.spine, created.id, drafts), autoCompile: false, blockTypes: ['quiz'] });
    const reading = await getBook(client, created.id);
    const chapters = reading.pages.filter((page) => page.contentType !== 'overview');
    const overview = reading.pages.find((page) => page.contentType === 'overview');
    if (reading.book.status !== 'compiling' || !reading.book.lazy || chapters.length !== 2 || overview?.status !== 'ready') {
      throw new Error(`after the outline: ${reading.book.status}, lazy ${reading.book.lazy}, ${chapters.length} chapters, overview ${overview?.status}`);
    }
    if (bookView(reading) !== 'reader' || bookActivity(reading).kind !== 'idle') throw new Error(`a first-chapter-only book shows ${bookView(reading)} / ${bookActivity(reading).kind}`);
    if (!chapters[0]!.title.endsWith('(probe)') || JSON.stringify(reading.book.blockTypes) !== JSON.stringify(['section', 'quiz'])) throw new Error('the renamed chapter or the block types did not stick');
    const overviewPage = await getBookPage(client, created.id, overview.id);
    const map = overviewPage.blocks.find((block) => block.type === 'concept_graph');
    fixture.overview = { blocks: overviewPage.blocks.map((block) => block.type), graph: map ? shapeOf(map.payload, 3) : null };
    if (!map || !conceptMapMermaid(map)) throw new Error("the overview has no chapter map to draw");
    notes.push(`writing started (first chapter only); overview: ${overviewPage.blocks.map((block) => block.type).join(', ')}`);

    // One chapter written, on a socket of its own; the watch sees its events too.
    const page = chapters[0]!;
    const written = await compileBookPage(socket, reading.book, page.id).catch(async (error: unknown) => {
      // The action socket can drop on a long write; DeepTutor finishes anyway.
      notes.push(`write: ${error instanceof Error ? error.message : String(error)}; waiting on the page`);
      for (let tries = 0; tries < 60; tries += 1) {
        const now = await getBookPage(client, created.id, page.id);
        if (now.status === 'ready' || now.status === 'partial' || now.status === 'error') return now;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      throw new Error('the chapter was not written within five minutes');
    });
    const full = await getBookPage(client, created.id, page.id);
    const kinds = [...new Set(seen.map((event) => event.kind || `${event.type}:${event.stage}`))];
    fixture.page = { status: full.status, blocks: full.blocks.map((block) => `${block.type}:${block.status}`), shapes: Object.fromEntries(full.blocks.map((block) => [block.type, shapeOf(block.payload, 3)])) };
    fixture.events = kinds;
    if (written.status !== 'ready' && written.status !== 'partial') throw new Error(`the chapter came back ${written.status}: ${written.error}`);
    const section = full.blocks.find((block) => block.type === 'section');
    const quiz = full.blocks.find((block) => block.type === 'quiz' && block.status === 'ready');
    if (!section || !sectionOf(section).parts.length) throw new Error('the chapter has no prose');
    if (!['page_compile_started', 'block_ready', 'page_compiled'].every((kind) => kinds.includes(kind))) throw new Error(`the watch missed the writing (saw ${kinds.join(', ')})`);
    if (Object.keys(live.pages).length) throw new Error('the live state still shows a page being written');
    notes.push(`chapter written: ${full.blocks.map((block) => block.type).join(', ')} (${full.status}); watch saw ${seen.length} events`);

    // Reading: a visit, a bookmark on and off, a quiz answer kept without a verdict.
    const visited = await recordPageVisit(client, created.id, page.id);
    const marked = await toggleBookmark(client, created.id, page.id);
    const unmarked = await toggleBookmark(client, created.id, page.id);
    if (visited.currentPageId !== page.id || !marked.bookmarked.includes(page.id) || unmarked.bookmarked.includes(page.id)) throw new Error('visit or bookmark did not stick');
    if (quiz) {
      const question = bookQuizQuestions(quiz)[0];
      if (!question) throw new Error('the quiz has no questions the app can read');
      const progress = await recordQuizAttempt(client, { bookId: created.id, pageId: page.id, blockId: quiz.id, questionId: question.id, answer: 'A', correct: null, submissionId: randomId() });
      if (!progress.quizAttempts.some((attempt) => attempt.blockId === quiz.id && attempt.questionId === question.id)) throw new Error('the quiz answer was not kept');
      notes.push(`visit, bookmark, quiz answer (${bookQuizQuestions(quiz).length} questions) kept`);
    } else {
      notes.push('visit and bookmark kept; the quiz block failed, so no answer recorded');
    }
    const markdown = await exportBook(client, created.id);
    if (!markdown.includes('APP PROBE: water cycle')) throw new Error("the export doesn't carry the title");
    fixture.export = { characters: markdown.length > 0 };

    // A chat about the page: the page rides along, then the chat is filed under it.
    reply = emptyReply();
    const answered = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no answer within 3 minutes')), 180_000);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    const started = await connection.startTurn({ content: 'In one short sentence: what is the page I am reading about?', ...bookTurnFields(reading.book, page.id) });
    sessionId = started.sessionId;
    await answered;
    if (reply.status === 'failed') throw new Error(`the page chat failed: ${reply.error ?? ''}`);
    await linkPageChat(client, created.id, page.id, started.sessionId);
    const chat = await getSession(client, started.sessionId);
    const filed = bookOfPreferences(chat.preferences as Record<string, unknown>);
    const linked = await getBook(client, created.id);
    if (filed?.bookId !== created.id || filed.pageId !== page.id || linked.book.pageChats[page.id] !== started.sessionId) throw new Error('the chat was not filed under the page');
    fixture.chat = { preferences: shapeOf(chat.preferences) };
    notes.push('page chat answered and filed under the page');

    // Pause (the cheap way to stop spending); resuming would write the rest, so it isn't tried.
    await pauseBook(client, linked.book);
    const paused = await getBook(client, created.id);
    if (paused.book.status !== 'paused' || bookActivity(paused).kind !== 'paused') throw new Error(`pause left it ${paused.book.status}`);
    fixture.detail = { book: shapeOf(paused.book, 3), progress: shapeOf(paused.progress, 3) };
    notes.push('paused');

    watch.stop();
    watch = null;
    await deleteSession(client, started.sessionId);
    sessionId = null;
    await deleteBook(client, created.id);
    bookId = null;
    const gone = await getBook(client, created.id).then(
      () => false,
      () => true,
    );
    if (!gone || (await listBooks(client)).books.some((book) => book.id === created.id)) throw new Error('the deleted book still opens or is listed');
    notes.push('chat and book deleted');
    return { note: notes.join('; '), fixture };
  } catch (error) {
    throw new Error(`${notes.join('; ')}${notes.length ? '; then ' : ''}${error instanceof Error ? error.message : String(error)}`);
  } finally {
    watch?.stop();
    connection.close();
    if (sessionId) await deleteSession(client, sessionId).catch(() => undefined);
    if (bookId) await deleteBook(client, bookId).catch(() => undefined);
  }
}
