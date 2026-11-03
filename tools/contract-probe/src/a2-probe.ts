import {
  applyMessageEvent,
  buildCompletionRequest,
  buildContinueTurn,
  buildTurn,
  chatFeatures,
  createFeedback,
  deleteChat,
  getChat,
  listModels,
  modelActions,
  openSocketSession,
  outputText,
  ratingFeedback,
  replyCopy,
  saveMessage,
  saveMessages,
  startCompletion,
  templateVariables,
  toggleArchived,
  updateFeedback,
  uuidv4,
  withEditedTexts,
  type Capabilities,
  type HistoryMessage,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

interface A2Input {
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

/**
 * Milestone 2 slice A2 against a live server, in the test account: a reply edited in place and
 * saved as a copy, the copy continued, a rating filed with Open WebUI's evaluations (then
 * removed), and the model's action buttons listed. The chat is deleted, or archived.
 */
export async function probeA2(input: A2Input): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
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
  if (!model) return { steps: [{ name: 'A2', ok: false, note: 'no model visible' }], fixture };

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
  const waitDone = (id: string) =>
    new Promise<HistoryMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no done within 120 s')), 120_000);
      waiters.set(id, () => {
        clearTimeout(timer);
        resolve(replies.get(id) as HistoryMessage);
      });
    });
  const base = {
    sessionId: '',
    model,
    features: chatFeatures(input.capabilities, {}, false),
    variables: templateVariables({ name: input.userName }),
    tasks: { title: false, tags: false, followUps: false },
  };

  let chatId: string | undefined;
  let feedbackId: string | null = null;
  try {
    await socket.joined;
    base.sessionId = socket.sessionId ?? '';
    const turn = buildTurn({ history: { messages: {}, currentId: null }, content: 'APP PROBE: count from 1 to 5, one number per line.', models: [model] });
    const first = turn.replies[0] as HistoryMessage;
    replies.set(first.id, first);
    const answered = await check('a short reply', async () => {
      chatId = (await startCompletion(client, buildCompletionRequest({ ...base, turn, chatId: null }))).chat_id;
      const done = await waitDone(first.id);
      if (!textOf(done)) throw new Error('empty reply');
      return `${textOf(done).length} chars`;
    });
    if (!answered || !chatId) return { steps, fixture };
    const id = chatId;
    await new Promise((resolve) => setTimeout(resolve, 1500));

    await check('edit a reply in place', async () => {
      const reply = (await getChat(client, id)).chat.history?.messages[first.id];
      if (!reply) throw new Error('reply missing');
      await saveMessage(client, id, withEditedTexts(reply, ['Edited by the probe.']), first.id);
      const after = (await getChat(client, id)).chat.history?.messages[first.id];
      if (textOf(after) !== 'Edited by the probe.') throw new Error(`reads back "${textOf(after).slice(0, 40)}"`);
      return reply.output?.length ? 'structured output edited, steps kept' : 'content edited, earlier text kept';
    });

    let copyId = '';
    await check('save an edit as a copy (a new version that shows)', async () => {
      const history = (await getChat(client, id)).chat.history;
      if (!history) throw new Error('history missing');
      const { copy, parent } = replyCopy(history, first.id, ['1, 2, 3'], { newId: uuidv4() });
      copyId = copy.id;
      await saveMessages(client, id, parent ? [parent, copy] : [copy], copy.id);
      const after = (await getChat(client, id)).chat.history;
      if (after?.currentId !== copy.id) throw new Error('the copy is not the shown version');
      if (!after.messages[turn.userMessage.id]?.childrenIds.includes(copy.id)) throw new Error('the copy is not under the question');
      if (textOf(after.messages[copy.id]) !== '1, 2, 3') throw new Error('the copy text differs');
      return '2 versions; the copy shows';
    });

    if (copyId) {
      await check('continue the copy where it stopped', async () => {
        const history = (await getChat(client, id)).chat.history;
        if (!history) throw new Error('history missing');
        const continued = buildContinueTurn({ history, messageId: copyId });
        replies.set(copyId, continued.replies[0] as HistoryMessage);
        await startCompletion(client, buildCompletionRequest({ ...base, turn: continued, chatId: id, continueMessageId: copyId }));
        const local = await waitDone(copyId);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const after = (await getChat(client, id)).chat.history;
        const server = after?.messages[copyId];
        if (!textOf(server).startsWith('1, 2, 3')) throw new Error(`the earlier text is gone ("${textOf(server).slice(0, 30)}")`);
        if (after?.messages[turn.userMessage.id]?.childrenIds.length !== 2) throw new Error('continuing made a new version');
        if (textOf(local) !== textOf(server)) throw new Error('the streamed text differs from the saved one');
        return `kept "1, 2, 3", now ${textOf(server).length} chars, same version`;
      });
    }

    await check('rate a reply: filed with evaluations, then detailed', async () => {
      const chat = await getChat(client, id);
      const history = chat.chat.history;
      const reply = history?.messages[first.id];
      if (!history || !reply) throw new Error('reply missing');
      const annotation = { rating: 1 as const };
      const created = await createFeedback(client, ratingFeedback({ history, message: reply, annotation, chatId: id, chat, models }));
      feedbackId = created.id;
      if (!feedbackId) throw new Error('no feedback id');
      const detailed = { ...annotation, reason: 'accurate_information', comment: 'probe', details: { rating: 8 } };
      const updated = await updateFeedback(client, feedbackId, ratingFeedback({ history, message: reply, annotation: detailed, chatId: id, chat, models }));
      const data = (updated as { data?: { reason?: string; details?: { rating?: number } } }).data;
      if (data?.reason !== 'accurate_information' || data.details?.rating !== 8) throw new Error('the details did not stick');
      await saveMessage(client, id, { ...reply, annotation: detailed, feedbackId }, history.currentId);
      const saved = (await getChat(client, id)).chat.history?.messages[first.id];
      if ((saved?.annotation as { rating?: number } | undefined)?.rating !== 1 || saved?.feedbackId !== feedbackId) throw new Error('the reply lost its rating');
      fixture.feedback = Object.keys(updated).sort();
      return 'filed, detailed (8/10, a reason), kept on the reply';
    });

    await check("list the model's action buttons", async () => {
      const actions = modelActions(model);
      fixture.actions = actions.length;
      return actions.length ? `${actions.length}: ${actions.map((action) => action.name ?? action.id).join(', ')}` : 'none on this model (nothing to run)';
    });
    return { steps, fixture };
  } finally {
    socket.close();
    if (feedbackId) await client.delete(`/api/v1/evaluations/feedback/${encodeURIComponent(feedbackId)}`).catch(() => undefined);
    if (chatId) {
      if (input.canDelete) await deleteChat(client, chatId).catch(() => undefined);
      else await toggleArchived(client, chatId).catch(() => undefined);
    }
  }
}
