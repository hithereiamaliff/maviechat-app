/**
 * DeepTutor contract probe (milestone M1.5):
 *   npm run probe:deeptutor -- [--url http://127.0.0.1:3782] [--env ~/.config/maviechat/deeptutor-test.env] [--no-fixtures] [--turn] [--learning] [--books] [--reading] [--video]
 *
 * `--turn` also runs one short "APP PROBE:" chat turn over `/ws` (it uses the account's model),
 * drops the socket mid-reply on purpose, checks the resumed reply equals the saved one, and
 * deletes the session. `--modes` runs one short turn in each mode the app shows natively (Solve,
 * Quiz, Visualize, Research's outline, Ask Questions answered), checks the app reads each mode's
 * result, live and saved, and deletes the sessions (about two minutes of model use). `--refs`
 * sends a photo, a text file, a notebook and an earlier chat with one turn, checks the saved
 * message reads back (and its photo loads signed in), and deletes everything it made. `--space`
 * checks what the app's DeepTutor space reads and writes: the profile, the reply language (saved
 * back unchanged), the home screen's ideas, a wrong current password refused (so nothing
 * changes), and one short "APP PROBE:" chat pinned, archived, restored and unpinned, read back
 * from the list after each step, then deleted. `--practice` runs one one-question Quiz turn,
 * saves the answer as wrong, and walks DeepTutor's practice loop with it: question bank, summary
 * (a wrong answer is due the next day), checking, reviewing (a wrong answer must be "again", a retried review is answered the
 * same, an old version is refused), bookmarking; then deletes the question and the chat.
 * `--library` checks Favorites, the Learning Journal and Chat History: a throwaway notebook and
 * record (rename, edit, export, remove), the journal's shape, and a one-line chat found by a
 * made-up word with that word in its snippet, archived and restored; everything is deleted.
 * `--knowledge` checks the Knowledge Center: a throwaway knowledge base made from a one-page PDF
 * (PageIndex OSS, Flash), followed to ready; a chat turn that picks it must find the PDF's word;
 * a second PDF added and removed, a re-index, Make Default (the old default is put back), then
 * the knowledge base and the chat are deleted. Uses the account's model for a minute or two.
 * `--calendar` checks the Task Board and the Calendar: two "APP PROBE:" tasks made, moved and
 * dated; one linked to a short chat (its status colour, then unlinked; the chat is asked which
 * task is its own); a timed event blocking time for a task, an all-day weekly event over three
 * weeks with one date deleted and undone and the rest renamed from the second date; search and
 * the layers read. Events and the chat are deleted; the tasks are archived (DeepTutor has no
 * delete for tasks).
 * `--learning` checks the learning hub and mastery paths (src/deeptutor-learning-probe.ts): a
 * path made from a goal, a study chat whose question card is answered and graded, mode switch,
 * a point marked known and back, rename, review settings, a map edit, reset, then deletion.
 * `--books` checks Books (src/deeptutor-books-probe.ts): a small "APP PROBE:" book through
 * proposal, outline and one chapter written over `/ws/books` (a second socket following its
 * events), reading progress, export, a chat about the page, pause, then deletion.
 * `--reading` checks Reading (src/deeptutor-reading-probe.ts): an "APP PROBE:" collection with
 * an uploaded text file and an imported link, a highlight, bookmark and reading place, one tutor
 * message about a passage, then the collection, its chat and the materials deleted.
 * `--video` checks Reading's videos (no model calls): a short YouTube video imported, its
 * transcript with start times, a place and a note at a time, then deletion.
 * `--partners` checks Partners (src/deeptutor-partners-probe.ts): a partner made from a library
 * soul, a reply over `/ws/partners/{id}` read back from history, a reply followed again after a
 * dropped socket, the conversation archived, brought back and deleted; its set-up, a group of two,
 * and chat-app settings on a partner never started (no app switched on, no scan); all deleted.
 * `--personalization` checks Personas, Skills (and their tags), that a connected agent stays out of
 * the knowledge-base lists, and CLI apps (src/deeptutor-personalization-probe.ts); no model calls.
 * Signs in as the test account (DT_URL, DT_USERNAME, DT_PASSWORD), checks that sign-in is
 * enforced and self-registration closed, reads sessions, writes one "APP PROBE:" notebook
 * with a chat record and deletes it again, checks the web pages want the sign-in cookie,
 * then signs out. Fixtures (fixtures/deeptutor-<version>/) hold response shapes only.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  addChatRecord,
  applyTurnEvent,
  changePassword,
  checkPracticeAnswer,
  deleteRecord,
  exportNotebook,
  getLearningJournal,
  searchSnippet,
  updateNotebook,
  updateRecord,
  deleteSavedQuestion,
  DtHttpError,
  getPracticeQuestion,
  getPracticeQueue,
  getPracticeSummary,
  getQuestionBankStats,
  listSavedQuestions,
  reviewPracticeQuestion,
  saveQuizResults,
  updateSavedQuestion,
  getProfile,
  getSuggestions,
  getUiSettings,
  isArchived,
  isPinned,
  listedUnder,
  organizeSession,
  randomId,
  REPLY_LANGUAGES,
  updateUiSettings,
  createNotebook,
  deleteNotebook,
  createKnowledgeBase,
  addDaysKey,
  createEvent,
  createTask,
  dateKey,
  deleteEvent,
  deviceTimeZone,
  fromDateKey,
  getCalendarLayers,
  getTaskBlocks,
  getTaskBoard,
  instant,
  linkSessionTasks,
  listCalendars,
  listOccurrences,
  repeatRule,
  searchEvents,
  sessionStatusColor,
  setTaskStatusLink,
  undoCalendarChange,
  updateEvent,
  updateTask,
  deleteKbFile,
  deleteKnowledgeBase,
  getKbProgress,
  getKnowledgeBase,
  listKbFiles,
  listKnowledgeCenter,
  listRagProviders,
  ragPreflight,
  reindexKnowledgeBase,
  setDefaultKnowledgeBase,
  uploadKbFiles,
  type DtKnowledgeBaseInfo,
  deleteSession,
  DtClient,
  messageAttachments,
  messageReferences,
  DtTurnConnection,
  emptyReply,
  savedReply,
  shownMessages,
  socketCookieHeader,
  turnSocketUrl,
  type DtReply,
  type DtStreamEvent,
  getAuthStatus,
  getNotebook,
  getServerVersion,
  getSession,
  listNotebooks,
  listSessions,
  searchSessions,
  sessionMarkdown,
  signIn,
  signOut,
  tokenExpiry,
  TOKEN_COOKIE,
} from '@maviechat/deeptutor-protocol';
import { probeBooks } from './deeptutor-books-probe';
import { probePartners } from './deeptutor-partners-probe';
import { probePersonalization } from './deeptutor-personalization-probe';
import { probeLearning } from './deeptutor-learning-probe';
import { probeReading, probeVideo } from './deeptutor-reading-probe';
import { loadEnvFile } from './env';
import { shapeOf } from './shape';

const DEFAULT_ENV_FILE = '~/.config/maviechat/deeptutor-test.env';
const PROBE_PREFIX = 'APP PROBE:';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string' },
    env: { type: 'string' },
    'no-fixtures': { type: 'boolean' },
    turn: { type: 'boolean' },
    modes: { type: 'boolean' },
    refs: { type: 'boolean' },
    space: { type: 'boolean' },
    practice: { type: 'boolean' },
    library: { type: 'boolean' },
    knowledge: { type: 'boolean' },
    calendar: { type: 'boolean' },
    learning: { type: 'boolean' },
    books: { type: 'boolean' },
    reading: { type: 'boolean' },
    video: { type: 'boolean' },
    partners: { type: 'boolean' },
    personalization: { type: 'boolean' },
  },
});

interface StepResult {
  name: string;
  ok: boolean;
  note: string;
}

const results: StepResult[] = [];
const fixtures: Record<string, unknown> = {};

async function step<T>(name: string, run: () => Promise<{ value: T; note: string }>): Promise<T | undefined> {
  try {
    const { value, note } = await run();
    results.push({ name, ok: true, note });
    return value;
  } catch (error) {
    results.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

/** A page request that doesn't follow redirects, so the sign-in gate shows. */
async function page(baseUrl: string, pathname: string, cookie?: string): Promise<{ status: number; location: string | null }> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { Accept: 'text/html', ...(cookie ? { Cookie: `${TOKEN_COOKIE}=${cookie}` } : {}) },
    redirect: 'manual',
  });
  await response.body?.cancel();
  return { status: response.status, location: response.headers.get('location') };
}

