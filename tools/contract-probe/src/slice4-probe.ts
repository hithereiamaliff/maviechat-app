import {
  createChat,
  deleteChat,
  generateTitle,
  getChat,
  listArchivedChats,
  listChats,
  listFolderChats,
  listFolders,
  listModels,
  markChatUnread,
  moveChatToFolder,
  openSocketSession,
  OwuiHttpError,
  titleMessages,
  toggleArchived,
  type Capabilities,
  type HistoryMessage,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

interface Slice4Input {
  client: OwuiClient;
  baseUrl: string;
  token: string;
  userId: string;
  capabilities: Capabilities;
  canDelete: boolean;
  modelId?: string;
}

const TITLE = 'APP PROBE: slice 4';

/**
 * Milestone 1 slice 4 against a live server, in the test account, on a chat created without
 * a model call: unread and read markers, the archived list, moving to a folder (when the
 * account may use folders) and title generation. The chat is removed afterwards.
 */
export async function probeSlice4(input: Slice4Input): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const { client } = input;
  const steps: WriteStep[] = [];
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };
  const row = async (id: string) => (await listChats(client, 1)).find((chat) => chat.id === id);

  const models = await listModels(client);
  const model = models.find((item) => item.id === input.modelId) ?? models[0];
  const now = Math.floor(Date.now() / 1000);
  const ids = { user: crypto.randomUUID(), reply: crypto.randomUUID() };
  const messages: Record<string, HistoryMessage> = {
    [ids.user]: { id: ids.user, parentId: null, childrenIds: [ids.reply], role: 'user', content: 'Ideas for a weekend food trip in Penang?', timestamp: now },
    [ids.reply]: {
      id: ids.reply,
      parentId: ids.user,
      childrenIds: [],
      role: 'assistant',
      content: 'Try char kway teow on Lorong Selamat, laksa in Air Itam and cendol on Penang Road.',
      timestamp: now,
      done: true,
      model: model?.id ?? 'app-probe',
    },
  };

  let chatId: string | undefined;
  try {
    const created = await createChat(client, {
      title: TITLE,
      models: [model?.id ?? 'app-probe'],
      history: { currentId: ids.reply, messages },
      messages: [],
      tags: [],
      timestamp: now * 1000,
    });
    chatId = created.id;
    const id = created.id;

    await check('mark as unread brings the dot back', async () => {
      await markChatUnread(client, id);
      const chat = await row(id);
      if (!chat) throw new Error('not in the chat list');
      if (chat.last_read_at !== 0) throw new Error(`read time ${String(chat.last_read_at)}`);
      return 'read time 0, so the web and the app show it unread';
    });

    await check('reading over the socket clears it', async () => {
      const socket = openSocketSession({
        baseUrl: input.baseUrl,
        token: input.token,
        expectedUserId: input.userId,
        websocketOnly: input.capabilities.websocketOnly,
        heartbeatIntervalSec: input.capabilities.heartbeatIntervalSec,
      });
      try {
        const answered = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('no chat:list answer within 10 s')), 10_000);
          socket.onChatEvent((event) => {
            if (event.chat_id === id && event.data.type === 'chat:list') {
              clearTimeout(timer);
              resolve();
            }
          });
        });
        socket.markRead(id);
        await socket.joined;
        await answered;
      } finally {
        socket.close();
      }
      const chat = await row(id);
      if (!chat?.last_read_at || chat.updated_at > chat.last_read_at) throw new Error('still unread');
      return 'the server answered with chat:list and the chat reads as read';
    });

    await check('archived list finds it, unarchive brings it back', async () => {
      await toggleArchived(client, id);
      const archived = await listArchivedChats(client, 1, TITLE);
      if (!archived.some((chat) => chat.id === id)) throw new Error('not in the archived list');
      if (await row(id)) throw new Error('still in the chat list');
      await toggleArchived(client, id);
      if ((await listArchivedChats(client, 1, TITLE)).some((chat) => chat.id === id)) throw new Error('still archived');
      if (!(await row(id))) throw new Error('not back in the chat list');
      return `found among ${archived.length} by title search; back in the list`;
    });

    if (input.capabilities.feature('folders')) {
      await check('move to a folder and back', async () => {
        const folder = (await listFolders(client))[0];
        if (!folder) return 'skipped: the account has no folder';
        await moveChatToFolder(client, id, folder.id);
        if (!(await listFolderChats(client, folder.id)).some((chat) => chat.id === id)) throw new Error('not in the folder');
        await moveChatToFolder(client, id, null);
        if ((await getChat(client, id)).folder_id) throw new Error('still in a folder');
        return 'moved in and out';
      });
    } else {
      steps.push({ name: 'move to a folder and back', ok: true, note: 'skipped: folders are off for this account' });
    }

    await check('generate a title', async () => {
      if (!model) throw new Error('no model visible');
      try {
        const title = await generateTitle(client, { model: model.id, messages: titleMessages(Object.values(messages)), chatId: id });
        return `got a title (${title.length} characters)`;
      } catch (error) {
        if (error instanceof Error && /disabled/i.test(error.message)) return 'title generation is turned off on this server';
        throw error instanceof OwuiHttpError ? new Error(`HTTP ${error.status}: ${error.detail ?? ''}`) : error;
      }
    });
  } catch (error) {
    steps.push({ name: 'create the probe chat', ok: false, note: error instanceof Error ? error.message : String(error) });
  } finally {
    if (chatId) {
      const id = chatId;
      await (input.canDelete ? deleteChat(client, id) : getChat(client, id).then((chat) => (chat.archived ? null : toggleArchived(client, id)))).catch(() => {});
    }
  }
  return { steps, fixture: { steps: Object.fromEntries(steps.map((step) => [step.name, step.ok])) } };
}
