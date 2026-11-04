import {
  applyMessageEvent,
  askUserQuestions,
  buildCompletionRequest,
  buildTurn,
  chatFeatures,
  deleteChat,
  getChat,
  listModels,
  listPrompts,
  openSocketSession,
  outputText,
  pendingAskUser,
  requestParams,
  resolveToolCall,
  searchKnowledgeBases,
  searchKnowledgeFiles,
  startCompletion,
  templateVariables,
  toggleArchived,
  type AskUserAnswer,
  type Capabilities,
  type ChatHistory,
  type HistoryMessage,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

interface A5Input {
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
 * Milestone 2 slice A5 against a live server, in the test account: the model asked to put a
 * question to you with its `ask_user` tool; the question answered the way the app answers it
 * (saved in the reply and resolved, or asked live over the socket), and the reply carrying on
 * with the answer. Also reads the saved prompts the `/` menu lists. The chat is deleted, or archived.
 */
export async function probeA5(input: A5Input): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
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

  await check('saved prompts for the / menu', async () => {
    const prompts = await listPrompts(client);
    fixture.prompts = { count: prompts.length, withVariables: prompts.filter((prompt) => /{{\s*[^}]+}}/.test(prompt.content)).length };
    return `${prompts.length} visible to this account (${String((fixture.prompts as { withVariables: number }).withVariables)} with variables)`;
  });

  await check('knowledge and files for the @ and # menus (read only)', async () => {
    const [bases, files] = await Promise.all([searchKnowledgeBases(client, ''), searchKnowledgeFiles(client, '')]);
    fixture.knowledge = { bases: bases.length, files: files.length };
    return `${bases.length} knowledge bases and ${files.length} files visible to this account`;
  });

  const models = await listModels(client);
  const model = models.find((item) => item.id === input.modelId) ?? models[0];
  if (!model) return { steps: [...steps, { name: 'A5', ok: false, note: 'no model visible' }], fixture };

  const socket = openSocketSession({
    baseUrl: input.baseUrl,
    token: input.token,
    expectedUserId: input.userId,
    websocketOnly: input.capabilities.websocketOnly,
    heartbeatIntervalSec: input.capabilities.heartbeatIntervalSec,
  });
  let reply: HistoryMessage | null = null;
  let liveQuestions = 0;
  // After answering, only the reply's end counts (its question is still in our copy until the server says otherwise).
  let resumed = false;
  let wake: () => void = () => undefined;
  socket.onChatEvent((event, answer) => {
    if (event.data.type === 'request:user_input') {
      // The live path: answered as the app answers it, with the first (recommended) option.
      const data = (event.data.data ?? {}) as { questions?: unknown; allow_other?: boolean };
      const questions = askUserQuestions(data.questions, data.allow_other !== false);
      liveQuestions += 1;
      const answers: Record<string, AskUserAnswer> = {};
      for (const question of questions) {
        const first = question.options[0];
        if (first) answers[question.id] = { type: 'option', option_index: 0, label: first.label, description: first.description };
      }
      answer?.({ status: 'answered', answers });
      return;
    }
    if (answer) answer({ error: 'unsupported in probe' });
    if (!reply || event.message_id !== reply.id) return;
    reply = applyMessageEvent(reply, event.data.type, event.data.data);
    if (reply.done || (!resumed && pendingAskUser(reply))) wake();
  });
  const settle = () =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no answer within 3 minutes')), 180_000);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  let chatId: string | undefined;
  try {
    await socket.joined;
    await check("the model's ask_user question, answered as the app does, and the reply carries on", async () => {
      const turn = buildTurn({
        history: { messages: {}, currentId: null },
        content:
          'APP PROBE: Before answering, call your ask_user tool exactly once with one question: which colour do I prefer, with the options "Teal" and "Orange". Then reply with only the colour I chose.',
        models: [model],
      });
      reply = turn.replies[0] as HistoryMessage;
      const waiting = settle();
      const body = buildCompletionRequest({
        turn,
        chatId: null,
        sessionId: socket.sessionId ?? '',
        model,
        params: requestParams(undefined, {}),
        features: chatFeatures(input.capabilities, {}, false),
        variables: templateVariables({ name: input.userName }),
        tasks: { title: false, tags: false, followUps: false },
      });
      chatId = (await startCompletion(client, body)).chat_id;
      await waiting;
      const id = chatId;
      const current = reply as HistoryMessage;
      const pending = pendingAskUser(current);
      if (pending) {
        // The saved path: the question waits in the reply until resolved.
        fixture.path = 'saved';
        fixture.questions = pending.questions.map((question) => ({ options: question.options.length, allowOther: question.allowOther, header: Boolean(question.header) }));
        const first = pending.questions[0]!.options[0]!;
        const answers: Record<string, AskUserAnswer> = { [pending.questions[0]!.id]: { type: 'option', option_index: 0, label: first.label, description: first.description } };
        resumed = true;
        const again = settle();
        const resolved = await resolveToolCall(client, id, current.id, pending.callId, 'answer', { answers });
        fixture.resolveKeys = Object.keys(resolved).sort();
        await again;
        // The saved copy can trail the last event by a moment.
        let final: HistoryMessage | undefined;
        for (let tries = 0; tries < 10; tries += 1) {
          final = ((await getChat(client, id)).chat.history as ChatHistory).messages[current.id];
          if (final?.done && textOf(final)) break;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        fixture.finalOutput = (Array.isArray(final?.output) ? final.output : []).map((item) => `${String((item as { type?: string }).type)}:${String((item as { status?: string }).status ?? '')}`);
        if (!new RegExp(first.label, 'i').test(textOf(final ?? current))) throw new Error(`the reply after answering reads "${textOf(final ?? current).slice(0, 40)}"`);
        if (pendingAskUser(final)) throw new Error('the question still shows as waiting');
        return `the question waited in the reply (${pending.questions[0]!.options.length} options); answered "${first.label}" with resolve, and the reply named it`;
      }
      if (liveQuestions > 0) {
        fixture.path = 'live';
        if (!/teal/i.test(textOf(current))) throw new Error(`the reply after the live answer reads "${textOf(current).slice(0, 40)}"`);
        return 'the question came live over the socket; answered "Teal", and the reply named it';
      }
      fixture.path = 'none';
      // The scratch servers' echo model can't call tools: it only says back what it was sent.
      if (textOf(current).startsWith('Echo:')) return 'skipped: the scratch echo model can’t ask (a real model is needed)';
      throw new Error(`the model asked nothing (it replied "${textOf(current).slice(0, 40)}")`);
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
