import {
  OwuiHttpError,
  addChatTag,
  chatJson,
  chatPlainText,
  cloneChat,
  cloneSharedChat,
  createChat,
  deleteChat,
  forkChat,
  getChat,
  getChatTags,
  getShareAccess,
  getSharedChat,
  listShareGroups,
  listTags,
  removeChatTag,
  searchChats,
  searchUsers,
  setShareAccess,
  shareChat,
  sharedChatUrl,
  shareVisibility,
  tagId,
  tagSearch,
  toggleArchived,
  unshareChat,
  uuidv4,
  withShareVisibility,
  withSharedWith,
  type Capabilities,
  type ChatRecord,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import { shapeOf } from './shape';
import type { WriteStep } from './write-probe';

interface A6Input {
  client: OwuiClient;
  baseUrl: string;
  userId: string;
  capabilities: Capabilities;
  canDelete: boolean;
}

/**
 * Milestone 2 slice A6 against a live server, in the test account, with no model calls: an
 * "APP PROBE:" chat made from a short history; a tag added, found by `tag:` search and removed;
 * the chat shared (opened by its link, who may open it set and read back, a public link refused
 * when the account may not make one, the link updated, a clone made from it, then deleted); the
 * chat cloned and forked; the text and JSON downloads built; people and groups to share with
 * listed. Every chat it made is deleted, or archived where the account can't delete.
 */
export async function probeA6(input: A6Input): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const { client, capabilities } = input;
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const made: string[] = [];
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
      return true;
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
      return false;
    }
  };

  const user = uuidv4();
  const reply = uuidv4();
  const now = Math.floor(Date.now() / 1000);
  let chat: ChatRecord | null = null;
  const tag = `APP PROBE ${uuidv4().slice(0, 6)}`;
  try {
    await check('a probe chat made from a history', async () => {
      chat = await createChat(client, {
        title: 'APP PROBE: A6',
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
      made.push(chat.id);
      return 'made';
    });
    const id = (chat as ChatRecord | null)?.id;
    if (!id) return { steps, fixture };

    await check('tag: add, list, search by tag:, remove', async () => {
      const added = await addChatTag(client, id, tag);
      if (!added.some((item) => item.id === tagId(tag) && item.name === tag)) throw new Error('the tag was not added');
      if (!(await getChatTags(client, id)).some((item) => item.id === tagId(tag))) throw new Error("the chat's tags don't list it");
      if (!(await listTags(client)).some((item) => item.id === tagId(tag))) throw new Error('all tags don’t list it');
      const found = await searchChats(client, tagSearch({ id: tagId(tag) }));
      if (found.length !== 1 || found[0]?.id !== id) throw new Error(`tag: search found ${found.length} chats`);
      const left = await removeChatTag(client, id, tag);
      if (left.length) throw new Error('the tag stayed');
      if ((await listTags(client)).some((item) => item.id === tagId(tag))) throw new Error('the unused tag stayed in the list');
      fixture.tags = { shape: shapeOf(added) };
      return 'added, found by tag:, removed, gone from the list';
    });

    if (capabilities.can('chat.share', true)) {
      await check('share: link, who may open it, update, clone from it, delete', async () => {
        const shared = await shareChat(client, id);
        const shareId = shared.share_id;
        if (!shareId) throw new Error('no share_id');
        const url = sharedChatUrl(input.baseUrl, shareId);
        const opened = await getSharedChat(client, shareId);
        if (opened.title !== 'APP PROBE: A6' || !chatPlainText(opened).includes('Kuala Lumpur')) throw new Error('the link shows something else');
        const start = await getShareAccess(client, id);
        if (shareVisibility(start) !== 'private') throw new Error(`a new link is ${shareVisibility(start)}`);
        // Shared with yourself (a named person) and read back; then made public, which the server
        // keeps only if the account may make public links.
        await setShareAccess(client, id, withSharedWith(start, 'user', input.userId, true));
        const named = await getShareAccess(client, id);
        if (!named.some((grant) => grant.principal_type === 'user' && grant.principal_id === input.userId)) throw new Error('the named person was not kept');
        const publicAllowed = capabilities.can('sharing.public_chats');
        let refused = false;
        try {
          await setShareAccess(client, id, withShareVisibility(named, 'public'));
        } catch (error) {
          // 0.12 refuses an audience the account may not use (403, nothing changed); 0.11 dropped it.
          if (publicAllowed || !(error instanceof OwuiHttpError) || error.status !== 403) throw error;
          refused = true;
        }
        const afterPublic = shareVisibility(await getShareAccess(client, id));
        if (afterPublic !== (publicAllowed ? 'public' : 'private')) throw new Error(`a public link came back ${afterPublic} (allowed: ${publicAllowed})`);
        const again = await shareChat(client, id);
        if (again.share_id !== shareId) throw new Error('updating the link changed it');
        const copy = await cloneSharedChat(client, shareId);
        made.push(copy.id);
        if (!copy.title.startsWith('Clone of') || copy.id === id) throw new Error('the clone from the link is wrong');
        await unshareChat(client, id);
        const gone = await getSharedChat(client, shareId).then(
          () => false,
          () => true,
        );
        if (!gone) throw new Error('the deleted link still opens');
        if ((await getChat(client, id)).share_id) throw new Error('the chat still has its share_id');
        fixture.share = { url: url.replace(input.baseUrl.replace(/\/+$/, ''), '').replace(shareId, '{share_id}'), access: shapeOf(named), publicAllowed, openAllowed: capabilities.can('sharing.open_chats') };
        return `link opened; private by default; person kept; public ${publicAllowed ? 'kept' : refused ? 'refused with 403 (not allowed; 0.12)' : 'dropped (not allowed; 0.11)'}; updated in place; cloned from the link; deleted`;
      });
    } else {
      steps.push({ name: 'share', ok: true, note: 'skipped: the account may not share chats' });
    }

    if (capabilities.can('chat.import', true)) {
      await check('clone and fork', async () => {
        const clone = await cloneChat(client, id, 'Clone of APP PROBE: A6');
        made.push(clone.id);
        if (clone.title !== 'Clone of APP PROBE: A6' || Object.keys(clone.chat.history?.messages ?? {}).length !== 2) throw new Error('the clone is wrong');
        const fork = await forkChat(client, id, user);
        made.push(fork.id);
        const forked = Object.keys(fork.chat.history?.messages ?? {});
        if (!fork.title.endsWith('(fork)') || forked.length !== 1) throw new Error(`the fork has ${forked.length} messages, title ${fork.title.endsWith('(fork)') ? 'ok' : 'wrong'}`);
        fixture.clone = { shape: shapeOf(clone, 2) };
        return 'cloned (both messages), forked from the question (one message)';
      });
    } else {
      steps.push({ name: 'clone and fork', ok: true, note: 'skipped: the account may not import chats' });
    }

    await check('downloads: text and JSON', async () => {
      const saved = await getChat(client, id);
      const text = chatPlainText(saved);
      if (text !== '### USER\nWhat is the capital of Malaysia?\n\n### ASSISTANT\nKuala Lumpur.') throw new Error('the text download differs');
      const json = JSON.parse(chatJson(saved)) as ChatRecord[];
      if (json.length !== 1 || json[0]?.id !== id) throw new Error('the JSON download differs');
      return 'built';
    });

    await check('people and groups to share with', async () => {
      const people = await searchUsers(client, '');
      const groups = await listShareGroups(client);
      fixture.directory = { people: people.length > 0, groups: groups.length };
      return `${people.length} people on the first page, ${groups.length} groups`;
    });
  } finally {
    // A link left behind by a failed step goes too.
    const first = made[0];
    if (first) await unshareChat(client, first).catch(() => undefined);
    for (const chatId of made) {
      if (input.canDelete) await deleteChat(client, chatId).catch(() => undefined);
      else await toggleArchived(client, chatId).catch(() => undefined);
    }
  }
  return { steps, fixture };
}
