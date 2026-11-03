import {
  applyMessageEvent,
  branchPath,
  buildCompletionRequest,
  buildTurn,
  chatFeatures,
  deleteChat,
  getChat,
  getUserValves,
  getUserValvesSpec,
  listFunctions,
  listModels,
  listTools,
  openSocketSession,
  outputText,
  overviewRows,
  requestFiles,
  requestParams,
  startCompletion,
  streamResponse,
  templateVariables,
  textFileItem,
  toggleArchived,
  updateChatControls,
  updateUserValves,
  uuidv4,
  valveFields,
  type Capabilities,
  type ChatHistory,
  type HistoryMessage,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

interface A3Input {
  client: OwuiClient;
  baseUrl: string;
  token: string;
  userId: string;
  userName: string;
  capabilities: Capabilities;
  canDelete: boolean;
  modelId?: string;
}

const textOf = (message: HistoryMessage | undefined) => (outputText(message?.output) || message?.content || '').trim();
const told = (word: string) => `You are a test fixture. Whatever the user writes, reply with exactly the single word ${word} and nothing else.`;

/**
 * Milestone 2 slice A3 against a live server, in the test account: a chat's own system prompt
 * and parameters (saved as the app saves them, and obeyed), controls changed mid-chat without
 * touching its messages, a document removed from the chat's files staying out, a reply with
 * streaming off, the Overview's rows, and user valves read and saved back unchanged. The chat is
 * deleted, or archived.
 */
export async function probeA3(input: A3Input): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const { client } = input;
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
      return true;
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
      return false;
    }
  };

  const models = await listModels(client);
  const model = models.find((item) => item.id === input.modelId) ?? models[0];
  if (!model) return { steps: [{ name: 'A3', ok: false, note: 'no model visible' }], fixture };

  const socket = openSocketSession({
    baseUrl: input.baseUrl,
    token: input.token,
    expectedUserId: input.userId,
    websocketOnly: input.capabilities.websocketOnly,
    heartbeatIntervalSec: input.capabilities.heartbeatIntervalSec,
  });
  const replies = new Map<string, HistoryMessage>();
  const waiters = new Map<string, () => void>();
  const eventTypes = new Set<string>();
  socket.onChatEvent((event, answer) => {
    const id = event.message_id;
    if (answer) answer({ error: 'unsupported in probe' });
    if (!id || !replies.has(id)) return;
    eventTypes.add(event.data.type);
    const updated = applyMessageEvent(replies.get(id) as HistoryMessage, event.data.type, event.data.data);
    replies.set(id, updated);
    if (updated.done) waiters.get(id)?.();
  });
  const base = {
    sessionId: '',
    model,
    features: chatFeatures(input.capabilities, {}, false),
    variables: templateVariables({ name: input.userName }),
    tasks: { title: false, tags: false, followUps: false },
  };

  /** One turn the way the app sends it: the chat's params and files decide the request. */
  const send = async (history: ChatHistory, chatId: string | null, content: string, chatParams: Record<string, unknown>, options: { files?: unknown[]; chatFiles?: unknown[] } = {}) => {
    const turn = buildTurn({ history, content, models: [model], files: options.files });
    const reply = turn.replies[0] as HistoryMessage;
    replies.set(reply.id, reply);
    const done = new Promise<HistoryMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no done within 120 s')), 120_000);
      waiters.set(reply.id, () => {
        clearTimeout(timer);
        resolve(replies.get(reply.id) as HistoryMessage);
      });
    });
    const parentId = turn.userMessage.parentId;
    const files = requestFiles(parentId ? branchPath(turn.history, parentId) : [], turn.userMessage, options.chatFiles);
    const body = buildCompletionRequest({
      ...base,
      turn,
      chatId,
      system: chatParams.system as string | undefined,
      params: requestParams(undefined, chatParams),
      stream: streamResponse(model, undefined, chatParams),
      files,
    });
    const started = await startCompletion(client, body);
    return { chatId: started.chat_id, reply: await done, body };
  };

  let chatId: string | undefined;
  try {
    await socket.joined;
    base.sessionId = socket.sessionId ?? '';
    const document = textFileItem({ name: 'probe-notes.txt', content: 'APP PROBE notes: nothing to see here.', itemId: uuidv4(), id: uuidv4() });
    const firstParams = { system: told('PINEAPPLE'), temperature: 0 };

    const created = await check("a new chat's system prompt and params: obeyed and saved", async () => {
      const first = await send({ messages: {}, currentId: null }, null, 'APP PROBE: hello', firstParams, { files: [document] });
      chatId = first.chatId;
      // As the app does: the request doesn't save a new chat's params, so they're saved once it exists.
      await updateChatControls(client, chatId, { params: firstParams });
      if (!/pineapple/i.test(textOf(first.reply))) throw new Error('the reply ignored the system prompt');
      const saved = (await getChat(client, chatId)).chat;
      if (JSON.stringify(saved.params) !== JSON.stringify(firstParams)) throw new Error('the params did not read back');
      const files = (saved.files ?? []) as { id?: string }[];
      if (!files.some((file) => file.id === document.id)) throw new Error("the chat's files lack the document it was sent with");
      return `replied PINEAPPLE; params read back; chat.files holds the document (${files.length})`;
    });
    if (!created || !chatId) return { steps, fixture };
    const id = chatId;
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const secondParams = { system: told('MANGO'), temperature: 0, stop: 'ZZZ' };
    await check('controls changed mid-chat: messages untouched, the next reply obeys', async () => {
      const before = (await getChat(client, id)).chat.history;
      await updateChatControls(client, id, { params: secondParams });
      const record = await getChat(client, id);
      const history = record.chat.history;
      if (!history || Object.keys(history.messages).length !== Object.keys(before?.messages ?? {}).length || history.currentId !== before?.currentId) {
        throw new Error('saving the controls changed the messages');
      }
      const next = await send(history, id, 'APP PROBE: and again', record.chat.params ?? {}, { chatFiles: record.chat.files as unknown[] });
      if (!/mango/i.test(textOf(next.reply))) throw new Error('the reply ignored the changed system prompt');
      const sent = next.body as { params?: { stop?: unknown }; files?: { id?: string }[] };
      if (JSON.stringify(sent.params?.stop) !== '["ZZZ"]') throw new Error('the stop sequence was not sent as a list');
      if (!sent.files?.some((file) => file.id === document.id)) throw new Error('the kept document was not sent');
      return 'history unchanged by the save; replied MANGO; stop sent as a list; the document still sent';
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));

    await check('a document removed in Controls stays out; a reply with streaming off', async () => {
      await updateChatControls(client, id, { files: [] });
      const record = await getChat(client, id);
      if ((record.chat.files ?? []).length !== 0) throw new Error('the files did not save as empty');
      const history = record.chat.history as ChatHistory;
      const quiet = await send(history, id, 'APP PROBE: once more', { ...secondParams, stream_response: false }, { chatFiles: record.chat.files as unknown[] });
      const sent = quiet.body as { stream?: boolean; files?: unknown[] };
      if (sent.stream !== false) throw new Error('stream was not turned off');
      if (sent.files !== undefined) throw new Error('the removed document was sent');
      if (!/mango/i.test(textOf(quiet.reply))) throw new Error(`the unstreamed reply reads "${textOf(quiet.reply).slice(0, 30)}"`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const after = await getChat(client, id);
      if ((after.chat.files ?? []).length !== 0) throw new Error('the server put the removed document back');
      const saved = after.chat.history?.messages[quiet.reply.id];
      if (textOf(saved) !== textOf(quiet.reply)) throw new Error('the unstreamed reply differs from the saved one');
      fixture.unstreamedEvents = [...eventTypes].sort();
      return 'files saved empty and kept empty; not sent; the unstreamed reply arrived and matches the saved one';
    });

    await check('Overview lists every message, the shown branch marked', async () => {
      const history = (await getChat(client, id)).chat.history as ChatHistory;
      const rows = overviewRows(history, history.currentId);
      const count = Object.keys(history.messages).length;
      if (rows.length !== count) throw new Error(`${rows.length} rows for ${count} messages`);
      if (rows.filter((row) => row.shown).length !== count) throw new Error('not every message of a fork-free chat is on the shown branch');
      return `${rows.length} rows, all shown, no indents (${rows.every((row) => row.indent === 0) ? 'flat' : 'indented'})`;
    });

    await check('user valves: read, then saved back unchanged', async () => {
      const owners = [
        ...(await listTools(client)).filter((tool) => !tool.id.startsWith('server:')).map((tool) => ({ owner: 'tools' as const, id: tool.id })),
        ...(await listFunctions(client)).map((item) => ({ owner: 'functions' as const, id: item.id })),
      ];
      for (const { owner, id: ownerId } of owners) {
        const spec = await getUserValvesSpec(client, owner, ownerId);
        const fields = valveFields(spec);
        if (fields.length === 0) continue;
        const values = await getUserValves(client, owner, ownerId);
        fixture.valves = { owner, fields: fields.map((field) => field.kind) };
        const set = Object.entries(values).filter(([, value]) => value !== null && value !== undefined);
        const what = `${owner.slice(0, -1)} with ${fields.length} valves (${fields.map((field) => field.kind).join(', ')})`;
        // Saving with nothing set would store every default for the account, so only values it has are saved back.
        if (set.length === 0) return `${what}; none set for this account, so nothing saved back`;
        const saved = await updateUserValves(client, owner, ownerId, values);
        if (!set.every(([key, value]) => JSON.stringify(saved[key]) === JSON.stringify(value))) throw new Error(`the ${owner} valves changed on saving them back`);
        return `${what}; ${set.length} set, saved back unchanged`;
      }
      fixture.valves = { checked: owners.length, withUserValves: 0 };
      return `none of the ${owners.length} tools and functions visible to this account has user valves (nothing to save)`;
    });
    return { steps, fixture };
  } finally {
    socket.close();
    if (chatId) {
      if (input.canDelete) await deleteChat(client, chatId).catch(() => undefined);
      else await toggleArchived(client, chatId).catch(() => undefined);
    }
  }
}
