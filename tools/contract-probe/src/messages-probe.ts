import {
  applyMessageEvent,
  buildCompletionRequest,
  buildTurn,
  chatFeatures,
  codeRunEngine,
  createChat,
  deleteChat,
  getChat,
  listModels,
  openSocketSession,
  OwuiHttpError,
  pyodideIndexUrl,
  requestParams,
  saveMessage,
  savedTemporaryChat,
  startCompletion,
  templateVariables,
  toggleArchived,
  uuidv4,
  type Capabilities,
  type ChatHistory,
  type HistoryMessage,
  type OwuiClient,
  type ServerConfig,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

interface MessagesInput {
  client: OwuiClient;
  baseUrl: string;
  token: string;
  userId: string;
  userName: string;
  capabilities: Capabilities;
  config: ServerConfig | undefined;
  canDelete: boolean;
  /** The scratch servers: Jupyter code may run, and their echo model drives the code interpreter. */
  scratch: boolean;
}

/** The scratch servers' echo model (`npm run scratch:setup`), and how much of your message it says back. */
const ECHO_MODEL = 'app_probe_echo';
const ECHO_LIMIT = 8000;

/**
 * The messages and markdown slice, with no model calls: where Run runs (the server's Jupyter, or
 * Python on the phone from the server's own Pyodide, checked file by file as the app's page loads
 * it); the server refusing to run code itself unless the admin chose Jupyter; the admin's CSP for
 * embeds; a message saved with one of its files taken out, the app's way. On the scratch servers
 * the echo model drives the code interpreter: the server asks this socket to run Python
 * (`execute:python`), the probe answers as the app does, and the answer lands in the reply.
 * Chats it makes are deleted (archived where the account may not delete chats).
 */
export async function probeMessages(input: MessagesInput): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const { client, config } = input;
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };
  const engine = codeRunEngine(config);
  const interpreter = (config?.code as { interpreter_engine?: unknown } | undefined)?.interpreter_engine;
  fixture.engines = { run: engine, interpreter: typeof interpreter === 'string' ? interpreter : null };

  await check("Pyodide on the server, as the app's Python page loads it", async () => {
    if (engine !== 'pyodide' && interpreter !== 'pyodide') return 'skipped: this server runs code on Jupyter';
    const index = pyodideIndexUrl(input.baseUrl);
    // The page has no origin of its own ("null"): the module it imports needs CORS for that.
    const files: [string, RegExp][] = [
      ['pyodide.js', /javascript/],
      ['pyodide.asm.mjs', /javascript/],
      ['pyodide.asm.wasm', /application\/wasm/],
      ['python_stdlib.zip', /zip|octet-stream/],
      ['pyodide-lock.json', /json/],
    ];
    for (const [name, type] of files) {
      const response = await fetch(`${index}${name}`, { method: 'HEAD', headers: { Origin: 'null' } });
      if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
      if (!type.test(response.headers.get('content-type') ?? '')) throw new Error(`${name}: type ${response.headers.get('content-type')}`);
      const allowed = response.headers.get('access-control-allow-origin');
      if (name === 'pyodide.asm.mjs' && allowed !== '*' && allowed !== 'null') throw new Error(`${name}: no CORS for the page (${allowed ?? 'none'})`);
    }
    const lock = (await (await fetch(`${index}pyodide-lock.json`)).json()) as { info?: { python?: string }; packages?: Record<string, { file_name?: string; depends?: string[] }> };
    const packages = lock.packages ?? {};
    // Packages the web preloads for plots and tables, with everything they need.
    const wanted = new Set<string>();
    const add = (name: string) => {
      if (wanted.has(name) || !packages[name]) return;
      wanted.add(name);
      for (const dependency of packages[name]?.depends ?? []) add(dependency);
    };
    for (const name of ['numpy', 'pandas', 'matplotlib', 'micropip']) add(name);
    const missing: string[] = [];
    for (const name of wanted) {
      const file = packages[name]?.file_name;
      const response = file ? await fetch(new URL(file, index), { method: 'HEAD' }) : null;
      if (!response?.ok) missing.push(name);
    }
    fixture.pyodide = { python: lock.info?.python ?? null, packages: Object.keys(packages).length, checked: wanted.size, missing: missing.length };
    if (missing.length) throw new Error(`packages the server lists but doesn't have: ${missing.join(', ')}`);
    return `Python ${lock.info?.python ?? '?'}; loader, module (CORS for the page), runtime, library and lock there; numpy, pandas, matplotlib and their ${wanted.size - 4} needs all served`;
  });

  await check('the server runs code itself only on Jupyter', async () => {
    if (engine === 'jupyter') {
      if (!input.scratch) return 'skipped: Jupyter code runs only on the scratch servers';
      const answer = await client.post<{ stdout?: string }>('/api/v1/utils/code/execute', { code: 'print(6 * 7)' });
      if (!String(answer.stdout ?? '').includes('42')) throw new Error('Jupyter answered without the printed 42');
      return 'Jupyter ran print(6 * 7) and printed 42';
    }
    try {
      await client.post('/api/v1/utils/code/execute', { code: 'print("APP PROBE")' });
    } catch (error) {
      if (error instanceof OwuiHttpError && (error.status === 400 || error.status === 403)) {
        return `refused (${error.status}): Run uses ${engine === 'pyodide' ? 'Python on the phone' : 'nothing (code execution off)'}, as the web uses the browser`;
      }
      throw error;
    }
    throw new Error('the server ran code without Jupyter');
  });

  await check("the admin's Content-Security-Policy for embeds", async () => {
    const csp = config?.ui?.iframe_csp;
    fixture.iframeCsp = typeof csp === 'string' && csp.trim() ? 'set' : 'not set';
    return typeof csp === 'string' && csp.trim() ? 'set: embeds get it first in their page' : 'not set: embeds load as sent';
  });

  let chatId: string | null = null;
  try {
    await check('a message saved with one of its files taken out', async () => {
      const user = uuidv4();
      const reply = uuidv4();
      const now = Math.floor(Date.now() / 1000);
      const files = [
        { type: 'file', id: 'app-probe-a', name: 'a.txt', status: 'processed' },
        { type: 'file', id: 'app-probe-b', name: 'b.txt', status: 'processed' },
      ];
      const history: ChatHistory = {
        currentId: reply,
        messages: {
          [user]: { id: user, parentId: null, childrenIds: [reply], role: 'user', content: 'APP PROBE: two files', files, timestamp: now },
          [reply]: { id: reply, parentId: user, childrenIds: [], role: 'assistant', content: 'APP PROBE reply', done: true, timestamp: now },
        },
      };
      const chat = await createChat(client, savedTemporaryChat(history, { models: [] }));
      chatId = chat.id;
      const original = history.messages[user] as HistoryMessage;
      await saveMessage(client, chat.id, { ...original, content: 'APP PROBE: one file', files: [files[1]] }, reply);
      const saved = ((await getChat(client, chat.id)).chat.history as ChatHistory).messages;
      const kept = saved[user]?.files as { id?: string }[] | undefined;
      if (saved[user]?.content !== 'APP PROBE: one file') throw new Error('the edited text was not kept');
      if (kept?.length !== 1 || kept[0]?.id !== 'app-probe-b') throw new Error(`files read back: ${JSON.stringify(kept?.map((file) => file.id))}`);
      if (saved[reply]?.content !== 'APP PROBE reply') throw new Error('the reply changed');
      return 'the text and the one file kept read back; the reply untouched';
    });
  } finally {
    const id = chatId as string | null;
    if (id) await removeChat(client, id, input.canDelete);
  }

  await check("the code interpreter's Python, run where the app runs it", async () => {
    if (!input.scratch) return 'skipped: needs the scratch servers’ echo model (a real model would cost a reply)';
    if (interpreter !== 'pyodide') return 'skipped: this server runs the code interpreter on Jupyter';
    if (!input.capabilities.feature('codeInterpreter')) return 'skipped: the code interpreter is off for this account';
    const model = (await listModels(client)).find((item) => item.id === ECHO_MODEL);
    if (!model) return 'skipped: this account sees no echo model (npm run scratch:setup adds it)';
    return await interpreterRoundTrip(input, model, fixture);
  });

  return { steps, fixture };
}

