import {
  createChat,
  createFolder,
  deleteChat,
  deleteFolder,
  getChat,
  getFolder,
  getUserInfo,
  listChats,
  listFolderChatsForAll,
  listSharedFolders,
  moveChatToFolder,
  updateAccess,
  uuidv4,
  type ChatDocument,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

interface SharedFoldersInput {
  /** The folder's owner (the probe's own account). */
  owner: OwuiClient;
  ownerId: string;
  /** Another account on the same server, which the folder is shared with. */
  peer: OwuiClient;
  peerId: string;
}

const probeChat = (title: string, question: string): ChatDocument => {
  const user = uuidv4();
  const reply = uuidv4();
  const now = Math.floor(Date.now() / 1000);
  return {
    title,
    models: [],
    history: {
      currentId: reply,
      messages: {
        [user]: { id: user, parentId: null, childrenIds: [reply], role: 'user', content: question, timestamp: now },
        [reply]: { id: reply, parentId: user, childrenIds: [], role: 'assistant', content: 'APP PROBE answer.', done: true, timestamp: now },
      },
    },
    messages: [],
    tags: [],
  };
};

/**
 * Folder sharing between two accounts, with no model calls: the owner's "APP PROBE:" folder,
 * holding a chat of the owner's, shared with the peer to read: the peer finds it among the folders
 * shared with them (whose, read), its chats with the owner's marked read-only, opens the chat and
 * the folder, and reads the owner's name. Then shared to write: the peer moves a chat of their own
 * into it, and the owner sees it among the folder's chats (read-only for the owner). Both chats and
 * the folder are deleted after, whatever happens.
 */
export async function probeSharedFolders(input: SharedFoldersInput): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const { owner, peer } = input;
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };
  const tag = uuidv4().slice(0, 6);
  let folderId: string | null = null;
  let ownerChat: string | null = null;
  let peerChat: string | null = null;
  try {
    await check('the owner’s folder, with a chat in it, shared with the peer to read', async () => {
      folderId = (await createFolder(owner, { name: `APP PROBE: shared ${tag}` })).id;
      ownerChat = (await createChat(owner, probeChat('APP PROBE: owner’s chat', 'Owner question'))).id;
      await moveChatToFolder(owner, ownerChat, folderId);
      const kept = await updateAccess(owner, 'folders', folderId, [{ principal_type: 'user', principal_id: input.peerId, permission: 'read' }]);
      if (!kept.length) throw new Error('the sharing wasn’t kept');
      return 'made, holding the owner’s chat, shared to read';
    });
    const id = (): string => {
      if (!folderId) throw new Error('no probe folder');
      return folderId;
    };

    await check('the peer finds it shared with them (whose, to read), its chats read-only, the chat and folder open', async () => {
      const shared = (await listSharedFolders(peer)).find((folder) => folder.id === id());
      const page = await listFolderChatsForAll(peer, id());
      const theirs = page.chats.find((chat) => chat.id === ownerChat);
      const opened = await getChat(peer, ownerChat ?? '');
      const folder = await getFolder(peer, id());
      const ownerName = (await getUserInfo(peer, input.ownerId)).name;
      fixture.read = { listed: Boolean(shared), permission: shared?.permission, ownerNamed: Boolean(shared?.owner_name), chats: page.chats.length, readonly: theirs?.readonly, folderPermission: page.permission, opened: opened.id === ownerChat, ownerInfo: Boolean(ownerName) };
      if (!shared) throw new Error('the folder wasn’t among those shared with the peer');
      if (shared.permission !== 'read' || !shared.owner_name) throw new Error(`listed as ${shared.permission}, owner named ${Boolean(shared.owner_name)}`);
      if (!theirs || theirs.readonly !== true || theirs.owner_name !== shared.owner_name) throw new Error('the owner’s chat wasn’t listed read-only with its owner');
      if (page.permission !== 'read') throw new Error(`the folder’s chats said ${page.permission}`);
      if (opened.user_id !== input.ownerId) throw new Error('the chat didn’t open as the owner’s');
      if (folder.id !== id()) throw new Error('the folder didn’t open');
      if (!ownerName) throw new Error('the owner’s name couldn’t be read');
      return 'listed (read, with the owner’s name); the owner’s chat read-only; the chat, the folder and the owner’s name open';
    });

    await check('shared to write: the peer’s chat moved in, and the owner sees it (read-only for them)', async () => {
      await updateAccess(owner, 'folders', id(), [{ principal_type: 'user', principal_id: input.peerId, permission: 'write' }]);
      const shared = (await listSharedFolders(peer)).find((folder) => folder.id === id());
      peerChat = (await createChat(peer, probeChat('APP PROBE: peer’s chat', 'Peer question'))).id;
      await moveChatToFolder(peer, peerChat, id());
      const ownerView = await listFolderChatsForAll(owner, id());
      const peers = ownerView.chats.find((chat) => chat.id === peerChat);
      const ownerList = await listChats(owner, 1);
      fixture.write = { permission: shared?.permission, ownerSeesPeerChat: Boolean(peers), readonlyForOwner: peers?.readonly, ownerPermission: ownerView.permission, inOwnersChatList: ownerList.some((chat) => chat.id === peerChat) };
      if (shared?.permission !== 'write') throw new Error(`the peer’s permission read ${shared?.permission}`);
      if (!peers || peers.readonly !== true) throw new Error('the owner didn’t see the peer’s chat read-only');
      if (ownerView.permission !== 'write') throw new Error('the owner’s permission didn’t read write');
      return 'the peer may write; their chat in the folder shows to the owner, read-only for the owner';
    });
  } finally {
    if (peerChat) await deleteChat(peer, peerChat).catch(() => undefined);
    if (ownerChat) await deleteChat(owner, ownerChat).catch(() => undefined);
    if (folderId) {
      await updateAccess(owner, 'folders', folderId, []).catch(() => undefined);
      await deleteFolder(owner, folderId, { deleteContents: true }).catch(() => undefined);
    }
  }
  await check('the probe folder and chats are gone', async () => {
    const left = folderId ? await getFolder(owner, folderId).then(() => true, () => false) : false;
    if (left) throw new Error('the probe folder is still there');
    return 'gone';
  });
  return { steps, fixture };
}
