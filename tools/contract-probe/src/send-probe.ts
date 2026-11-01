import {
  applyMessageEvent,
  buildCompletionRequest,
  buildTurn,
  chatFeatures,
  deleteChat,
  getChat,
  listModels,
  openSocketSession,
  outputText,
  startCompletion,
  templateVariables,
  toggleArchived,
  type Capabilities,
  type ChatEventEnvelope,
  type HistoryMessage,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

interface SendProbeInput {
  client: OwuiClient;
  baseUrl: string;
  token: string;
  userId: string;
  userName: string;
  capabilities: Capabilities;
  canDelete: boolean;
  /** Model to use; defaults to the first one the account can see. */
  modelId?: string;
}

export interface SendProbeReport {
  steps: WriteStep[];
  /** Shapes only: event type counts and which fields converged, never content. */
  fixture: Record<string, unknown>;
}

/**
 * Sends one short prompt as a new chat exactly as the app does, reduces every
 * streamed event, then checks the result converges with what the server saved.
 * The chat is deleted afterwards, or archived when the account may not delete.
 */
export async function probeSend(input: SendProbeInput): Promise<SendProbeReport> {
  const { client } = input;
  const steps: WriteStep[] = [];
  const eventCounts: Record<string, number> = {};
  const chatLevel: string[] = [];
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
  if (!model) return { steps: [{ name: 'send', ok: false, note: 'no model visible' }], fixture: {} };

  const socket = openSocketSession({
    baseUrl: input.baseUrl,
    token: input.token,
    expectedUserId: input.userId,
    websocketOnly: input.capabilities.websocketOnly,
    heartbeatIntervalSec: input.capabilities.heartbeatIntervalSec,
  });

  let chatId: string | undefined;
  let reply: HistoryMessage | undefined;
  let title: string | undefined;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  try {
    await socket.joined;
    const turn = buildTurn({
      history: { messages: {}, currentId: null },
      content: 'Reply with exactly one word: pong',
      models: [model],
    });
    reply = turn.replies[0];
    const replyId = reply?.id;

    socket.onChatEvent((event: ChatEventEnvelope, answer) => {
      const type = event.data.type;
      if (event.message_id !== replyId) return;
      eventCounts[type] = (eventCounts[type] ?? 0) + 1;
      if (answer) answer({ error: 'unsupported in probe' });
      if (type === 'chat:title' && typeof event.data.data === 'string') title = event.data.data;
      if (['chat:title', 'chat:tags', 'chat:active', 'chat:list'].includes(type)) {
        chatLevel.push(type);
        return;
      }
      if (reply) reply = applyMessageEvent(reply, type, event.data.data);
      if (reply?.done) resolveDone();
    });

    const sent = await check(`send a new chat to ${model.id}`, async () => {
      const body = buildCompletionRequest({
        turn,
        chatId: null,
        sessionId: socket.sessionId ?? '',
        model,
        features: chatFeatures(input.capabilities, {}, false),
        variables: templateVariables({ name: input.userName }),
        tasks: {},
      });
      const started = await startCompletion(client, body);
      if (!started.status || !started.chat_id) throw new Error(`unexpected answer: ${JSON.stringify(Object.keys(started))}`);
      chatId = started.chat_id;
      return `chat created, ${started.task_ids?.length ?? 0} task(s)`;
    });
    if (!sent || !chatId) return { steps, fixture: { eventCounts } };

    await check('reply streams to done over the socket', async () => {
      await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error('no done within 90 s')), 90_000))]);
      return `${Object.values(eventCounts).reduce((a, b) => a + b, 0)} events`;
    });

    // Title and follow-ups arrive shortly after the reply.
    await new Promise((resolve) => setTimeout(resolve, 6000));

    await check('reduced reply matches what the server saved', async () => {
      const saved = await getChat(client, chatId as string);
      const savedReply = reply ? saved.chat.history?.messages[reply.id] : undefined;
      if (!reply || !savedReply) throw new Error('reply missing on the server');
      const local = (outputText(reply.output) || reply.content).trim();
      const server = (outputText(savedReply.output) || savedReply.content).trim();
      if (local !== server) throw new Error(`text differs (local ${local.length} chars, server ${server.length} chars)`);
      const types = (message: HistoryMessage) => (message.output ?? []).map((item) => item.type).join(',');
      if (types(reply) !== types(savedReply)) throw new Error(`output differs: local [${types(reply)}] server [${types(savedReply)}]`);
      if (savedReply.done !== true) throw new Error('server copy not marked done');
      return `text and ${reply.output?.length ?? 0} output item(s) identical`;
    });

    await check('title arrives live', async () => {
      if (!title) throw new Error('no chat:title event');
      return 'chat:title received';
    });
  } finally {
    socket.close();
    if (chatId) {
      const id = chatId;
      await (input.canDelete ? deleteChat(client, id) : toggleArchived(client, id)).catch(() => {});
    }
  }

  return {
    steps,
    fixture: {
      eventCounts: Object.fromEntries(Object.entries(eventCounts).sort(([a], [b]) => a.localeCompare(b))),
      chatLevelEvents: [...new Set(chatLevel)].sort(),
      replyFields: reply ? Object.keys(reply).sort() : [],
      outputItemTypes: (reply?.output ?? []).map((item) => item.type),
    },
  };
}
