import {
  createChat,
  createFolder,
  deleteChat,
  deleteFolder,
  folderChatsForExport,
  getChat,
  getFolder,
  listFolderChats,
  listFolders,
  markFolderRead,
  moveChatToFolder,
  toggleArchived,
  updateAccess,
  updateFolder,
  uuidv4,
  type Capabilities,
  type ChatRecord,
  type FolderDetail,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import { shapeOf } from './shape';
import type { WriteStep } from './write-probe';

interface FoldersInput {
  client: OwuiClient;
  capabilities: Capabilities;
  canDelete: boolean;
}

/**
 * Folders in the test account, with no model calls: an "APP PROBE:" folder made with settings
 * and read back; renamed and changed, with the keys left out kept (the server merges `data` and
 * `meta`); its icon set (an emoji's short name, in the folder list too) and taken off; a folder
 * made inside it, holding a probe chat; marked read; exported (the inner
 * folder's chat comes too); its sharing saved empty; then deleted keeping its chats, and the
 * chat checked to be out of any folder. The chat is deleted, or archived where the account may
 * not delete chats (and then moved out before the folder goes, since the server refuses to
 * delete a folder holding chats for such an account). Folders it made are deleted whatever happens.
 */
export async function probeFolders(input: FoldersInput): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const { client, capabilities, canDelete } = input;
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

  if (!capabilities.feature('folders')) {
    steps.push({ name: 'folders', ok: true, note: 'folders are off for this account; nothing to try' });
    return { steps, fixture };
  }

  const tag = uuidv4().slice(0, 6);
  let top: FolderDetail | null = null;
  let inner: FolderDetail | null = null;
  let chat: ChatRecord | null = null;
  try {
    await check('a folder made with settings, and read back', async () => {
      top = await createFolder(client, { name: `APP PROBE: folder ${tag}`, data: { system_prompt: 'APP PROBE', model_ids: [] }, meta: { background_image_url: null } });
      const read = await getFolder(client, top.id);
      fixture.folder = shapeOf(read);
      if (read.data?.system_prompt !== 'APP PROBE') throw new Error('the system prompt was not kept');
      if (!Array.isArray(read.access_grants)) throw new Error('the folder came without access_grants');
      return `made; data keys ${Object.keys(read.data ?? {}).sort().join(', ')}`;
    });
    const topId = (top as FolderDetail | null)?.id;
    if (!topId) return { steps, fixture };

    await check('renamed and changed: the keys left out stay', async () => {
      const name = `APP PROBE: renamed ${tag}`;
      await updateFolder(client, topId, { name, data: { description: 'APP PROBE' } });
      const read = await getFolder(client, topId);
      if (read.name !== name) throw new Error('the name did not change');
      if (read.data?.system_prompt !== 'APP PROBE' || read.data?.description !== 'APP PROBE') throw new Error('data was replaced, not merged');
      if (!read.meta || !('background_image_url' in read.meta)) throw new Error('meta lost its key');
      return 'merged';
    });

    await check('its icon: an emoji’s short name, in the folder list too; taken off with empty', async () => {
      await updateFolder(client, topId, { meta: { icon: 'tada' } });
      const read = await getFolder(client, topId);
      const listed = (await listFolders(client)).find((item) => item.id === topId);
      fixture.icon = { read: read.meta?.icon === 'tada', listed: listed?.meta?.icon === 'tada', otherMetaKept: Boolean(read.meta && 'background_image_url' in read.meta) };
      if (read.meta?.icon !== 'tada') throw new Error('the icon wasn’t kept');
      if (listed?.meta?.icon !== 'tada') throw new Error('the folder list didn’t carry the icon');
      if (!read.meta || !('background_image_url' in read.meta)) throw new Error('setting the icon dropped another meta key');
      await updateFolder(client, topId, { meta: { icon: '' } });
      if ((await getFolder(client, topId)).meta?.icon) throw new Error('the icon stayed');
      return 'kept, listed with the folder, other meta kept; taken off';
    });

    await check('a folder made inside it, holding a probe chat', async () => {
      inner = await createFolder(client, { name: `APP PROBE: inner ${tag}`, parentId: topId });
      const listed = await listFolders(client);
      if (listed.find((item) => item.id === inner?.id)?.parent_id !== topId) throw new Error('the list does not show it inside');
      const user = uuidv4();
      const reply = uuidv4();
      const now = Math.floor(Date.now() / 1000);
      chat = await createChat(client, {
        title: 'APP PROBE: folders',
        models: [],
        history: {
          currentId: reply,
          messages: {
            [user]: { id: user, parentId: null, childrenIds: [reply], role: 'user', content: 'What is the capital of Malaysia?', timestamp: now },
            [reply]: { id: reply, parentId: user, childrenIds: [], role: 'assistant', content: 'Kuala Lumpur.', done: true, timestamp: now },
          },
        },
        messages: [],
        tags: [],
        timestamp: Date.now(),
      });
      await moveChatToFolder(client, chat.id, inner.id);
      const inInner = await listFolderChats(client, inner.id);
      const inTop = await listFolderChats(client, topId);
      if (!inInner.some((item) => item.id === chat?.id)) throw new Error('the inner folder does not list the chat');
      if (inTop.some((item) => item.id === chat?.id)) throw new Error('the outer folder lists the inner folder’s chat');
      return 'listed in the inner folder only';
    });

    await check('marked read, the folders inside it too', async () => {
      const answer = (await markFolderRead(client, topId)) as { folder_ids?: unknown; updated_count?: unknown };
      fixture.read = shapeOf(answer);
      const ids = Array.isArray(answer.folder_ids) ? answer.folder_ids : [];
      if (inner && !ids.includes((inner as FolderDetail).id)) throw new Error('the inner folder was not included');
      return `${ids.length} folders, ${typeof answer.updated_count === 'number' ? answer.updated_count : '?'} chats updated`;
    });

    await check('exported: whole chats, the inner folder’s too', async () => {
      const chats = await folderChatsForExport(client, topId);
      if (!chats.some((item) => item.id === chat?.id)) throw new Error('the export left out the inner folder’s chat');
      if (!chats.every((item) => typeof item.chat === 'object' && item.chat !== null)) throw new Error('the export came without whole chats');
      return `${chats.length} chat(s)`;
    });

    await check('its sharing saved empty', async () => {
      const kept = await updateAccess(client, 'folders', topId, []);
      if (kept.length) throw new Error(`the server kept ${kept.length} grant(s)`);
      return 'no grants';
    });

    await check(canDelete ? 'deleted keeping its chats: the chat comes out' : 'deleted once empty (this account may not delete chats)', async () => {
      const chatId = (chat as ChatRecord | null)?.id;
      if (!canDelete && chatId) await moveChatToFolder(client, chatId, null);
      await deleteFolder(client, topId, { deleteContents: false });
      const listed = await listFolders(client);
      if (listed.some((item) => item.id === topId || item.id === (inner as FolderDetail | null)?.id)) throw new Error('a probe folder is still listed');
      top = null;
      inner = null;
      if (chatId) {
        const after = await getChat(client, chatId);
        if (after.folder_id) throw new Error('the chat is still in a folder');
      }
      return 'both folders gone, the chat kept outside';
    });
  } finally {
    const chatId = (chat as ChatRecord | null)?.id;
    const leftover = (top as FolderDetail | null)?.id;
    if (chatId && leftover && !canDelete) await moveChatToFolder(client, chatId, null).catch(() => undefined);
    if (leftover) await deleteFolder(client, leftover, { deleteContents: false }).catch(() => undefined);
    if (chatId) {
      if (canDelete) await deleteChat(client, chatId).catch(() => undefined);
      else await toggleArchived(client, chatId).catch(() => undefined);
    }
  }
  return { steps, fixture };
}
