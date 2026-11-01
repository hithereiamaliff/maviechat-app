import {
  deleteChat,
  getChat,
  OwuiHttpError,
  renameChat,
  searchChats,
  selectBranch,
  toggleArchived,
  togglePinned,
  type ChatRecord,
  type OwuiClient,
} from '@maviechat/owui-protocol';

export interface WriteStep {
  name: string;
  ok: boolean;
  note: string;
}

const PREFIX = 'APP PROBE';

/**
 * Exercises the chat actions the app uses (milestone 1, slice 1) on a throwaway
 * "APP PROBE:" chat in the test account. The chat is deleted afterwards, or archived
 * when the account may not delete chats (`chat.delete` permission), even on failure.
 */
export async function probeChatActions(client: OwuiClient, { canDelete }: { canDelete: boolean }): Promise<WriteStep[]> {
  const steps: WriteStep[] = [];
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };
  const discard = async (id: string) => {
    if (canDelete) {
      await deleteChat(client, id);
    } else if (!(await getChat(client, id)).archived) {
      await toggleArchived(client, id);
    }
  };

  await check('tidy up earlier probe chats', async () => {
    const leftovers = (await searchChats(client, PREFIX)).filter((chat) => chat.title.startsWith(PREFIX));
    for (const chat of leftovers) await discard(chat.id);
    return leftovers.length ? `${canDelete ? 'deleted' : 'archived'} ${leftovers.length}` : 'none';
  });

  const now = Math.floor(Date.now() / 1000);
  const message = (id: string, parentId: string | null, childrenIds: string[], role: string, content: string) => ({
    id,
    parentId,
    childrenIds,
    role,
    content,
    timestamp: now,
    ...(role === 'assistant' ? { done: true, model: 'app-probe' } : {}),
  });
  const ids = { user: crypto.randomUUID(), first: crypto.randomUUID(), second: crypto.randomUUID() };

  let chatId: string | undefined;
  try {
    await check('create probe chat with two branches', async () => {
      const created = await client.post<ChatRecord>('/api/v1/chats/new', {
        chat: {
          title: `${PREFIX}: actions`,
          models: ['app-probe'],
          history: {
            currentId: ids.first,
            messages: {
              [ids.user]: message(ids.user, null, [ids.first, ids.second], 'user', 'Probe question'),
              [ids.first]: message(ids.first, ids.user, [], 'assistant', 'First answer'),
              [ids.second]: message(ids.second, ids.user, [], 'assistant', 'Second answer'),
            },
          },
          messages: [],
          tags: [],
          timestamp: now * 1000,
        },
      });
      chatId = created.id;
      return 'created';
    });
    if (!chatId) return steps;
    const id = chatId;

    await check('rename keeps the history', async () => {
      await renameChat(client, id, `${PREFIX}: renamed`);
      const chat = await getChat(client, id);
      expect(chat.title === `${PREFIX}: renamed`, `title is "${chat.title}"`);
      expect(Object.keys(chat.chat.history?.messages ?? {}).length === 3, 'messages changed');
      return 'title updated, 3 messages intact';
    });

    await check('switching branches keeps every message', async () => {
      await selectBranch(client, id, ids.second);
      const chat = await getChat(client, id);
      const shown = chat.current_message_id ?? chat.chat.history?.currentId;
      expect(shown === ids.second, 'the second branch is not shown');
      expect(Object.keys(chat.chat.history?.messages ?? {}).length === 3, 'messages were lost');
      expect(chat.chat.history?.messages[ids.user]?.childrenIds.length === 2, 'branches were lost');
      return 'second branch shown, 3 messages, 2 branches';
    });

    await check('pin and unpin', async () => {
      const pinned = await togglePinned(client, id);
      expect(pinned.pinned === true, 'not pinned');
      const unpinned = await togglePinned(client, id);
      expect(!unpinned.pinned, 'still pinned');
      return 'toggled both ways';
    });

    await check('archive and unarchive', async () => {
      const archived = await toggleArchived(client, id);
      expect(archived.archived === true, 'not archived');
      const restored = await toggleArchived(client, id);
      expect(restored.archived === false, 'still archived');
      return 'toggled both ways';
    });

    if (canDelete) {
      await check('delete', async () => {
        expect((await deleteChat(client, id)) === true, 'delete did not answer true');
        chatId = undefined;
        try {
          await getChat(client, id);
        } catch (error) {
          if (error instanceof OwuiHttpError && error.status >= 400) return 'deleted and gone';
          throw error;
        }
        throw new Error('the chat still exists after delete');
      });
    } else {
      steps.push({ name: 'delete', ok: true, note: 'skipped: the test account may not delete chats (archived instead)' });
    }
  } finally {
    if (chatId) await discard(chatId).catch(() => {});
  }
  return steps;
}

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
