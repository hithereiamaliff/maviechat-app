import { describe, expect, it } from 'vitest';
import { compactChat } from './chats';
import { buildCompletionRequest } from './completions';
import { OwuiClient, type FetchLike } from './http';
import { defaultFilterIds, defaultSkillIds, modelFilters, skillMention } from './input';
import type { ModelItem } from './models';
import { listNoteChoices, noteReferenceItem } from './notes';

function recordingClient(answer: unknown) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(answer), { status: 200 });
  };
  return { client: new OwuiClient({ baseUrl: 'https://chat.test', token: 't', fetch }), calls };
}

const model = {
  id: 'm',
  name: 'M',
  filters: [{ id: 'f1', name: 'Censor', description: 'Hides words' }, { id: 'f2' }, { name: 'no id' }],
  info: { meta: { defaultFilterIds: ['f2', 'gone'], skillIds: ['s1', 's2', 's1'] } },
} as unknown as ModelItem;

describe('skills and filters', () => {
  it('lists a model’s switchable filters and the ones that start on', () => {
    expect(modelFilters(model)).toEqual([
      { id: 'f1', name: 'Censor', description: 'Hides words' },
      { id: 'f2', name: 'f2', description: '' },
    ]);
    expect(defaultFilterIds(model)).toEqual(['f2']);
    expect(defaultFilterIds(undefined)).toEqual([]);
  });

  it('starts with the model’s active skills, and mentions a skill as the web does', () => {
    expect(defaultSkillIds(model, [{ id: 's1', active: true }, { id: 's2', active: false }])).toEqual(['s1']);
    expect(skillMention({ id: 'sk-1', name: 'Writer' })).toBe('<$sk-1|Writer>');
    expect(skillMention({ id: 'sk-2', name: 'A > B' })).toBe('<$sk-2|A  B>');
  });

  it('sends the chosen skills and filters with the message', () => {
    const body = buildCompletionRequest({
      chatId: 'c',
      model: { id: 'm', name: 'M' },
      turn: { userMessage: { id: 'u' }, replies: [{ id: 'r' }] },
      features: {},
      variables: {},
      tasks: {},
      skillIds: ['s1'],
      filterIds: ['f2'],
    } as unknown as Parameters<typeof buildCompletionRequest>[0]);
    expect(body).toMatchObject({ skill_ids: ['s1'], filter_ids: ['f2'] });
    const none = buildCompletionRequest({
      chatId: 'c',
      model: { id: 'm', name: 'M' },
      turn: { userMessage: { id: 'u' }, replies: [{ id: 'r' }] },
      features: {},
      variables: {},
      tasks: {},
      skillIds: [],
    } as unknown as Parameters<typeof buildCompletionRequest>[0]);
    expect(none).not.toHaveProperty('skill_ids');
    expect(none).not.toHaveProperty('filter_ids');
  });
});

describe('notes and compacting', () => {
  it('lists notes or searches them, and attaches one by id', async () => {
    const listed = recordingClient([{ id: 'n1', title: 'Plan', updated_at: 1_700_000_000_000_000_000 }, { title: 'no id' }]);
    expect(await listNoteChoices(listed.client, '')).toEqual([{ id: 'n1', title: 'Plan', updatedAt: 1_700_000_000_000 }]);
    expect(listed.calls[0]?.url).toBe('https://chat.test/api/v1/notes/?page=1');
    const searched = recordingClient({ items: [{ id: 'n2', title: '' }], total: 1 });
    expect(await listNoteChoices(searched.client, ' plan ')).toEqual([{ id: 'n2', title: 'Untitled', updatedAt: 0 }]);
    expect(searched.calls[0]?.url).toBe('https://chat.test/api/v1/notes/search?query=plan&page=1');
    expect(noteReferenceItem({ id: 'n1', title: 'Plan', updatedAt: 0 }, 'i')).toEqual({ type: 'note', id: 'n1', url: '', name: 'Plan', status: 'processed', itemId: 'i' });
  });

  it('asks the server to compact a chat with the model', async () => {
    const { client, calls } = recordingClient({ compacted: false, reason: 'too_short' });
    expect(await compactChat(client, 'c/1', 'gpt')).toEqual({ compacted: false, reason: 'too_short' });
    expect(calls).toEqual([{ method: 'POST', url: 'https://chat.test/api/v1/chats/c%2F1/compact', body: { model: 'gpt' } }]);
  });
});
