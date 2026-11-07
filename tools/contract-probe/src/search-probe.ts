import {
  addChatTag,
  attachWebAddress,
  chatSearchSnippet,
  contextUsage,
  createChat,
  createFolder,
  deleteChat,
  deleteFolder,
  folderSearch,
  getChat,
  listChatTasks,
  moveChatToFolder,
  removeChatTag,
  savedTemporaryChat,
  searchChats,
  snippetParts,
  toggleArchived,
  uuidv4,
  type Capabilities,
  type ChatHistory,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

interface SearchInput {
  client: OwuiClient;
  capabilities: Capabilities;
  canDelete: boolean;
  /** The scratch servers: a web page may be fetched by the server. */
  scratch: boolean;
}

/**
 * The search and menus slice in the test account, with no model calls: a probe chat holding a
 * made-up word found by search with its snippet (marked the app's way), by `tag:none` while it has
 * no tags, by its tag once it has one, and by `folder:` inside a probe folder (where folders are
 * on); a second page answered; `/status`'s figures (no tasks running, the server's context use
 * only with compaction on, else the estimate); on the scratch servers, a web page attached as a
 * `load-url` link attaches it. The chat, its tag and the folder are removed afterwards.
 */
export async function probeSearch(input: SearchInput): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const { client, capabilities } = input;
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };
  const word = `appprobe${uuidv4().replace(/-/g, '').slice(0, 10)}`;
  const tag = `app-probe-${word.slice(-6)}`;
  let chatId: string | null = null;
  const folderIds: string[] = [];
  const found = async (search: string) => (await searchChats(client, search)).find((chat) => chat.id === chatId);

  try {
    const user = uuidv4();
    const reply = uuidv4();
    const now = Math.floor(Date.now() / 1000);
    const history: ChatHistory = {
      currentId: reply,
      messages: {
        [user]: { id: user, parentId: null, childrenIds: [reply], role: 'user', content: `APP PROBE: a note about ${word} for the search`, timestamp: now },
        [reply]: { id: reply, parentId: user, childrenIds: [], role: 'assistant', content: 'APP PROBE reply', done: true, timestamp: now, usage: { prompt_tokens: 120, completion_tokens: 8 } },
      },
    };
    const chat = await createChat(client, savedTemporaryChat(history, { models: [] }));
    chatId = chat.id;

    await check('a chat found by a word in it, with the matching snippet', async () => {
      const hit = await found(word);
      if (!hit) throw new Error('not found');
      // 0.11 sends snippets with the list; 0.12 leaves them out, and the app asks for each.
      const snippet = hit.snippet || (await chatSearchSnippet(client, hit.id, word));
      const marked = snippetParts(snippet ?? '', word).filter((part) => part.match).map((part) => part.text.toLowerCase());
      fixture.snippet = { inList: Boolean(hit.snippet), marked: marked.length };
      if (!marked.includes(word)) throw new Error(`the snippet doesn't hold the word (${snippet ? 'other text' : 'no snippet'})`);
      return `found; its snippet (${hit.snippet ? 'in the list' : 'asked for the chat'}) holds the word, marked as the app marks it`;
    });

    await check('Untagged (`tag:none`), then by its tag', async () => {
      if (!(await found(`${word} tag:none`))) throw new Error('an untagged chat was not found with tag:none');
      await addChatTag(client, chat.id, tag);
      if (await found(`${word} tag:none`)) throw new Error('a tagged chat still counts as untagged');
      if (!(await found(`${word} tag:${tag}`))) throw new Error('not found by its tag');
      await removeChatTag(client, chat.id, tag);
      return 'untagged found by tag:none; tagged, found by its tag instead; the tag removed';
    });

    await check('a folder (`folder:` with its name, spaces as underscores)', async () => {
      if (!capabilities.feature('folders') || !(capabilities.isAdmin || capabilities.can('features.folders', true))) return 'skipped: folders are off for this account';
      const folder = await createFolder(client, { name: `APP PROBE search ${word.slice(-6)}` });
      folderIds.push(folder.id);
      // Another folder, empty (0.11 ignores a folder name that matches none, so it must exist).
      const other = await createFolder(client, { name: `APP PROBE other ${word.slice(-6)}` });
      folderIds.push(other.id);
      await moveChatToFolder(client, chat.id, folder.id);
      const filter = folderSearch(folder);
      if (!(await found(`${word} ${filter}`))) throw new Error(`not found with ${filter.replace(word.slice(-6), '…')}`);
      if (await found(`${word} ${folderSearch(other)}`)) throw new Error('found in a folder it is not in');
      return 'found in its folder, and not in another';
    });

    await check('a second page', async () => {
      const second = await searchChats(client, word, 2);
      if (!Array.isArray(second)) throw new Error('not a list');
      return `answered (${second.length} on page 2)`;
    });

    await check('/status figures', async () => {
      const tasks = await listChatTasks(client, chat.id);
      const record = await getChat(client, chat.id);
      const reported = (record as { context_usage?: unknown }).context_usage;
      const usage = contextUsage(record.chat.history as ChatHistory, '', reported);
      fixture.status = { tasks: tasks.length, reported: Boolean(reported), tokens: usage?.tokens ?? null };
      if (tasks.length) throw new Error(`${tasks.length} task(s) running in a chat nothing is replying in`);
      if (!usage?.tokens) throw new Error('no context figure');
      return `no tasks; context ${reported ? 'reported by the server' : `estimated (${usage.tokens} tokens, from the reply's usage)`}`;
    });
  } finally {
    const id = chatId as string | null;
    if (id) {
      if (input.canDelete) await deleteChat(client, id).catch(() => undefined);
      else await toggleArchived(client, id).catch(() => undefined);
    }
    for (const folder of folderIds) await deleteFolder(client, folder, { deleteContents: false }).catch(() => undefined);
  }

  await check('a web page attached as a `load-url` link attaches it', async () => {
    if (!input.scratch) return 'skipped: the server would fetch a page from the internet (scratch servers only)';
    const item = await attachWebAddress(client, 'https://example.com/');
    const content = String((item.file as { data?: { content?: unknown } } | undefined)?.data?.content ?? '');
    if (!/example domain/i.test(content)) throw new Error(`the page's text didn't come back (${item.type})`);
    return `the server read it (${item.type}, ${content.length} characters)`;
  });

  return { steps, fixture };
}
