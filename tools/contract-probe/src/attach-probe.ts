import {
  createChat,
  deleteChat,
  getChat,
  getConfig,
  getUserSettings,
  imageLimits,
  listChats,
  savedTemporaryChat,
  searchFiles,
  searchKnowledgeBases,
  toggleArchived,
  uuidv4,
  type ChatHistory,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import { shapeOf } from './shape';
import type { WriteStep } from './write-probe';

interface AttachInput {
  client: OwuiClient;
  canDelete: boolean;
}

/**
 * The input bar slice in the test account, with no model calls: the lists the + menu reads
 * (your files, knowledge bases, chats; counts only); the photo size limits (whether set, not
 * their values); and a temporary chat saved the app's way, read back and deleted (archived where
 * the account may not delete chats).
 */
export async function probeAttach(input: AttachInput): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const { client, canDelete } = input;
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };

  await check('the + menu’s lists: your files, knowledge bases, chats', async () => {
    const [files, bases, chats] = await Promise.all([searchFiles(client, ''), searchKnowledgeBases(client, ''), listChats(client, 1)]);
    fixture.files = shapeOf(files.slice(0, 1));
    return `${files.length} file(s), ${bases.length} knowledge base(s), ${chats.length} chat(s) on page 1`;
  });

  await check('photo size limits', async () => {
    const [config, settings] = await Promise.all([getConfig(client), getUserSettings(client)]);
    const limits = imageLimits(settings.ui, config);
    return limits ? `limited (${limits.width !== null ? 'width' : ''}${limits.width !== null && limits.height !== null ? ' and ' : ''}${limits.height !== null ? 'height' : ''})` : 'none set';
  });

  let savedId: string | null = null;
  try {
    await check('a temporary chat saved, read back', async () => {
      const user = uuidv4();
      const reply = uuidv4();
      const now = Math.floor(Date.now() / 1000);
      const history: ChatHistory = {
        currentId: reply,
        messages: {
          [user]: { id: user, parentId: null, childrenIds: [reply], role: 'user', content: 'APP PROBE: saved from a temporary chat', timestamp: now },
          [reply]: { id: reply, parentId: user, childrenIds: [], role: 'assistant', content: 'Saved.', done: true, timestamp: now },
        },
      };
      const saved = await createChat(client, savedTemporaryChat(history, { models: [] }));
      savedId = saved.id;
      const read = await getChat(client, saved.id);
      if (read.title !== 'APP PROBE: saved from a temporary chat') throw new Error('the title was not kept');
      if (Object.keys(read.chat?.history?.messages ?? {}).length !== 2) throw new Error('the history was not kept');
      return 'saved with its title and both messages';
    });
  } finally {
    const id = savedId as string | null;
    if (id) {
      if (canDelete) await deleteChat(client, id).catch(() => undefined);
      else await toggleArchived(client, id).catch(() => undefined);
    }
  }
  return { steps, fixture };
}
