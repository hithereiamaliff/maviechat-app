import {
  deleteChat,
  deleteFile,
  exportAllChats,
  exportArchivedChats,
  getChat,
  importChats,
  listSharedChats,
  OwuiHttpError,
  readImportFile,
  searchFiles,
  countFiles,
  shareChat,
  toggleArchived,
  unshareAllChats,
  unshareChat,
  uploadFile,
  uuidv4,
  type Capabilities,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import { shapeOf } from './shape';
import type { WriteStep } from './write-probe';

interface DataInput {
  client: OwuiClient;
  capabilities: Capabilities;
}

/** An Open WebUI export record with one exchange, as the web's export writes them. */
function openWebUiRecord() {
  const user = uuidv4();
  const reply = uuidv4();
  const now = Math.floor(Date.now() / 1000);
  return {
    id: 'not-kept',
    title: 'APP PROBE: imported (Open WebUI)',
    chat: {
      title: 'APP PROBE: imported (Open WebUI)',
      models: ['probe-model'],
      history: {
        currentId: reply,
        messages: {
          [user]: { id: user, parentId: null, childrenIds: [reply], role: 'user', content: 'APP PROBE: hello', timestamp: now, models: ['probe-model'] },
          [reply]: { id: reply, parentId: user, childrenIds: [], role: 'assistant', content: 'APP PROBE: hi', model: 'probe-model', done: true, timestamp: now },
        },
      },
    },
    meta: {},
    folder_id: 'a-folder-that-is-not-yours',
    created_at: now - 3600,
    updated_at: now - 60,
  };
}

/** ChatGPT's export shape: a branch, a hidden instruction, the thread last seen ending at `b`. */
function chatGptConversation() {
  const said = (role: string, words: string, extra: Record<string, unknown> = {}) => ({ author: { role }, content: { content_type: 'text', parts: [words] }, create_time: 1_700_000_100, ...extra });
  return {
    title: 'APP PROBE: imported (ChatGPT)',
    create_time: 1_700_000_000,
    update_time: 1_700_000_200,
    current_node: 'b',
    mapping: {
      root: { id: 'root', parent: null, children: ['h'], message: null },
      h: { id: 'h', parent: 'root', children: ['u'], message: said('user', 'hidden instructions', { metadata: { is_visually_hidden_from_conversation: true } }) },
      u: { id: 'u', parent: 'h', children: ['a', 'b'], message: said('user', 'APP PROBE: which way?') },
      a: { id: 'a', parent: 'u', children: [], message: said('assistant', 'APP PROBE: left', { metadata: { model_slug: 'gpt-4o' } }) },
      b: { id: 'b', parent: 'u', children: [], message: said('assistant', 'APP PROBE: right', { metadata: { model_slug: 'gpt-4o' } }) },
    },
  };
}

const statusOf = (error: unknown) => (error instanceof OwuiHttpError ? error.status : undefined);

/**
 * Milestone 2 slice A8.3 against a live server, in the test account: every chat exported (the
 * server's JSON lines) and the archived ones; two chats imported (an Open WebUI record and a
 * ChatGPT conversation) and read back; a share link listed, found and removed (all links removed
 * only when the account had none of its own); a file found by name, counted and deleted. Archive
 * all and Delete all are not called: they change every chat of the account. No model calls.
 */
export async function probeA8Data(input: DataInput): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const { client, capabilities } = input;
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const canDelete = capabilities.can('chat.delete');
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
      return true;
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
      return false;
    }
  };

  // ── Export (read only) ──
  await check('export: every chat as JSON lines, and the archived ones', async () => {
    const all = await exportAllChats(client);
    const archived = await exportArchivedChats(client);
    const allIds = new Set((JSON.parse(all.json) as { id?: string }[]).map((chat) => chat.id));
    const archivedList = JSON.parse(archived.json) as { id?: string; archived?: boolean }[];
    const first = (JSON.parse(all.json) as unknown[])[0];
    fixture.export = { count: all.count, archived: archived.count, shape: first ? shapeOf(first) : null };
    if (archivedList.some((chat) => !allIds.has(chat.id))) throw new Error('an archived chat is missing from the full export');
    if (archivedList.some((chat) => chat.archived !== true)) throw new Error('the archived export has a chat that is not archived');
    if (!all.count) {
      // An account whose chats the probes deleted (it may delete, unlike production's) has nothing to export.
      const left = await client.get<unknown[]>('/api/v1/chats/', { query: { page: 1 } });
      if (Array.isArray(left) && left.length) throw new Error('the export is empty');
      return 'nothing to export: this account has no chats left';
    }
    return `${all.count} chats, ${archived.count} of them archived (all in the full export)`;
  });

  // ── Import ──
  const made: string[] = [];
  let shared: string | null = null;
  try {
    if (!capabilities.can('chat.import', true)) {
      await check('import: refused for this account (403)', async () => {
        const plan = readImportFile(JSON.stringify([openWebUiRecord()]));
        try {
          await importChats(client, plan.chats);
        } catch (error) {
          if (statusOf(error) === 403) return 'refused';
          throw error;
        }
        throw new Error('the server took it');
      });
    } else {
      await check('import: an Open WebUI record and a ChatGPT conversation, read back', async () => {
        const record = openWebUiRecord();
        const fromOwui = readImportFile(JSON.stringify([record]));
        const fromGpt = readImportFile(JSON.stringify([chatGptConversation()]));
        if (fromOwui.from !== 'open-webui' || fromGpt.from !== 'chatgpt') throw new Error('the files were not told apart');
        const chats = await importChats(client, [...fromOwui.chats, ...fromGpt.chats]);
        for (const chat of chats) made.push(chat.id);
        if (chats.length !== 2) throw new Error(`${chats.length} chats came back`);
        const [owui, gpt] = await Promise.all(made.map((id) => getChat(client, id)));
        fixture.imported = { shape: owui ? shapeOf(owui) : null };
        if (!owui || owui.title !== 'APP PROBE: imported (Open WebUI)' || owui.id === 'not-kept') throw new Error('the Open WebUI chat came back different');
        if (owui.folder_id) throw new Error('a folder that is not the account’s was kept');
        if (owui.current_message_id !== owui.chat.history?.currentId) throw new Error('the current message was not taken from the history');
        if (owui.created_at !== record.created_at || owui.updated_at !== record.updated_at) throw new Error('the dates were not kept');
        const thread = Object.values(gpt?.chat.history?.messages ?? {});
        if (!gpt || gpt.title !== 'APP PROBE: imported (ChatGPT)' || thread.length !== 2) throw new Error(`the ChatGPT chat came back with ${thread.length} messages`);
        if (!thread.some((message) => message.content === 'APP PROBE: right') || thread.some((message) => message.content === 'APP PROBE: left')) throw new Error('the wrong branch was kept');
        if (gpt.created_at !== 1_700_000_000 || gpt.current_message_id !== gpt.chat.history?.currentId) throw new Error('the conversation’s date or current message was lost');
        return 'both stored with new ids; the folder dropped, dates and the shown thread kept';
      });
    }

    // ── Shared chats ──
    const target = made[0];
    if (target) {
      let before = 0;
      await check('shared chats: listed, a new link found by search, removed', async () => {
        before = (await listSharedChats(client)).length;
        const record = await shareChat(client, target);
        shared = target;
        const found = await listSharedChats(client, 1, 'APP PROBE: imported (Open', { by: 'title', direction: 'asc' });
        const row = found.find((chat) => chat.chatId === target);
        fixture.shared = { before, shape: found[0] ? shapeOf(found[0]) : null };
        if (!row || row.shareId !== record.share_id) throw new Error('the new link is not listed with its share id');
        await unshareChat(client, target);
        shared = null;
        if ((await listSharedChats(client)).some((chat) => chat.chatId === target)) throw new Error('still listed after removing the link');
        return `${before} of the account’s own; the probe’s link listed, then gone`;
      });
      if (before === 0) {
        await check('shared chats: every link removed', async () => {
          await shareChat(client, target);
          shared = target;
          if (!(await unshareAllChats(client))) throw new Error('the server said no');
          shared = null;
          const left = (await listSharedChats(client)).length;
          if (left) throw new Error(`${left} links left`);
          return 'one link, then none';
        });
      } else {
        steps.push({ name: 'shared chats: every link removed', ok: true, note: 'skipped: the account has share links of its own' });
      }
    }
  } finally {
    if (shared) await unshareChat(client, shared).catch(() => undefined);
    for (const chatId of made) {
      if (canDelete) await deleteChat(client, chatId).catch(() => undefined);
      else await toggleArchived(client, chatId).catch(() => undefined);
    }
  }

  // ── Files ──
  let fileId: string | null = null;
  try {
    await check('files: found by name, counted, and deleted; no match is an empty list', async () => {
      const name = `app-probe-${Date.now()}.txt`;
      const form = new FormData();
      form.append('file', new Blob(['APP PROBE file'], { type: 'text/plain' }), name);
      fileId = (await uploadFile(client, form, { process: false })).id;
      const count = await countFiles(client);
      const found = await searchFiles(client, name.slice(0, -4).toUpperCase());
      const row = found.find((file) => file.id === fileId);
      fixture.files = { count, shape: found[0] ? shapeOf(found[0]) : null };
      if (!row || row.filename !== name || row.size !== 14) throw new Error('the file was not found by name with its size');
      if ((await searchFiles(client, `no-such-file-${Date.now()}`)).length) throw new Error('a search for nothing found something');
      await deleteFile(client, fileId);
      fileId = null;
      if ((await searchFiles(client, name)).length) throw new Error('still found after deleting');
      return `${count} files counted; found by part of its name in any case, then deleted`;
    });
  } finally {
    if (fileId) await deleteFile(client, fileId).catch(() => undefined);
  }

  steps.push({ name: 'archive all, delete all', ok: true, note: 'not called: they change every chat of the account' });
  return { steps, fixture };
}
