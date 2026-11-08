import {
  buildCompletionRequest,
  buildTurn,
  chatVariablesForm,
  chatVariablesOf,
  createWorkspaceModel,
  deleteChat,
  deleteWorkspaceModel,
  getWorkspaceModel,
  listModels,
  saveChatVariables,
  type ModelItem,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

const ID = 'app-probe-vars';
const ECHO = 'app_probe_echo';
const SYSTEM = 'APP PROBE. Topic: {{chat.variables.topic | select:options=["alpha","beta"]:required}}. Note: {{chat.variables.note | textarea:placeholder="Anything"}}.';

type Tree = Record<string, unknown>;

/** The text of a non-streamed completion. */
function replyText(answer: unknown): string {
  const choices = (answer as { choices?: { message?: { content?: unknown } }[] } | null)?.choices;
  const content = choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
}

/**
 * Chat Variables the app's way, with a throwaway model whose system prompt asks for a topic (a
 * choice of two, required) and a note: its form as the server lists it; a saved chat keeping its
 * values, the rest of the chat as it was; and, where the scratch server has the echo model to
 * build it on, the model's instructions filled in from a temporary chat's values (sent with the
 * message), from a saved chat's (read by the server), and left empty for a value that isn't one of
 * its options. The chat and the model are deleted after.
 */
export async function probeChatVars({ client }: { client: OwuiClient }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };
  const echo = (await listModels(client)).some((model) => model.id === ECHO);
  fixture.echo = echo;
  let made = false;
  let chatId: string | null = null;
  try {
    await check('a model’s system prompt becomes its form', async () => {
      await createWorkspaceModel(client, { id: ID, baseModelId: echo ? ECHO : '', name: 'APP PROBE vars', meta: {}, params: { system: SYSTEM }, isActive: true });
      made = true;
      // Listed with the server's models where it has a base to run on; read from the Workspace otherwise.
      const listed = (await listModels(client)).find((model) => model.id === ID);
      const model: ModelItem = listed ?? { id: ID, name: 'APP PROBE vars', info: { meta: (await getWorkspaceModel(client, ID)).meta as Tree } };
      const form = chatVariablesForm([model], {});
      const topic = form.fields.find((field) => field.key === 'topic');
      const note = form.fields.find((field) => field.key === 'note');
      fixture.form = { listed: Boolean(listed), fields: form.fields.map((field) => `${field.key}:${field.type}${field.required ? ':required' : ''}`) };
      if (!topic || topic.type !== 'select' || topic.options.join() !== 'alpha,beta' || !topic.required) throw new Error('the topic field isn’t as written');
      if (!note || note.type !== 'textarea' || note.placeholder !== 'Anything' || note.required) throw new Error('the note field isn’t as written');
      if (!form.missing || !form.empty) throw new Error('an empty chat wouldn’t be asked first');
      return `topic (one of alpha, beta; required) and note (text, with its placeholder), ${listed ? 'from the model list' : 'from the Workspace (no base model here)'}; an empty chat is asked first`;
    });

    await check('a saved chat keeps its values; the rest of it as it was', async () => {
      const created = await client.post<{ id?: string; variables?: unknown }>('/api/v1/chats/new', {
        chat: { title: 'APP PROBE vars', models: [ID], history: { messages: {}, currentId: null }, messages: [], tags: [], timestamp: Date.now() },
        variables: { topic: 'alpha' },
      });
      chatId = created.id ?? null;
      if (!chatId) throw new Error('no chat');
      if (chatVariablesOf(created).topic !== 'alpha') throw new Error('not kept when the chat was made');
      const kept = await saveChatVariables(client, chatId, { topic: 'beta', note: 'n1' });
      const read = await client.get<{ title?: string; variables?: unknown }>(`/api/v1/chats/${encodeURIComponent(chatId)}`);
      if (kept.topic !== 'beta' || kept.note !== 'n1') throw new Error('the change wasn’t kept');
      if (chatVariablesOf(read).topic !== 'beta' || read.title !== 'APP PROBE vars') throw new Error('the chat read back differs');
      return 'kept when the chat was made, then changed; the title as it was';
    });

    if (!echo) {
      steps.push({ name: 'filled into the instructions', ok: true, note: 'skipped: no echo model on this server to build on' });
    } else {
      await check('a temporary chat’s values, sent with the message, fill the instructions', async () => {
        const text = replyText(await client.post<unknown>('/api/chat/completions', { model: ID, stream: false, messages: [{ role: 'user', content: 'APP PROBE vars' }], chat_variables: { topic: 'beta', note: 'n1' } }));
        if (!text.includes('Topic: beta.') || !text.includes('Note: n1.')) throw new Error('the instructions weren’t filled in');
        return 'Topic: beta, Note: n1 in what the model was sent';
      });

      await check('a saved chat’s values, read by the server, fill the instructions', async () => {
        if (!chatId) throw new Error('no chat');
        // As the app sends a saved chat's message (its own ids, no values), answered at once rather than over a socket.
        const model = { id: ID, name: 'APP PROBE vars' };
        const turn = buildTurn({ history: { messages: {}, currentId: null }, content: 'APP PROBE vars', models: [model] });
        const body = buildCompletionRequest({ turn, chatId, sessionId: '', model, stream: false, features: {}, variables: {}, tasks: { title: false, tags: false, followUps: false } });
        if ('chat_variables' in body) throw new Error('the app would send values for a saved chat');
        const text = replyText(await client.post<unknown>('/api/chat/completions', body));
        if (!text.includes('Topic: beta.') || !text.includes('Note: n1.')) throw new Error('the server didn’t use the chat’s values');
        return 'Topic: beta, Note: n1 from the chat';
      });

      await check('a value that isn’t one of its options leaves them all empty', async () => {
        const text = replyText(await client.post<unknown>('/api/chat/completions', { model: ID, stream: false, messages: [{ role: 'user', content: 'APP PROBE vars' }], chat_variables: { topic: 'gamma', note: 'n1' } }));
        if (!text.includes('Topic: .') || !text.includes('Note: .')) throw new Error('an unknown option was used');
        return 'both empty: the app offers only the options';
      });
    }
  } finally {
    if (chatId) await deleteChat(client, chatId).catch(() => undefined);
    if (made) await deleteWorkspaceModel(client, ID).catch(() => undefined);
  }

  await check('the chat and the model deleted', async () => {
    const left = (await listModels(client)).some((model) => model.id === ID) || (await getWorkspaceModel(client, ID).then(() => true, () => false));
    if (left) throw new Error('the model is still there');
    return 'none left';
  });

  return { steps, fixture };
}