async function main() {
  const envFile = args.env ?? DEFAULT_ENV_FILE;
  const env = loadEnvFile(envFile);
  if (!env?.DT_USERNAME || !env.DT_PASSWORD) {
    console.error(`✗ no DT_USERNAME/DT_PASSWORD in ${envFile}`);
    process.exitCode = 1;
    return;
  }
  const anonymous = new DtClient({ baseUrl: args.url ?? env.DT_URL ?? 'http://127.0.0.1:3782' });
  const baseUrl = anonymous.baseUrl;

  await step('GET /api/auth/status (anonymous)', async () => {
    const status = await getAuthStatus(anonymous);
    fixtures['auth.status.anonymous'] = { shape: shapeOf(status), enabled: status.enabled, authenticated: status.authenticated };
    if (!status.enabled) throw new Error('sign-in is OFF: anyone who reaches this server gets the admin workspace');
    if (status.authenticated) throw new Error('an anonymous request counts as signed in');
    return { value: status, note: 'sign-in required' };
  });

  await step('GET /api/auth/is_first_user', async () => {
    const value = await anonymous.get<{ is_first_user?: boolean }>('/api/auth/is_first_user');
    if (value.is_first_user !== false) throw new Error('no account exists yet: whoever registers first becomes admin');
    return { value, note: 'self-registration closed' };
  });

  const session = await step('POST /api/auth/login', async () => {
    const result = await signIn(anonymous, env.DT_USERNAME as string, env.DT_PASSWORD as string);
    fixtures.login = { shape: shapeOf(result.account), tokenInCookie: Boolean(result.token) };
    if (!result.token) throw new Error(`no ${TOKEN_COOKIE} cookie in the answer`);
    if (result.account.is_admin) throw new Error('the probe account is an admin: use an ordinary test account');
    const expiry = tokenExpiry(result.token);
    const days = expiry ? Math.round((expiry * 1000 - Date.now()) / 86_400_000) : null;
    return { value: result, note: `role ${result.account.role}, sign-in lasts ${days ?? '?'} days` };
  });
  if (!session?.token) return report('unknown');

  const client = anonymous.withToken(session.token);
  await step('GET /api/auth/status (Bearer)', async () => {
    const status = await getAuthStatus(client);
    fixtures['auth.status'] = { shape: shapeOf(status) };
    if (!status.authenticated) throw new Error('the Bearer token was not accepted');
    return { value: status, note: 'Bearer accepted through the web front end' };
  });

  const version = await step('GET /api/system/update', async () => {
    const value = await getServerVersion(client);
    return { value, note: value ?? 'no version given' };
  });

  const sessions = await step('GET /api/sessions', async () => {
    const value = await listSessions(client, { limit: 20 });
    fixtures.sessions = { count: value.length, shape: shapeOf(value) };
    return { value, note: `${value.length} sessions` };
  });

  await step('GET /api/sessions/search', async () => {
    const value = await searchSessions(client, 'the');
    fixtures['sessions.search'] = { total: value.total, shape: shapeOf(value) };
    return { value, note: `${value.total} match "the"` };
  });

  const first = sessions?.[0];
  if (first) {
    await step('GET /api/sessions/{id} → Markdown', async () => {
      const value = await getSession(client, first.id);
      const markdown = sessionMarkdown(value, { source: new URL(baseUrl).host });
      fixtures.session = { messageCount: value.messages.length, shape: shapeOf(value, 4) };
      return { value, note: `${value.messages.length} messages → ${markdown.length} characters of Markdown` };
    });
  } else {
    results.push({ name: 'GET /api/sessions/{id} → Markdown', ok: true, note: 'skipped: the test account has no sessions yet' });
  }

  await step('notebook: create, add chat record, read, delete', async () => {
    const notebook = await createNotebook(client, `${PROBE_PREFIX} notebook`, 'Written and deleted by the MavieChat probe');
    try {
      const record = await addChatRecord(client, {
        notebookIds: [notebook.id],
        title: `${PROBE_PREFIX} chat record`,
        summary: 'A test record from the MavieChat probe.',
        userQuery: 'What is 2 + 2?',
        output: '# APP PROBE\n\n## User\n\nWhat is 2 + 2?\n\n## Assistant\n\n4.',
        metadata: { source: 'maviechat-probe' },
      });
      const stored = await getNotebook(client, notebook.id);
      fixtures.notebook = { shape: shapeOf(stored, 4), record: shapeOf(record) };
      if (!stored.records?.some((item) => item.id === record.id)) throw new Error('the record is missing from the notebook');
    } finally {
      await deleteNotebook(client, notebook.id);
    }
    const left = (await listNotebooks(client)).filter((item) => item.name.startsWith(PROBE_PREFIX));
    if (left.length > 0) throw new Error(`${left.length} probe notebook(s) left behind`);
    return { value: true, note: 'record stored; notebook deleted' };
  });

  await step('web pages want the sign-in cookie', async () => {
    const without = await page(baseUrl, '/chat');
    const bearerOnly = await fetch(`${baseUrl}/chat`, { headers: { Accept: 'text/html', Authorization: `Bearer ${session.token}` }, redirect: 'manual' });
    await bearerOnly.body?.cancel();
    const withCookie = await page(baseUrl, '/chat', session.token as string);
    fixtures.pages = { withoutCookie: without.status, bearerOnly: bearerOnly.status, withCookie: withCookie.status };
    if (without.status < 300 || without.status >= 400 || !without.location?.startsWith('/login')) throw new Error(`/chat without a cookie answered ${without.status}`);
    if (withCookie.status !== 200) throw new Error(`/chat with the cookie answered ${withCookie.status}`);
    return { value: true, note: `no cookie → ${without.location}; Bearer only → ${bearerOnly.status}; cookie → 200` };
  });

  if (args.modes) {
    await step('modes over /ws: Solve, Quiz, Visualize, Research outline, Ask Questions', async () => {
      const outcome = await probeModes(baseUrl, session.token as string, client);
      fixtures.modes = outcome.fixture;
      return { value: true, note: outcome.note };
    });
  }

  if (args.refs) {
    await step('attachments and references: photo, text file, notebook, earlier chat', async () => {
      const outcome = await probeRefs(baseUrl, session.token as string, client);
      return { value: true, note: outcome };
    });
  }

  if (args.space) {
    await step('space: profile, reply language, ideas, password check, pin and archive', async () => {
      const outcome = await probeSpace(baseUrl, session.token as string, client);
      fixtures.space = outcome.fixture;
      return { value: true, note: outcome.note };
    });
  }

  if (args.practice) {
    await step('practice: quiz result saved, bank, summary, queue, check, review, bookmark', async () => {
      const outcome = await probePractice(baseUrl, session.token as string, client);
      fixtures.practice = outcome.fixture;
      return { value: true, note: outcome.note };
    });
  }

  if (args.library) {
    await step('library: Favorites notebook and record, Learning Journal, Chat History search', async () => {
      const outcome = await probeLibrary(baseUrl, session.token as string, client);
      fixtures.library = outcome.fixture;
      return { value: true, note: outcome.note };
    });
  }

  if (args.knowledge) {
    await step('knowledge: create from a PDF, index, chat finds it, add and remove a file, re-index, default, delete', async () => {
      const outcome = await probeKnowledge(baseUrl, session.token as string, client);
      fixtures.knowledge = outcome.fixture;
      return { value: true, note: outcome.note };
    });
  }

  if (args.calendar) {
    await step('calendar: tasks, a chat link, events, a repeating event, undo, search, layers', async () => {
      const outcome = await probeCalendar(baseUrl, session.token as string, client);
      fixtures.calendar = outcome.fixture;
      return { value: true, note: outcome.note };
    });
  }

  if (args.learning) {
    await step('learning: hub index, a mastery path, a study chat with a graded question, settings, map edit, reset, delete', async () => {
      const outcome = await probeLearning(baseUrl, session.token as string, client);
      fixtures.learning = outcome.fixture;
      return { value: true, note: outcome.note };
    });
  }

  if (args.books) {
    await step('books: proposal, outline, one chapter over /ws/books, progress, export, page chat, pause, delete', async () => {
      const outcome = await probeBooks(baseUrl, session.token as string, client);
      fixtures.books = outcome.fixture;
      return { value: true, note: outcome.note };
    });
  }

  if (args.reading) {
    await step('reading: collection, upload, link, highlight, bookmark, place, a tutor message, delete', async () => {
      const outcome = await probeReading(baseUrl, session.token as string, client);
      fixtures.reading = outcome.fixture;
      return { value: true, note: outcome.note };
    });
  }

  if (args.video) {
    await step('video: a YouTube link imported, its transcript, a place and a note at a time, delete', async () => {
      const outcome = await probeVideo(client);
      fixtures.video = outcome.fixture;
      return { value: true, note: outcome.note };
    });
  }

  if (args.partners) {
    await step('partners: one made from a library soul, a reply over /ws/partners, a reply followed again, conversations, set-up, a group, chat-app settings, delete', async () => {
      const outcome = await probePartners(baseUrl, session.token as string, client);
      fixtures.partners = outcome.fixture;
      return { value: true, note: outcome.note };
    });
  }

  if (args.personalization) {
    await step('personalization: personas, skills and tags made, changed and deleted; an agent connection kept out of knowledge bases; CLI apps', async () => {
      const outcome = await probePersonalization(client);
      fixtures.personalization = outcome.fixture;
      return { value: true, note: outcome.note };
    });
  }

  if (args.turn) {
    await step('turn over /ws: stream, drop, resume, compare with the saved reply', async () => {
      const outcome = await probeTurn(baseUrl, session.token as string, client);
      fixtures.turn = outcome.fixture;
      return { value: true, note: outcome.note };
    });
  }

  await step('POST /api/auth/logout', async () => {
    await signOut(client);
    return { value: true, note: 'cookie cleared (the token stays valid until it expires)' };
  });

  report(version ?? 'unknown');
}

