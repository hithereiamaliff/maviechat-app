import {
  applyMessageEvent,
  buildCompletionRequest,
  buildRegenerateTurn,
  buildTurn,
  chatFeatures,
  deleteChat,
  getChat,
  groupPosition,
  listModels,
  mergedResponse,
  mergeInput,
  mergeResponses,
  openSocketSession,
  outputText,
  replyGroups,
  requestParams,
  saveMessage,
  selectBranch,
  startCompletion,
  switchGroupVersion,
  templateVariables,
  toggleArchived,
  updateChatControls,
  type Capabilities,
  type ChatHistory,
  type HistoryMessage,
  type ModelItem,
  type OwuiClient,
  type Turn,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

interface A4Input {
  client: OwuiClient;
  baseUrl: string;
  token: string;
  userId: string;
  userName: string;
  capabilities: Capabilities;
  canDelete: boolean;
  modelId?: string;
  /** A second model to compare with; without one, the first model answers twice (two columns of the same model). */
  secondModelId?: string;
}

const textOf = (message: HistoryMessage | undefined) => (outputText(message?.output) || message?.content || '').trim();
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Milestone 2 slice A4 against a live server, in the test account: one message sent to two
 * models (Compare) in a new chat and in a saved one, the columns read back by `modelIdx`, one
 * column regenerated and its versions switched, and "Merge Responses" streamed and saved on the
 * shown reply. The chat is deleted, or archived.
 */
export async function probeA4(input: A4Input): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
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

  if (!input.capabilities.can('chat.multiple_models', true)) return { steps: [{ name: 'A4', ok: false, note: 'this account may not compare models' }], fixture };
  const models = await listModels(client);
  const first = models.find((item) => item.id === input.modelId) ?? models[0];
  const second = models.find((item) => item.id === input.secondModelId) ?? first;
  if (!first || !second) return { steps: [{ name: 'A4', ok: false, note: 'no model visible' }], fixture };
  const pair: ModelItem[] = [first, second];
  fixture.columns = first.id === second.id ? 'one model twice' : 'two models';

  const socket = openSocketSession({
    baseUrl: input.baseUrl,
    token: input.token,
    expectedUserId: input.userId,
    websocketOnly: input.capabilities.websocketOnly,
    heartbeatIntervalSec: input.capabilities.heartbeatIntervalSec,
  });
  const replies = new Map<string, HistoryMessage>();
  const waiters = new Map<string, () => void>();
  socket.onChatEvent((event, answer) => {
    const id = event.message_id;
    if (answer) answer({ error: 'unsupported in probe' });
    if (!id || !replies.has(id)) return;
    const updated = applyMessageEvent(replies.get(id) as HistoryMessage, event.data.type, event.data.data);
    replies.set(id, updated);
    if (updated.done) waiters.get(id)?.();
  });
  const params = { system: 'You are a test fixture. Whatever the user writes, reply with one short sentence about fruit.', temperature: 0 };
  let sessionId = '';

  /** Sends a turn the way the app does (first model leads the request) and waits for every reply in it. */
  const run = async (turn: Turn, chatId: string | null) => {
    const done = turn.replies.map(
      (reply) =>
        new Promise<HistoryMessage>((resolve, reject) => {
          replies.set(reply.id, reply);
          const timer = setTimeout(() => reject(new Error('no done within 120 s')), 120_000);
          waiters.set(reply.id, () => {
            clearTimeout(timer);
            resolve(replies.get(reply.id) as HistoryMessage);
          });
        }),
    );
    const body = buildCompletionRequest({
      turn,
      chatId,
      sessionId,
      model: first,
      system: params.system,
      params: requestParams(undefined, params),
      features: chatFeatures(input.capabilities, {}, false),
      variables: templateVariables({ name: input.userName }),
      tasks: { title: false, tags: false, followUps: false },
    });
    const started = await startCompletion(client, body);
    return { chatId: started.chat_id, done: await Promise.all(done), body };
  };

  let chatId: string | undefined;
  try {
    await socket.joined;
    sessionId = socket.sessionId ?? '';

    const created = await check('a new chat sent to two models: one column each, by modelIdx', async () => {
      const turn = buildTurn({ history: { messages: {}, currentId: null }, content: 'APP PROBE: name a fruit', models: pair });
      const sent = await run(turn, null);
      chatId = sent.chatId;
      await updateChatControls(client, chatId, { params });
      const ids = (sent.body as { message_ids?: { modelIdx: number }[] }).message_ids?.map((entry) => entry.modelIdx);
      if (JSON.stringify(ids) !== '[0,1]') throw new Error(`message_ids carried columns ${JSON.stringify(ids)}`);
      if (sent.done.some((reply) => !textOf(reply))) throw new Error('a column came back empty');
      await pause(1500);
      const record = await getChat(client, chatId);
      const history = record.chat.history as ChatHistory;
      const user = history.messages[turn.userMessage.id];
      if (JSON.stringify(user?.models) !== JSON.stringify(pair.map((model) => model.id))) throw new Error("the user message doesn't list both models");
      const saved = turn.replies.map((reply) => history.messages[reply.id]);
      if (saved.some((reply, index) => reply?.modelIdx !== index)) throw new Error('a saved reply lost its column');
      const groups = replyGroups(history, turn.replies[0]!.id);
      if (groups?.length !== 2) throw new Error(`${groups?.length ?? 0} columns read back`);
      fixture.newChat = {
        chatModels: (record.chat.models ?? []).length,
        current: history.currentId === turn.replies[0]!.id ? 'first reply' : history.currentId === turn.replies[1]!.id ? 'second reply' : 'other',
      };
      return `both answered; saved with modelIdx 0 and 1; chat.models has ${(record.chat.models ?? []).length}; the server shows the ${String((fixture.newChat as { current: string }).current)}`;
    });
    if (!created || !chatId) return { steps, fixture };
    const id = chatId;

    let secondTurn: Turn | undefined;
    await check('a saved chat sent to two models again: which answer the server shows', async () => {
      const history = (await getChat(client, id)).chat.history as ChatHistory;
      secondTurn = buildTurn({ history, content: 'APP PROBE: and another', models: pair });
      await run(secondTurn, id);
      await pause(1500);
      const record = await getChat(client, id);
      const saved = record.chat.history as ChatHistory;
      const [a, b] = secondTurn.replies;
      const current = record.current_message_id ?? saved.currentId;
      fixture.savedChat = { current: current === a!.id ? 'first reply' : current === b!.id ? 'second reply' : 'other' };
      if (replyGroups(saved, a!.id)?.length !== 2) throw new Error('the second turn has no two columns');
      return `both answered; the server shows the ${String((fixture.savedChat as { current: string }).current)}`;
    });
    if (!secondTurn) return { steps, fixture };
    const turn = secondTurn;

    await check("one column regenerated: it gains a version, the other column doesn't", async () => {
      const history = (await getChat(client, id)).chat.history as ChatHistory;
      const regen = buildRegenerateTurn({ history, userMessageId: turn.userMessage.id, model: second, modelIdx: 1 });
      await run(regen, id);
      await pause(1500);
      const saved = (await getChat(client, id)).chat.history as ChatHistory;
      const fresh = regen.replies[0]!.id;
      if (saved.messages[fresh]?.modelIdx !== 1) throw new Error('the new version lost its column');
      const groups = replyGroups(saved, fresh)!;
      const [left, right] = groups;
      if (left?.ids.length !== 1 || right?.ids.length !== 2) throw new Error(`columns have ${groups.map((group) => group.ids.length).join(' and ')} versions`);
      const back = switchGroupVersion(saved, right, -1);
      if (back !== turn.replies[1]!.id) throw new Error('switching the column back did not land on its first version');
      await selectBranch(client, id, back);
      const after = await getChat(client, id);
      if ((after.current_message_id ?? after.chat.history?.currentId) !== back) throw new Error('the switch did not save');
      return `column 2 now ${groupPosition(right).count} versions, column 1 still 1; switching back saved`;
    });

    await check('Merge Responses: streamed, then kept on the shown reply', async () => {
      const record = await getChat(client, id);
      const history = record.chat.history as ChatHistory;
      const shown = record.current_message_id ?? history.currentId;
      const groups = shown ? replyGroups(history, shown) : null;
      if (!shown || !groups) throw new Error('the shown reply is not in a two-column turn');
      const request = mergeInput(history, groups, shown, id);
      let pieces = 0;
      const merged = await mergeResponses(client, request, () => {
        pieces += 1;
      });
      if (!merged.trim()) throw new Error('the merged answer is empty');
      const reply = history.messages[shown]!;
      await saveMessage(client, id, { ...reply, merged: { status: true, content: merged } }, shown);
      const after = (await getChat(client, id)).chat.history as ChatHistory;
      if (mergedResponse(after.messages[shown])?.content !== merged) throw new Error('the merged answer did not save');
      if (Object.keys(after.messages).length !== Object.keys(history.messages).length) throw new Error('saving it changed the other messages');
      if (textOf(after.messages[shown]) !== textOf(reply)) throw new Error('saving it changed the reply itself');
      fixture.merge = { streamedPieces: pieces > 2 ? 'several' : pieces };
      return `${merged.length} characters in ${pieces} updates; saved as merged on the shown reply, nothing else changed`;
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