/**
 * The echo model says back a code interpreter block (with legacy tool calling the server reads
 * the tags in its reply), so the server asks this socket to run it. Answered as the app's
 * ChatStreams answers: `{ stdout, stderr, result }`.
 */
async function interpreterRoundTrip(input: MessagesInput, model: Awaited<ReturnType<typeof listModels>>[number], fixture: Record<string, unknown>): Promise<string> {
  const { client } = input;
  const socket = openSocketSession({
    baseUrl: input.baseUrl,
    token: input.token,
    expectedUserId: input.userId,
    websocketOnly: input.capabilities.websocketOnly,
    heartbeatIntervalSec: input.capabilities.heartbeatIntervalSec,
  });
  const requests: { keys: string[]; ownSession: boolean; code: string; files: number }[] = [];
  let reply: HistoryMessage | null = null;
  let wake: () => void = () => undefined;
  socket.onChatEvent((event, answer) => {
    if (event.data.type === 'execute:python') {
      const data = (event.data.data ?? {}) as { id?: unknown; code?: unknown; session_id?: unknown; files?: unknown };
      requests.push({ keys: Object.keys(data).sort(), ownSession: data.session_id === socket.sessionId, code: String(data.code ?? ''), files: Array.isArray(data.files) ? data.files.length : -1 });
      answer?.({ stdout: 'APP PROBE 42\n', stderr: '', result: null });
      return;
    }
    if (answer) answer({ error: 'unsupported in probe' });
    if (!reply || event.message_id !== reply.id) return;
    reply = applyMessageEvent(reply, event.data.type, event.data.data);
    if (reply.done) wake();
  });
  let chatId: string | undefined;
  try {
    await socket.joined;
    // The server adds its code interpreter instructions after your message, and the echo says
    // back the first 8000 characters: a message of exactly that length ends its reply with the block.
    const block = '<code_interpreter type="code" lang="python">print(6 * 7)</code_interpreter>';
    const content = `APP PROBE: ${'.'.repeat(ECHO_LIMIT - 'APP PROBE: '.length - 1 - block.length)} ${block}`;
    const turn = buildTurn({ history: { messages: {}, currentId: null }, content, models: [model] });
    reply = turn.replies[0] as HistoryMessage;
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no finished reply within 3 minutes')), 180_000);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    const body = buildCompletionRequest({
      turn,
      chatId: null,
      sessionId: socket.sessionId ?? '',
      model,
      params: requestParams(undefined, { function_calling: 'legacy' }),
      features: chatFeatures(input.capabilities, { codeInterpreter: true }, false),
      variables: templateVariables({ name: input.userName }),
      tasks: { title: false, tags: false, followUps: false },
    });
    chatId = (await startCompletion(client, body)).chat_id;
    await done;
    fixture.interpreter = { requests: requests.length, keys: requests[0]?.keys ?? [], ownSession: requests.every((request) => request.ownSession), files: requests[0]?.files ?? null };
    if (!requests.length) {
      const shown = reply as HistoryMessage;
      const types = (Array.isArray(shown.output) ? shown.output : []).map((item) => String((item as { type?: string }).type));
      const savedReply = ((await getChat(client, chatId)).chat.history as ChatHistory).messages[shown.id];
      const ran = (Array.isArray(savedReply?.output) ? savedReply.output : []).find((item) => (item as { type?: string }).type === 'open_webui:code_interpreter') as { output?: unknown } | undefined;
      const parts = (Array.isArray(savedReply?.output) ? savedReply.output : []).map((item) => JSON.stringify(item).slice(0, 160));
      throw new Error(`the server never asked this socket to run Python (the reply: ${types.join(', ') || 'no output'}; its run: ${JSON.stringify(ran?.output ?? null).slice(0, 240)}; parts: ${parts.join(' || ')})`);
    }
    if (!requests.every((request) => request.ownSession)) throw new Error('a request named another session');
    if (!requests[0]!.code.includes('print(6 * 7)')) throw new Error('the request did not carry the code');
    // The saved reply holds the answer the app gave.
    const id = chatId;
    let saved = '';
    for (let tries = 0; tries < 10 && !saved.includes('APP PROBE 42'); tries += 1) {
      const message = ((await getChat(client, id)).chat.history as ChatHistory).messages[(reply as HistoryMessage).id];
      saved = JSON.stringify([message?.output ?? null, message?.content ?? '']);
      if (!saved.includes('APP PROBE 42')) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!saved.includes('APP PROBE 42')) throw new Error("the reply doesn't hold the answer");
    return `asked ${requests.length} time${requests.length === 1 ? '' : 's'} over this socket (keys ${requests[0]!.keys.join(', ')}); the answer is in the saved reply`;
  } finally {
    socket.close();
    if (chatId) await removeChat(client, chatId, input.canDelete);
  }
}

async function removeChat(client: OwuiClient, id: string, canDelete: boolean): Promise<void> {
  if (canDelete) await deleteChat(client, id).catch(() => undefined);
  else await toggleArchived(client, id).catch(() => undefined);
}