// Node's built-in WebSocket takes headers (not in the DOM typings), which carries the sign-in cookie.
const NodeWebSocket = WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocket;

/**
 * One short turn through the app's own connection code. After the first answer text arrives the
 * socket is closed on purpose: the connection must reconnect, resume after the last event it
 * applied, and end with exactly the reply DeepTutor saved.
 */
async function probeTurn(baseUrl: string, token: string, client: DtClient) {
  let reply: DtReply = emptyReply();
  let socket: WebSocket | null = null;
  let sockets = 0;
  let dropped = false;
  const types = new Map<string, number>();
  const samples: Partial<Record<DtStreamEvent['type'], DtStreamEvent>> = {};
  let finish: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => (finish = resolve));
  const connection = new DtTurnConnection({
    url: turnSocketUrl(baseUrl),
    connect: (url, handlers) => {
      sockets += 1;
      const current = new NodeWebSocket(url, { headers: { Cookie: socketCookieHeader(token) } });
      socket = current;
      current.onopen = () => handlers.onOpen();
      current.onmessage = (event) => handlers.onMessage(event.data);
      current.onclose = (event) => handlers.onClose(event.code);
      return { send: (data) => current.send(data), close: () => current.close() };
    },
    onEvent: (event) => {
      reply = applyTurnEvent(reply, event);
      types.set(event.type, (types.get(event.type) ?? 0) + 1);
      samples[event.type] ??= event;
      if (!dropped && reply.answer.length > 0) {
        dropped = true;
        socket?.close();
      }
      if (event.type === 'done') finish();
    },
  });
  const started = await connection.startTurn({ content: `${PROBE_PREFIX} Count from one to fifteen in words, separated by commas.`, tools: [] });
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      finished,
      new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('no done event within 3 minutes')), 180_000))),
    ]).finally(() => clearTimeout(timer));
    if (reply.status !== 'completed') throw new Error(`the turn ended ${reply.status}${reply.error ? `: ${reply.error}` : ''}`);
    if (sockets < 2) throw new Error('the dropped socket was not reopened');
    const saved = shownMessages(await getSession(client, started.sessionId));
    const last = saved[saved.length - 1];
    if (last?.role !== 'assistant') throw new Error('no saved reply');
    if (last.content !== reply.answer) throw new Error(`the streamed answer (${reply.answer.length} chars) differs from the saved one (${last.content.length} chars)`);
    if (reply.assistantMessageId !== null && String(last.id) !== String(reply.assistantMessageId)) throw new Error('done named a different reply');
    if (savedReply(last).tools.length !== reply.tools.length) throw new Error('the saved tool steps differ from the streamed ones');
    return {
      fixture: {
        eventTypes: Object.fromEntries([...types.keys()].sort().map((type) => [type, 'seen'])),
        shapes: Object.fromEntries(Object.entries(samples).map(([type, event]) => [type, shapeOf(event, 3)])),
      },
      note: `${[...types.values()].reduce((a, b) => a + b, 0)} events over ${sockets} sockets; the resumed answer equals the saved reply; session deleted`,
    };
  } finally {
    connection.close();
    await deleteSession(client, started.sessionId).catch(() => undefined);
  }
}

interface ModeCase {
  capability: string;
  content: string;
  config: Record<string, unknown>;
  /** What the app must find in the reply (live and saved), or why not. */
  check(reply: DtReply): string | null;
}

