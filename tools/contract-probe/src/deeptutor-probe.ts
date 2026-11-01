/**
 * DeepTutor contract probe (milestone M1.5):
 *   npm run probe:deeptutor -- [--url http://127.0.0.1:3782] [--env ~/.config/maviechat/deeptutor-test.env] [--no-fixtures] [--turn]
 *
 * `--turn` also runs one short "APP PROBE:" chat turn over `/ws` (it uses the account's model),
 * drops the socket mid-reply on purpose, checks the resumed reply equals the saved one, and
 * deletes the session.
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
  createNotebook,
  deleteNotebook,
  deleteSession,
  DtClient,
  DtTurnConnection,
  emptyReply,
  savedReply,
  shownMessages,
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
      const current = new NodeWebSocket(url, { headers: { Cookie: `${TOKEN_COOKIE}=${token}` } });
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
