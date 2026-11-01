import {
  applyMessageEvent,
  branchPath,
  buildCompletionRequest,
  buildRegenerateTurn,
  buildTurn,
  chatFeatures,
  deleteChat,
  deleteFile,
  deleteMessage,
  fileItemFromUpload,
  getChat,
  listModels,
  openSocketSession,
  outputText,
  requestFiles,
  saveMessage,
  startCompletion,
  templateVariables,
  temporaryChatId,
  temporaryChatMessages,
  toggleArchived,
  uploadFile,
  waitForProcessing,
  type Capabilities,
  type HistoryMessage,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

interface Slice3Input {
  client: OwuiClient;
  baseUrl: string;
  token: string;
  userId: string;
  userName: string;
  capabilities: Capabilities;
  canDelete: boolean;
  modelId?: string;
}

// A 1×1 PNG.
const PIXEL = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
  (char) => char.charCodeAt(0),
);

/**
 * Milestone 1 slice 3 against a live server, in the test account: a document the model must
 * read, a photo upload, regenerate with a variant, edit-in-place, delete (when permitted)
 * and a temporary chat that must leave nothing behind. Everything is cleaned up.
 */
export async function probeSlice3(input: Slice3Input): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const { client } = input;
  const steps: WriteStep[] = [];
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
  if (!model) return { steps: [{ name: 'slice 3', ok: false, note: 'no model visible' }], fixture: {} };

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

  const uploaded: string[] = [];
  let chatId: string | undefined;
  try {
    await socket.joined;
    base.sessionId = socket.sessionId ?? '';

    let docItem: ReturnType<typeof fileItemFromUpload> | undefined;
    await check('upload a document and wait for processing', async () => {
      const form = new FormData();
      form.append('file', new Blob(['The secret probe word is tangerine.'], { type: 'text/plain' }), 'probe-note.txt');
      const upload = await uploadFile(client, form, { process: true });
      uploaded.push(upload.id);
      const status = await waitForProcessing(client, upload.id, { timeoutMs: 90_000 });
      if (status !== 'completed') throw new Error(`processing ${status}`);
      docItem = fileItemFromUpload(upload, { name: 'probe-note.txt', size: 35, itemId: 'probe-doc' });
      return 'processed';
    });

    await check('upload a photo without processing and read it back', async () => {
      const form = new FormData();
      form.append('file', new Blob([PIXEL], { type: 'image/png' }), 'probe-pixel.png');
      const upload = await uploadFile(client, form, { process: false });
      uploaded.push(upload.id);
      const item = fileItemFromUpload(upload, { name: 'probe-pixel.png', size: PIXEL.length, itemId: 'probe-img' });
      if (!(item.content_type ?? '').startsWith('image/')) throw new Error(`content type ${item.content_type}`);
      const response = await fetch(`${input.baseUrl}/api/v1/files/${upload.id}/content`, { headers: { Authorization: `Bearer ${input.token}` } });
      if (!response.ok) throw new Error(`content HTTP ${response.status}`);
      return `${(await response.arrayBuffer()).byteLength} bytes back`;
    });

    if (!docItem) return { steps, fixture: {} };
    const turn = buildTurn({
      history: { messages: {}, currentId: null },
      content: 'What is the secret probe word in the attached file? Reply with just that word.',
      models: [model],
      files: [docItem],
    });
    const first = turn.replies[0] as HistoryMessage;
    replies.set(first.id, first);

    const answered = await check('the model reads the attached document', async () => {
      const started = await startCompletion(
        client,
        buildCompletionRequest({ ...base, turn, chatId: null, files: requestFiles([], turn.userMessage) }),
      );
      chatId = started.chat_id;
      const done = await waitDone(first.id);
      const text = outputText(done.output) || done.content;
      if (!/tangerine/i.test(text)) throw new Error(`answer did not contain the word (${text.length} chars)`);
      return 'answer contains the secret word';
    });
    if (!answered || !chatId) return { steps, fixture: {} };
    const id = chatId;

    await check('regenerate "More Concise" adds a second reply', async () => {
      const saved = await getChat(client, id);
      const history = saved.chat.history ?? { messages: {}, currentId: null };
      const regen = buildRegenerateTurn({ history, userMessageId: turn.userMessage.id, model });
      const reply = regen.replies[0] as HistoryMessage;
      replies.set(reply.id, reply);
      await startCompletion(client, buildCompletionRequest({ ...base, turn: regen, chatId: id, regenerationPrompt: 'More Concise' }));
      const local = await waitDone(reply.id);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const after = await getChat(client, id);
      const user = after.chat.history?.messages[turn.userMessage.id];
      if (user?.childrenIds.length !== 2) throw new Error(`user message has ${user?.childrenIds.length} replies`);
      const server = after.chat.history?.messages[reply.id];
      if ((outputText(server?.output) || server?.content || '').trim() !== (outputText(local.output) || local.content).trim()) {
        throw new Error('regenerated reply differs from the server copy');
      }
      return '2 replies, regenerated one identical to the server copy';
    });

    await check('edit a message in place without losing anything', async () => {
      const before = await getChat(client, id);
      const history = before.chat.history ?? { messages: {}, currentId: null };
      const original = history.messages[turn.userMessage.id] as HistoryMessage;
      await saveMessage(client, id, { ...original, content: `${original.content} (edited)` }, history.currentId);
      const after = await getChat(client, id);
      const edited = after.chat.history?.messages[original.id];
      if (!edited?.content.endsWith('(edited)')) throw new Error('content not saved');
      if (Object.keys(after.chat.history?.messages ?? {}).length !== Object.keys(history.messages).length) throw new Error('message count changed');
      if (edited.childrenIds.length !== 2) throw new Error('replies detached');
      return 'saved; messages and branches intact';
    });

    // The server checks only ownership here; the delete_message permission just hides the web's button.
    await check('delete one reply version', async () => {
      const before = await getChat(client, id);
      const user = before.chat.history?.messages[turn.userMessage.id];
      const victim = user?.childrenIds[1];
      if (!victim) throw new Error('no second reply');
      const answer = await deleteMessage(client, id, victim);
      const history = answer?.chat?.history;
      if (!history || history.messages[victim]) throw new Error('the answer still has it');
      if (history.messages[turn.userMessage.id]?.childrenIds.join() !== user?.childrenIds[0]) throw new Error('tree not repaired');
      if (!history.currentId || !history.messages[history.currentId]) throw new Error('no shown branch');
      const after = await getChat(client, id);
      if (after.chat.history?.messages[victim]) throw new Error('still saved');
      const permitted = input.capabilities.can('chat.delete_message', true) ? 'shown' : 'hidden';
      return `deleted; answer carries the repaired tree (button ${permitted} for this account)`;
    });

    await check('temporary chat streams and leaves nothing behind', async () => {
      const tempId = temporaryChatId(base.sessionId);
      const tempTurn = buildTurn({ history: { messages: {}, currentId: null }, content: 'Reply with exactly one word: kiwi', models: [model] });
      const reply = tempTurn.replies[0] as HistoryMessage;
      replies.set(reply.id, reply);
      const branch = branchPath(tempTurn.history, tempTurn.userMessage.id);
      await startCompletion(
        client,
        buildCompletionRequest({ ...base, turn: tempTurn, chatId: tempId, temporaryMessages: temporaryChatMessages(branch) }),
      );
      const done = await waitDone(reply.id);
      if (!/kiwi/i.test(outputText(done.output) || done.content)) throw new Error('unexpected answer');
      try {
        await getChat(client, tempId);
      } catch {
        return 'answered; not stored on the server';
      }
      throw new Error('the temporary chat was stored');
    });
  } finally {
    socket.close();
    if (chatId) await (input.canDelete ? deleteChat(client, chatId) : toggleArchived(client, chatId)).catch(() => {});
    for (const fileId of uploaded) await deleteFile(client, fileId).catch(() => {});
  }
  return { steps, fixture: { steps: Object.fromEntries(steps.map((step) => [step.name, step.ok])) } };
}