const MODE_CASES: ModeCase[] = [
  { capability: 'deep_solve', content: 'Solve 3x = 12 for x.', config: {}, check: (r) => (r.tools.some((tool) => tool.name === 'solve_plan') ? null : 'no plan step') },
  { capability: 'deep_question', content: 'Fractions', config: { num_questions: 1, difficulty: 'easy' }, check: (r) => (r.quiz.length >= 1 && r.quiz.every((q) => q.answer) ? null : 'no quiz question') },
  { capability: 'visualize', content: 'A bar chart of the numbers 1, 2 and 3.', config: { quality: 'low' }, check: (r) => (r.visual ? null : 'no visual') },
  { capability: 'deep_research', content: 'What is rain?', config: { mode: 'notes', depth: 'quick' }, check: (r) => (r.outline?.subTopics.length ? null : 'no outline') },
  { capability: 'ask_questions', content: 'Help me plan a revision week.', config: {}, check: (r) => (r.ask?.questions.length && r.askAnswers ? null : 'questions or answers missing') },
];

/** One turn per native mode at once, through the app's own connection; Ask Questions is answered with each question's first option. */
async function probeModes(baseUrl: string, token: string, client: DtClient) {
  const replies = new Map<string, DtReply>();
  const finished = new Map<string, () => void>();
  const answered = new Set<string>();
  let connection: DtTurnConnection | null = null;
  connection = new DtTurnConnection({
    url: turnSocketUrl(baseUrl),
    connect: (url, handlers) => {
      const socket = new NodeWebSocket(url, { headers: { Cookie: socketCookieHeader(token) } });
      socket.onopen = () => handlers.onOpen();
      socket.onmessage = (event) => handlers.onMessage(event.data);
      socket.onclose = (event) => handlers.onClose(event.code);
      return { send: (data) => socket.send(data), close: () => socket.close() };
    },
    onEvent: (event) => {
      const reply = applyTurnEvent(replies.get(event.session_id) ?? emptyReply(event.session_id, event.turn_id), event);
      replies.set(event.session_id, reply);
      if (reply.status === 'waiting' && reply.ask && !answered.has(event.session_id)) {
        answered.add(event.session_id);
        const answers = reply.ask.questions.map((question) => ({ questionId: question.id, text: question.options[0]?.label ?? 'No preference' }));
        setTimeout(() => void connection?.reply(event.turn_id, { answers }), 500);
      }
      if (event.type === 'done') finished.get(event.session_id)?.();
    },
  });
  const sessions: string[] = [];
  try {
    const runs = MODE_CASES.map(async (mode) => {
      const started = await connection.startTurn({ content: `${PROBE_PREFIX} ${mode.content}`, capability: mode.capability, config: mode.config, tools: [] });
      sessions.push(started.sessionId);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${mode.capability}: no done event within 5 minutes`)), 300_000);
        finished.set(started.sessionId, () => {
          clearTimeout(timer);
          resolve();
        });
        if (replies.get(started.sessionId)?.status === 'completed') finished.get(started.sessionId)?.();
      });
      const live = replies.get(started.sessionId) ?? emptyReply();
      if (live.status !== 'completed') throw new Error(`${mode.capability} ended ${live.status}${live.error ? `: ${live.error}` : ''}`);
      const liveProblem = mode.check(live);
      if (liveProblem) throw new Error(`${mode.capability} (live): ${liveProblem}`);
      const saved = shownMessages(await getSession(client, started.sessionId)).filter((message) => message.role === 'assistant').pop();
      if (!saved) throw new Error(`${mode.capability}: no saved reply`);
      const fromSaved = savedReply(saved);
      // The saved reply keeps tool calls, the result and your answers, so a reopened chat shows the same.
      const savedProblem = mode.check(fromSaved);
      if (savedProblem) throw new Error(`${mode.capability} (saved): ${savedProblem}`);
      // Modes stream their opening text with a leading newline that DeepTutor trims when saving.
      if (saved.content.trim() !== live.answer.trim()) {
        throw new Error(`${mode.capability}: streamed answer (${live.answer.trim().length} chars) differs from the saved one (${saved.content.trim().length} chars)`);
      }
      return { mode: mode.capability, events: live.seq, stages: live.stages.map((stage) => stage.name) };
    });
    const outcomes = await Promise.all(runs);
    return {
      fixture: Object.fromEntries(outcomes.map((outcome) => [outcome.mode, { stages: outcome.stages }])),
      note: outcomes.map((outcome) => `${outcome.mode} ${outcome.events} events`).join('; '),
    };
  } finally {
    connection.close();
    await Promise.all(sessions.map((id) => deleteSession(client, id).catch(() => undefined)));
  }
}

/** A 1×1 PNG. */
const DOT_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

/** One turn with everything slice 3 sends, through the app's own connection; the saved message must read back. */
async function probeRefs(baseUrl: string, token: string, client: DtClient): Promise<string> {
  const replies = new Map<string, DtReply>();
  const done = new Map<string, () => void>();
  const connection = new DtTurnConnection({
    url: turnSocketUrl(baseUrl),
    connect: (url, handlers) => {
      const socket = new NodeWebSocket(url, { headers: { Cookie: socketCookieHeader(token) } });
      socket.onopen = () => handlers.onOpen();
      socket.onmessage = (event) => handlers.onMessage(event.data);
      socket.onclose = (event) => handlers.onClose(event.code);
      return { send: (data) => socket.send(data), close: () => socket.close() };
    },
    onEvent: (event) => {
      replies.set(event.session_id, applyTurnEvent(replies.get(event.session_id) ?? emptyReply(event.session_id, event.turn_id), event));
      if (event.type === 'done') done.get(event.session_id)?.();
    },
  });
  const run = async (request: Parameters<DtTurnConnection['startTurn']>[0]) => {
    const started = await connection.startTurn(request);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no done event within 3 minutes')), 180_000);
      done.set(started.sessionId, () => {
        clearTimeout(timer);
        resolve();
      });
      if (replies.get(started.sessionId)?.status === 'completed') resolve();
    });
    return started.sessionId;
  };
  const notebook = await createNotebook(client, `${PROBE_PREFIX} references`, 'Written and deleted by the MavieChat probe');
  const sessions: string[] = [];
  try {
    await addChatRecord(client, {
      notebookIds: [notebook.id],
      title: `${PROBE_PREFIX} record`,
      summary: 'A fact for the probe.',
      userQuery: 'What is the capital of Atlantis?',
      output: 'The capital of Atlantis is Coralia.',
      metadata: { source: 'maviechat-probe' },
    });
    const earlier = await run({ content: `${PROBE_PREFIX} Remember that my favourite fruit is durian. Just say OK.`, tools: [] });
    sessions.push(earlier);
    const main = await run({
      content: `${PROBE_PREFIX} From the attached note, my notebook and my earlier chat: the secret word, the capital of Atlantis, my favourite fruit. One line each.`,
      tools: [],
      attachments: [
        { type: 'image', filename: 'dot.png', base64: DOT_PNG, mime_type: 'image/png' },
        { type: 'file', filename: 'note.txt', base64: Buffer.from('The secret word is PAPAYA.\n').toString('base64'), mime_type: 'text/plain' },
      ],
      notebookReferences: [{ notebook_id: notebook.id }],
      historyReferences: [earlier],
    });
    sessions.push(main);
    if (replies.get(main)?.status !== 'completed' || !replies.get(main)?.answer.trim()) throw new Error('the turn with attachments did not answer');
    const user = shownMessages(await getSession(client, main)).find((message) => message.role === 'user');
    if (!user) throw new Error('no saved message');
    const attachments = messageAttachments(user);
    if (attachments.map((item) => item.filename).join() !== 'dot.png,note.txt' || attachments.some((item) => !item.url)) throw new Error('the saved attachments do not read back');
    const references = messageReferences(user);
    if (references.notebooks.join() !== notebook.id || references.chats.join() !== earlier) throw new Error('the saved references do not read back');
    const image = await fetch(`${baseUrl}${attachments[0]!.url}`, { headers: { Authorization: `Bearer ${token}` } });
    await image.body?.cancel();
    if (image.status !== 200 || !String(image.headers.get('content-type')).startsWith('image/')) throw new Error(`the saved photo answered ${image.status}`);
    return 'sent inline; saved message reads back; its photo loads signed in; everything deleted';
  } finally {
    connection.close();
    await Promise.all(sessions.map((id) => deleteSession(client, id).catch(() => undefined)));
    await deleteNotebook(client, notebook.id).catch(() => undefined);
  }
}

/** What the DeepTutor space reads and writes, on the test account; the one chat it makes is deleted. */
async function probeSpace(baseUrl: string, token: string, client: DtClient): Promise<{ note: string; fixture: Record<string, unknown> }> {
  const profile = await getProfile(client);
  if (!profile.username || typeof profile.can_change_password !== 'boolean') throw new Error('the profile lacks a username or can_change_password');
  const ui = await getUiSettings(client);
  if (!REPLY_LANGUAGES.some((language) => language.code === ui.response_language)) throw new Error(`unknown reply language "${ui.response_language}"`);
  const saved = await updateUiSettings(client, { response_language: ui.response_language });
  if (saved.response_language !== ui.response_language) throw new Error('the reply language did not save back unchanged');
  const ideas = await getSuggestions(client);

  // A current password that can't be right: DeepTutor refuses before changing anything.
  const refused = await changePassword(client, `wrong ${randomId()}`, `probe-${randomId()}`).then(
    () => null,
    (error: unknown) => error,
  );
  if (refused === null) throw new Error('a wrong current password was accepted');
  if (!(refused instanceof DtHttpError) || refused.status !== 400) throw new Error(`a wrong current password answered ${String(refused)}`);

  let id: string | null = null;
  let finished: () => void = () => undefined;
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no done event within 3 minutes')), 180_000);
    finished = () => {
      clearTimeout(timer);
      resolve();
    };
  });
  const connection = new DtTurnConnection({
    url: turnSocketUrl(baseUrl),
    connect: (url, handlers) => {
      const socket = new NodeWebSocket(url, { headers: { Cookie: socketCookieHeader(token) } });
      socket.onopen = () => handlers.onOpen();
      socket.onmessage = (event) => handlers.onMessage(event.data);
      socket.onclose = (event) => handlers.onClose(event.code);
      return { send: (data) => socket.send(data), close: () => socket.close() };
    },
    onEvent: (event) => {
      if (event.type === 'done') finished();
    },
  });
  try {
    id = (await connection.startTurn({ content: `${PROBE_PREFIX} Just say OK.`, tools: [] })).sessionId;
    await done;
    const row = async () => {
      const found = (await listSessions(client, { limit: 50 })).find((item) => item.id === id);
      if (!found) throw new Error('the chat is missing from the list');
      return found;
    };
    const expect = async (change: { pinned?: boolean; archived?: boolean }, check: (session: Awaited<ReturnType<typeof row>>) => boolean, what: string) => {
      await organizeSession(client, id as string, change);
      if (!check(await row())) throw new Error(`after ${JSON.stringify(change)} the list doesn't show it ${what}`);
    };
    await expect({ pinned: true }, (session) => isPinned(session) && listedUnder(session) === 'conversations', 'pinned');
    await expect({ archived: true }, (session) => isArchived(session) && listedUnder(session) === null, 'archived');
    await expect({ archived: false }, (session) => !isArchived(session) && listedUnder(session) === 'conversations', 'restored');
    await expect({ pinned: false }, (session) => !isPinned(session), 'unpinned');
  } finally {
    connection.close();
    if (id) await deleteSession(client, id).catch(() => undefined);
  }
  return {
    note: `profile ok (${profile.preset ?? 'no preset'}); reply language ${ui.response_language} saved back; ${ideas.suggestions.length} ideas${ideas.stale ? ' (being written)' : ''}; wrong password refused; pin, archive, restore, unpin read back; chat deleted`,
    fixture: { profile: shapeOf(profile), ui: shapeOf(ui), suggestions: shapeOf(ideas) },
  };
}

/** DeepTutor's practice loop on one throwaway quiz question; the question and its chat are deleted. */
async function probePractice(baseUrl: string, token: string, client: DtClient): Promise<{ note: string; fixture: Record<string, unknown> }> {
  let reply: DtReply = emptyReply();
  let finished: () => void = () => undefined;
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no done event within 3 minutes')), 180_000);
    finished = () => {
      clearTimeout(timer);
      resolve();
    };
  });
  const connection = new DtTurnConnection({
    url: turnSocketUrl(baseUrl),
    connect: (url, handlers) => {
      const socket = new NodeWebSocket(url, { headers: { Cookie: socketCookieHeader(token) } });
      socket.onopen = () => handlers.onOpen();
      socket.onmessage = (event) => handlers.onMessage(event.data);
      socket.onclose = (event) => handlers.onClose(event.code);
      return { send: (data) => socket.send(data), close: () => socket.close() };
    },
    onEvent: (event) => {
      reply = applyTurnEvent(reply.sessionId ? reply : emptyReply(event.session_id, event.turn_id), event);
      if (event.type === 'done') finished();
    },
  });
  let sessionId: string | null = null;
  let entryId: number | null = null;
  try {
    const started = await connection.startTurn({
      content: `${PROBE_PREFIX} Fractions, as a multiple-choice question`,
      capability: 'deep_question',
      config: { num_questions: 1, difficulty: 'easy' },
      tools: [],
    });
    sessionId = started.sessionId;
    await done;
    const question = reply.quiz[0];
    if (!question || !reply.turnId) throw new Error('the quiz turn wrote no question');
    const options = Object.fromEntries(question.options.map((option) => [option.key, option.text]));
    const right = question.options.map((option) => option.key).filter((key) => question.answer.toUpperCase().split(/[,;\s]+/).includes(key.toUpperCase()));
    const wrong = question.options.map((option) => option.key).find((key) => !right.includes(key));
    const objective = question.type === 'choice' && right.length > 0 && wrong !== undefined;
    const answer = objective ? (wrong as string) : 'not sure';
    await saveQuizResults(client, sessionId, reply.turnId, [
      {
        question_id: question.id,
        question: question.question,
        question_type: question.type,
        options,
        user_answer: answer,
        correct_answer: question.answer,
        explanation: question.explanation,
        difficulty: question.difficulty,
        is_correct: false,
      },
    ]);

    const saved = (await listSavedQuestions(client, { search: question.question.slice(0, 60) })).items.find((item) => item.question === question.question);
    if (!saved) throw new Error('the saved question is missing from the question bank');
    entryId = saved.id;
    if (saved.is_correct !== false) throw new Error('the saved question is not marked wrong');
    const stats = await getQuestionBankStats(client);
    if (stats.total < 1 || stats.wrong < 1) throw new Error('the question bank counts are off');
    // DeepTutor brings a wrong quiz answer back the next day (a right one three days later), so it isn't due yet.
    const summary = await getPracticeSummary(client, 'Asia/Kuala_Lumpur');
    const nextDay = Date.now() / 1000 + 86_400 + 600;
    if (summary.total < 1 || summary.next_due_at === null || summary.next_due_at > nextDay) {
      throw new Error(`the wrong answer isn't scheduled within a day (total ${summary.total}, next ${summary.next_due_at})`);
    }
    const queue = await getPracticeQueue(client, 'Asia/Kuala_Lumpur', { limit: 100 });
    const queued = await getPracticeQuestion(client, entryId);
    if (queued.entry.id !== entryId) throw new Error('the question does not open for practice');
    if (objective) {
      if ((await checkPracticeAnswer(client, entryId, right.join(','))) !== true) throw new Error('the right answer did not check as right');
      if ((await checkPracticeAnswer(client, entryId, answer)) !== false) throw new Error('the wrong answer did not check as wrong');
      const refused = await reviewPracticeQuestion(client, entryId, { requestId: randomId(), version: 0, rating: 'good', answer }).then(
        () => null,
        (error: unknown) => error,
      );
      if (!(refused instanceof DtHttpError) || refused.status !== 422) throw new Error('a wrong answer rated "good" was not refused');
    }
    const request = { requestId: randomId(), version: queued.state.version, rating: 'again' as const, answer };
    const first = await reviewPracticeQuestion(client, entryId, request);
    if (first.version !== queued.state.version + 1 || first.mastered) throw new Error('the review did not move the schedule on');
    const retried = await reviewPracticeQuestion(client, entryId, request);
    if (retried.version !== first.version || retried.due_at !== first.due_at) throw new Error('a retried review was not answered the same');
    const stale = await reviewPracticeQuestion(client, entryId, { ...request, requestId: randomId() }).then(
      () => null,
      (error: unknown) => error,
    );
    if (!(stale instanceof DtHttpError) || stale.status !== 409) throw new Error('a review of an old version was not refused');
    if ((await getPracticeQuestion(client, entryId)).state.version !== first.version) throw new Error('the question does not show its new schedule');

    await updateSavedQuestion(client, entryId, { bookmarked: true });
    const bookmarked = await listSavedQuestions(client, { bookmarked: true, limit: 200 });
    if (!bookmarked.items.some((item) => item.id === entryId)) throw new Error('the bookmark did not stick');

    return {
      note: `${objective ? 'choice' : `"${question.type}"`} question saved wrong; in the bank, due within a day; ${objective ? 'checked right and wrong; "good" refused; ' : ''}reviewed "again" (v${first.version}), retry answered the same, old version refused; bookmarked; deleted`,
      fixture: { summary: shapeOf(summary), queue: shapeOf(queue.slice(0, 1)), entry: shapeOf(saved), review: shapeOf(first) },
    };
  } finally {
    connection.close();
    if (entryId !== null) await deleteSavedQuestion(client, entryId).catch(() => undefined);
    if (sessionId) await deleteSession(client, sessionId).catch(() => undefined);
  }
}

