import {
  compactChat,
  createChat,
  defaultFilterIds,
  defaultSkillIds,
  deleteChat,
  getConfig,
  listModels,
  listNoteChoices,
  listSkillChoices,
  modelFilters,
  noteReferenceItem,
  savedTemporaryChat,
  skillMention,
  toggleArchived,
  uuidv4,
  type Capabilities,
  type ChatHistory,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import { shapeOf } from './shape';
import type { WriteStep } from './write-probe';

interface IntegrationsInput {
  client: OwuiClient;
  capabilities: Capabilities;
  canDelete: boolean;
}

/**
 * The commands and integrations slice in the test account, with no model calls: a probe note
 * made, found on the newest page and by search the way Attach Notes reads them, and deleted (only
 * where the account has notes); the skills for the `/` list and Integrations (counts only); the models'
 * switchable filters and their defaults (counts only); and `/compact` asked of a one-message chat,
 * which the server turns down before any model would run (off: "disabled"; on: "too_short"). The
 * chat is deleted afterwards (archived where the account may not delete chats).
 */
export async function probeIntegrations(input: IntegrationsInput): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const { client, capabilities, canDelete } = input;
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };

  await check('notes for Attach Notes', async () => {
    if (!capabilities.feature('notes', true)) return 'notes are off for this account (the + menu leaves Attach Notes out)';
    // A probe note of the account's own, so both lists (the newest page, and a search) are read with something in them.
    const made = await client.post<{ id?: string }>('/api/v1/notes/create', { title: 'APP PROBE: note', data: { content: { json: null, html: '<p>APP PROBE</p>', md: 'APP PROBE' } }, meta: null });
    const noteId = typeof made?.id === 'string' ? made.id : null;
    if (!noteId) throw new Error('the probe note was not made');
    try {
      const [recent, found, none] = await Promise.all([
        listNoteChoices(client, ''),
        listNoteChoices(client, 'APP PROBE: note'),
        listNoteChoices(client, 'zz-app-probe-no-such-note'),
      ]);
      const listed = recent.find((note) => note.id === noteId);
      if (!listed) throw new Error('the probe note is not on the newest page');
      if (listed.title !== 'APP PROBE: note' || listed.updatedAt < Date.parse('2026-01-01') || listed.updatedAt > Date.now() + 86_400_000) throw new Error('the title or time came back wrong');
      if (!found.some((note) => note.id === noteId)) throw new Error('a search for its title did not find it');
      if (none.length !== 0) throw new Error(`a search that matches nothing found ${none.length}`);
      const item = noteReferenceItem(listed, 'probe-item');
      if (item.type !== 'note' || item.id !== noteId || item.name !== 'APP PROBE: note') throw new Error('the attachment is not in the web’s form');
      fixture.note = shapeOf([{ ...listed, title: 'redacted' }]);
      return `listed (${recent.length} on page 1) and found by search, with its title and time; a search with no match found none`;
    } finally {
      await client.delete(`/api/v1/notes/${encodeURIComponent(noteId)}/delete`).catch(() => undefined);
    }
  });

  await check('skills for the / list and Integrations', async () => {
    const skills = await listSkillChoices(client);
    const active = skills.filter((skill) => skill.active);
    const mention = skillMention({ id: 'probe-id', name: 'Probe' });
    if (mention !== '<$probe-id|Probe>') throw new Error('the mention is not in the web’s form');
    return `${skills.length} skill(s), ${active.length} active`;
  });

  await check('the models’ filters and default skills', async () => {
    const [models, skills] = await Promise.all([listModels(client), listSkillChoices(client)]);
    const withFilters = models.filter((model) => modelFilters(model).length > 0);
    const withDefaultFilters = models.filter((model) => defaultFilterIds(model).length > 0);
    const withDefaultSkills = models.filter((model) => defaultSkillIds(model, skills).length > 0);
    fixture.filter = shapeOf(withFilters.slice(0, 1).flatMap((model) => modelFilters(model).slice(0, 1)));
    return `${models.length} model(s): ${withFilters.length} with switchable filters, ${withDefaultFilters.length} with filters on by default, ${withDefaultSkills.length} with default skills`;
  });

  let chatId: string | null = null;
  try {
    await check('/compact turned down before any model runs', async () => {
      const config = await getConfig(client);
      const on = config.features?.enable_context_compaction === true;
      const models = await listModels(client);
      const message = uuidv4();
      const history: ChatHistory = {
        currentId: message,
        messages: { [message]: { id: message, parentId: null, childrenIds: [], role: 'user', content: 'APP PROBE: compact', timestamp: Math.floor(Date.now() / 1000) } },
      };
      const chat = await createChat(client, savedTemporaryChat(history, { models: [] }));
      chatId = chat.id;
      const result = await compactChat(client, chat.id, models[0]?.id ?? 'app-probe');
      const expected = on ? 'too_short' : 'disabled';
      if (result.compacted || result.reason !== expected) throw new Error(`expected ${expected}, got ${result.compacted ? 'compacted' : (result.reason ?? 'no reason')}`);
      return `compaction ${on ? 'on' : 'off'} on this server: "${expected}"`;
    });
  } finally {
    const id = chatId as string | null;
    if (id) {
      if (canDelete) await deleteChat(client, id).catch(() => undefined);
      else await toggleArchived(client, id).catch(() => undefined);
    }
  }
  return { steps, fixture };
}