/** Favorites, the Learning Journal and Chat History on the test account; what it makes is deleted. */
async function probeLibrary(baseUrl: string, token: string, client: DtClient): Promise<{ note: string; fixture: Record<string, unknown> }> {
  const notebook = await createNotebook(client, `${PROBE_PREFIX} favorites`, 'Written and deleted by the MavieChat probe');
  let sessionId: string | null = null;
  const connection = new DtTurnConnection({
    url: turnSocketUrl(baseUrl),
    connect: (url, handlers) => {
      const socket = new NodeWebSocket(url, { headers: { Cookie: socketCookieHeader(token) } });
      socket.onopen = () => handlers.onOpen();
      socket.onmessage = (event) => handlers.onMessage(event.data);
      socket.onclose = (event) => handlers.onClose(event.code);
      return { send: (data) => socket.send(data), close: () => socket.close() };
    },
    onEvent: (event) => {
      if (event.type === 'done') finished();
    },
  });
  let finished: () => void = () => undefined;
  try {
    const record = await addChatRecord(client, {
      notebookIds: [notebook.id],
      title: `${PROBE_PREFIX} record`,
      summary: 'A clip for the probe.',
      userQuery: 'What is the capital of Atlantis?',
      output: 'The capital of Atlantis is **Coralia**.',
      metadata: { source: 'maviechat-probe' },
    });
    await updateRecord(client, notebook.id, record.id, { title: `${PROBE_PREFIX} renamed` });
    await updateNotebook(client, notebook.id, { name: `${PROBE_PREFIX} favorites (renamed)` });
    const read = await getNotebook(client, notebook.id);
    if (read.name !== `${PROBE_PREFIX} favorites (renamed)`) throw new Error('the notebook rename did not stick');
    const saved = read.records?.find((item) => item.id === record.id);
    if (saved?.title !== `${PROBE_PREFIX} renamed` || !saved.output.includes('Coralia')) throw new Error('the record edit did not read back');
    const listed = (await listNotebooks(client)).find((item) => item.id === notebook.id);
    if (listed?.record_count !== 1) throw new Error(`the notebook list counts ${String(listed?.record_count)} records`);
    const markdown = await exportNotebook(client, notebook.id);
    if (!markdown.includes('renamed')) throw new Error('the export lacks the record');
    await deleteRecord(client, notebook.id, record.id);
    if ((await getNotebook(client, notebook.id)).records?.length) throw new Error('the record was not removed');

    const journal = await getLearningJournal(client);

    const word = `zq${randomId().slice(0, 8)}`;
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no done event within 3 minutes')), 180_000);
      finished = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    sessionId = (await connection.startTurn({ content: `${PROBE_PREFIX} The code word is ${word}. Just say OK.`, tools: [] })).sessionId;
    await done;
    const hit = (await searchSessions(client, word, { limit: 20 })).sessions.find((item) => item.id === sessionId);
    if (!hit) throw new Error('search did not find the chat by its word');
    if (!searchSnippet(hit, word).includes(word)) throw new Error('the search snippet lacks the word');
    await organizeSession(client, sessionId, { archived: true });
    const archived = (await listSessions(client, { limit: 50 })).find((item) => item.id === sessionId);
    if (!archived || !isArchived(archived)) throw new Error('the archived chat is not marked archived in the full list');
    await organizeSession(client, sessionId, { archived: false });

    return {
      note: `notebook renamed, record edited, exported (${markdown.length} chars) and removed; journal read (${journal.records.length} records); chat found by its word with a snippet, archived and restored; all deleted`,
      fixture: { notebook: shapeOf(read), journal: shapeOf(journal), search: shapeOf(hit) },
    };
  } finally {
    connection.close();
    if (sessionId) await deleteSession(client, sessionId).catch(() => undefined);
    await deleteNotebook(client, notebook.id).catch(() => undefined);
  }
}

/** A one-page PDF holding one line of text, made here so the probe needs no file. */
function onePagePdf(line: string): File {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  ];
  const content = `BT /F1 12 Tf 20 100 Td (${line}) Tj ET`;
  objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new File([pdf], 'probe.pdf', { type: 'application/pdf' });
}

const INDEXING_STAGES = new Set(['initializing', 'processing_documents', 'processing_file']);

/** Polls until DeepTutor has indexed the knowledge base and `until` holds; notes the stages it passed. */
async function indexed(client: DtClient, name: string, stages: Set<string>, until: (info: DtKnowledgeBaseInfo, sawBusy: boolean) => boolean = () => true) {
  const deadline = Date.now() + 240_000;
  let sawBusy = false;
  for (;;) {
    const progress = await getKbProgress(client, name);
    if (progress) stages.add(progress.stage);
    const info = await getKnowledgeBase(client, name);
    const busy = info.status !== 'ready' || (progress !== null && INDEXING_STAGES.has(progress.stage));
    sawBusy ||= busy;
    if (/^(error|failed)$/.test(info.status) || progress?.stage === 'error') throw new Error(`indexing failed (${progress?.message || info.status})`);
    if (!busy && until(info, sawBusy)) return info;
    if (Date.now() > deadline) throw new Error(`still ${info.status} after 4 minutes`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

/** The Knowledge Center on one throwaway knowledge base; it and the chat that used it are deleted. */
async function probeKnowledge(baseUrl: string, token: string, client: DtClient): Promise<{ note: string; fixture: Record<string, unknown> }> {
  const providers = await listRagProviders(client);
  if (!providers.some((provider) => provider.id === 'pageindex-oss' && provider.configured)) throw new Error('PageIndex OSS is not offered on this server');
  const preflight = await ragPreflight(client, 'pageindex-oss');
  if (!preflight.ok) throw new Error(`PageIndex OSS is not ready: ${preflight.missing.join('; ')}`);
  const before = await listKnowledgeCenter(client);
  const previousDefault = before.find((kb) => kb.isDefault)?.name ?? null;
  // Colons aren't allowed in names, so not the usual "APP PROBE:" prefix.
  const name = `app-probe-kb-${randomId().slice(0, 8)}`;
  const word = 'papaya';
  const stages = new Set<string>();
  let sessionId: string | null = null;
  let reply: DtReply = emptyReply();
  let finished: () => void = () => undefined;
  const connection = new DtTurnConnection({
    url: turnSocketUrl(baseUrl),
    connect: (url, handlers) => {
      const socket = new NodeWebSocket(url, { headers: { Cookie: socketCookieHeader(token) } });
      socket.onopen = () => handlers.onOpen();
      socket.onmessage = (event) => handlers.onMessage(event.data);
      socket.onclose = (event) => handlers.onClose(event.code);
      return { send: (data) => socket.send(data), close: () => socket.close() };
    },
    onEvent: (event) => {
      reply = applyTurnEvent(reply, event);
      if (event.type === 'done') finished();
    },
  });
  let created = false;
  try {
    const started = Date.now();
    await createKnowledgeBase(client, { name, provider: 'pageindex-oss', pageindexMode: 'flash', files: [onePagePdf(`The secret probe word is ${word}.`)] });
    created = true;
    const ready = await indexed(client, name, stages);
    const seconds = Math.round((Date.now() - started) / 1000);
    const listed = (await listKnowledgeCenter(client)).find((kb) => kb.name === name);
    if (!listed || listed.provider !== 'pageindex-oss' || listed.documents !== 1) throw new Error(`the list shows ${JSON.stringify(listed && { provider: listed.provider, documents: listed.documents })}`);
    const files = await listKbFiles(client, name);
    if (files.map((file) => file.name).join() !== 'probe.pdf') throw new Error(`the files are ${files.length}, not probe.pdf`);

    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no done event within 3 minutes')), 180_000);
      finished = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    sessionId = (
      await connection.startTurn({ content: `${PROBE_PREFIX} What is the secret probe word in my knowledge base? Answer with that one word.`, tools: [], knowledgeBases: [name] })
    ).sessionId;
    await done;
    if (reply.status !== 'completed') throw new Error(`the turn ended ${reply.status}`);
    if (!reply.answer.toLowerCase().includes(word)) throw new Error("the reply did not find the knowledge base's word");

    const second = new File([await onePagePdf('The second probe word is mango.').arrayBuffer()], 'second.pdf', { type: 'application/pdf' });
    await uploadKbFiles(client, name, [second]);
    await indexed(client, name, stages, (info) => info.documents === 2);
    const both = (await listKbFiles(client, name)).map((file) => file.name).sort();
    if (both.join() !== 'probe.pdf,second.pdf') throw new Error(`after adding, the files are ${both.length}`);
    const removal = await deleteKbFile(client, name, 'second.pdf');
    const left = await listKbFiles(client, name);
    if (left.length !== 1 || left[0]?.name !== 'probe.pdf') throw new Error('removing a file left the wrong files');

    await reindexKnowledgeBase(client, name);
    const reindexed = await indexed(client, name, stages, (info, sawBusy) => sawBusy || info.lastIndexedAt !== ready.lastIndexedAt);

    await setDefaultKnowledgeBase(client, name);
    if (!(await listKnowledgeCenter(client)).find((kb) => kb.name === name)?.isDefault) throw new Error('Make Default did not read back');
    if (previousDefault) await setDefaultKnowledgeBase(client, previousDefault);

    await deleteKnowledgeBase(client, name);
    created = false;
    if ((await listKnowledgeCenter(client)).some((kb) => kb.name === name)) throw new Error('the deleted knowledge base is still listed');

    return {
      note: `indexed in ${seconds}s (${[...stages].join(' → ')}); the chat found the PDF's word; a second PDF added and removed (still indexed: ${removal.wasIndexed}); re-indexed (${reindexed.documents} document); Make Default read back${previousDefault ? ' and the old default put back' : ''}; all deleted`,
      fixture: { item: shapeOf(listed), files: shapeOf(files), providers: shapeOf(providers), stages: [...stages] },
    };
  } finally {
    connection.close();
    if (sessionId) await deleteSession(client, sessionId).catch(() => undefined);
    if (created) await deleteKnowledgeBase(client, name).catch(() => undefined);
  }
}

/** The Task Board and the Calendar on throwaway items; events and the chat are deleted, tasks archived. */
async function probeCalendar(baseUrl: string, token: string, client: DtClient): Promise<{ note: string; fixture: Record<string, unknown> }> {
  const notes: string[] = [];
  const word = `zq${randomId().slice(0, 6)}`;
  const other = `zx${randomId().slice(0, 6)}`;
  const today = dateKey(new Date());
  const tomorrow = addDaysKey(today, 1);
  const taskIds: string[] = [];
  const eventIds: string[] = [];
  let sessionId: string | null = null;
  let reply: DtReply = emptyReply();
  let finished: () => void = () => undefined;
  const connection = new DtTurnConnection({
    url: turnSocketUrl(baseUrl),
    connect: (url, handlers) => {
      const socket = new NodeWebSocket(url, { headers: { Cookie: socketCookieHeader(token) } });
      socket.onopen = () => handlers.onOpen();
      socket.onmessage = (event) => handlers.onMessage(event.data);
      socket.onclose = (event) => handlers.onClose(event.code);
      return { send: (data) => socket.send(data), close: () => socket.close() };
    },
    onEvent: (event) => {
      reply = applyTurnEvent(reply, event);
      if (event.type === 'done') finished();
    },
  });
  const turn = async (content: string, continuing: string | null): Promise<{ answer: string; id: string }> => {
    reply = emptyReply();
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no done event within 3 minutes')), 180_000);
      finished = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    const started = await connection.startTurn({ content, tools: [], ...(continuing ? { sessionId: continuing } : {}) });
    sessionId = started.sessionId;
    await done;
    return { answer: reply.answer, id: started.sessionId };
  };
  try {
    // Tasks: made, moved, dated and cleared.
    let board = await createTask(client, { title: `${PROBE_PREFIX} task ${word}`, note: 'Written by the MavieChat probe', dueDate: tomorrow });
    const mine = board.cards.find((card) => card.title.endsWith(word));
    if (!mine || mine.status !== 'todo' || mine.dueDate !== tomorrow) throw new Error('the new task did not read back as To do, due tomorrow');
    taskIds.push(mine.id);
    board = await createTask(client, { title: `${PROBE_PREFIX} other task ${other}` });
    const second = board.cards.find((card) => card.title.endsWith(other));
    if (!second) throw new Error('the second task is missing');
    taskIds.push(second.id);
    board = await updateTask(client, mine.id, { status: 'doing', note: 'Moved by the probe' });
    if (board.cards.find((card) => card.id === mine.id)?.status !== 'doing') throw new Error('the move to In progress did not stick');
    board = await updateTask(client, second.id, { dueDate: today });
    board = await updateTask(client, second.id, { dueDate: null });
    if (board.cards.find((card) => card.id === second.id)?.dueDate !== null) throw new Error('clearing the due date did not stick');
    notes.push('tasks made, moved and dated');

    // A chat linked to one task: its colour, the model told which task is its own, then unlinked.
    const chat = (await turn(`${PROBE_PREFIX} Just say OK.`, null)).id;
    board = await linkSessionTasks(client, chat, [mine.id]);
    if (sessionStatusColor(board, chat) !== board.colors.doing) throw new Error("the linked chat doesn't take the In progress colour");
    board = await setTaskStatusLink(client, chat, false);
    if (sessionStatusColor(board, chat) !== undefined) throw new Error('turning the status link off left the colour');
    const { answer } = await turn(`${PROBE_PREFIX} Which of my tasks is linked to this conversation? Reply with its title only.`, chat);
    const knows = answer.includes(word) && !answer.includes(other);
    board = await linkSessionTasks(client, chat, []);
    if (board.sessionLinks.some((link) => link.sessionId === chat && link.taskIds.length)) throw new Error('unlinking left a link');
    notes.push(`chat linked (colour on, then off) and unlinked; ${knows ? 'the model named the linked task' : 'the model did not single out the linked task'}`);

    // A timed event that blocks out time for the task.
    const timeZone = deviceTimeZone();
    const calendars = await listCalendars(client);
    const home = calendars.find((calendar) => calendar.isDefault);
    if (!home) throw new Error('no default calendar');
    const start = fromDateKey(tomorrow);
    start.setHours(10);
    const end = new Date(start.getTime() + 3600_000);
    eventIds.push(await createEvent(client, { title: `${PROBE_PREFIX} study ${word}`, allDay: false, start: instant(start), end: instant(end), tzid: timeZone, reminders: [10], taskId: mine.id }));
    const span = await listOccurrences(client, fromDateKey(tomorrow), fromDateKey(addDaysKey(tomorrow, 1)), timeZone);
    const timed = span.find((item) => item.eventId === eventIds[0]);
    if (!timed || timed.taskId !== mine.id || timed.reminders.join() !== '10' || timed.calendarId !== home.id) throw new Error('the timed event did not read back');
    if ((await getTaskBlocks(client))[mine.id] !== 1) throw new Error('the task does not count its time block');

    // An all-day weekly event, three times: one date deleted and undone, then renamed from the second on.
    const weekly = await createEvent(client, { title: `${PROBE_PREFIX} weekly ${word}`, allDay: true, start: tomorrow, end: addDaysKey(tomorrow, 1), tzid: timeZone, rrule: repeatRule('weekly', fromDateKey(tomorrow), true, { kind: 'count', count: 3 }) });
    eventIds.push(weekly);
    // "This and following" splits a series into a new one with its own id, so its dates are found by title.
    const weeks = async () => (await listOccurrences(client, fromDateKey(today), fromDateKey(addDaysKey(today, 30)), timeZone)).filter((item) => item.title.startsWith(`${PROBE_PREFIX} weekly ${word}`));
    const three = await weeks();
    if (three.length !== 3) throw new Error(`the weekly event shows ${three.length} times, not 3`);
    const { undoToken } = await deleteEvent(client, weekly, 'this', three[1]!.occurrence);
    if ((await weeks()).length !== 2) throw new Error('deleting one date did not leave two');
    if (!undoToken) throw new Error('no undo token');
    await undoCalendarChange(client, undoToken);
    if ((await weeks()).length !== 3) throw new Error('undo did not bring the date back');
    await updateEvent(client, weekly, { title: `${PROBE_PREFIX} weekly ${word} renamed` }, 'following', three[1]!.occurrence);
    const renamed = (await weeks()).map((item) => item.title.endsWith('renamed'));
    if (renamed.join() !== 'false,true,true') throw new Error(`renaming from the second date gave ${renamed.join()}`);
    notes.push('a timed event blocks time for a task (counted); a weekly event: one date deleted, undone, renamed from the second on');

    const hits = await searchEvents(client, word);
    if (!hits.some((hit) => hit.id === eventIds[0] && hit.nextStart)) throw new Error('search did not find the event with its next start');
    const layers = await getCalendarLayers(client, fromDateKey(today), fromDateKey(addDaysKey(today, 7)), timeZone);
    notes.push(`search found it; layers read (${layers.reviews.length} review days, ${layers.automations.length} automations, ${layers.footprints.length} footprint days)`);
    return {
      note: `${notes.join('; ')}; events and the chat deleted, tasks archived`,
      fixture: { board: shapeOf(board), occurrence: shapeOf(timed), layers: shapeOf(layers), hits: shapeOf(hits) },
    };
  } finally {
    connection.close();
    for (const id of eventIds.reverse()) await deleteEvent(client, id, 'all').catch(() => undefined);
    // Anything else this run made (a series split off by a change) carries its word.
    for (const hit of await searchEvents(client, word).catch(() => [])) await deleteEvent(client, hit.id, 'all').catch(() => undefined);
    for (const id of taskIds) await updateTask(client, id, { archived: true }).catch(() => undefined);
    if (sessionId) await deleteSession(client, sessionId).catch(() => undefined);
  }
}

function report(version: string) {
  const dir = path.resolve(import.meta.dirname, '..', 'fixtures', `deeptutor-${version}`);
  if (!args['no-fixtures'] && Object.keys(fixtures).length > 0) {
    mkdirSync(dir, { recursive: true });
    for (const [name, data] of Object.entries(fixtures)) writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
  }
  for (const result of results) console.log(`${result.ok ? '✓' : '✗'} ${result.name}${result.note ? ` — ${result.note}` : ''}`);
  if (!args['no-fixtures']) console.log(`fixtures: ${path.relative(process.cwd(), dir)}`);
  process.exitCode = results.every((result) => result.ok) ? 0 : 1;
}

void main();
