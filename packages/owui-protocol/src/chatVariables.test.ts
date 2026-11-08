import { describe, expect, it } from 'vitest';
import { chatVariableInputs, chatVariablesForm, chatVariablesOf, hasChatVariables, saveChatVariables } from './chatVariables';
import { buildCompletionRequest } from './completions';
import { OwuiClient, type FetchLike } from './http';
import type { ModelItem } from './models';

const model = (id: string, fields: unknown[]): ModelItem => ({ id, name: id, info: { meta: { chat_variables_schema: { fields } } } });

const topic = { key: 'topic', type: 'select', options: ['alpha', 'beta'], required: true };
const note = { key: 'note', type: 'textarea', placeholder: 'Anything', required: false };

describe('a model’s chat variables', () => {
  it('knows which models ask for them', () => {
    expect(hasChatVariables([model('a', []), undefined])).toBe(false);
    expect(hasChatVariables([model('a', [note])])).toBe(true);
    expect(hasChatVariables([{ id: 'plain', name: 'Plain' }])).toBe(false);
  });

  it('merges the chosen models’ fields as the web does: one per key, required if any requires it', () => {
    const form = chatVariablesForm([model('a', [{ ...note, required: false }, topic]), model('b', [{ ...note, required: true }])], {});
    expect(form.fields.map((field) => [field.key, field.required])).toEqual([
      ['note', true],
      ['topic', true],
    ]);
    expect(form.conflicts).toEqual([]);
    expect(form.fields.find((field) => field.key === 'topic')?.options).toEqual(['alpha', 'beta']);
  });

  it('finds a key asked for in different ways, by every model that asks for it', () => {
    const form = chatVariablesForm([model('a', [topic]), model('b', [{ ...topic, options: ['x'] }]), model('c', [{ ...topic, options: ['y'] }])], {});
    expect(form.conflicts).toEqual([{ key: 'topic', modelIds: ['a', 'b', 'c'] }]);
  });

  it('asks before sending when a required one has no value, or when nothing is filled in', () => {
    expect(chatVariablesForm([model('a', [topic, note])], {})).toMatchObject({ empty: true, missing: true });
    expect(chatVariablesForm([model('a', [topic, note])], { topic: 'beta' })).toMatchObject({ empty: false, missing: false });
    expect(chatVariablesForm([model('a', [note])], { note: '' })).toMatchObject({ empty: true, missing: false });
    expect(chatVariablesForm([model('a', [{ ...topic, default: 'alpha' }])], {})).toMatchObject({ empty: false, missing: false });
    expect(chatVariablesForm([model('a', [])], {})).toMatchObject({ empty: false, missing: false });
  });

  it('fills the sheet from the chat’s values, else the defaults', () => {
    const form = chatVariablesForm([model('a', [{ ...topic, label: 'Topic', default: 'alpha' }, { key: 'count', type: 'number', min: '1', max: 9 }])], {});
    expect(chatVariableInputs(form, { count: 3 })).toEqual([
      { name: 'topic', type: 'select', required: true, options: ['alpha', 'beta'], label: 'Topic', default: 'alpha' },
      { name: 'count', type: 'number', required: false, options: [], default: '3', min: 1, max: 9 },
    ]);
  });

  it('keeps a saved chat’s values with the chat, the rest of it as it is', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ id: 'c1', variables: { topic: 'beta' } }), { status: 200 });
    };
    const kept = await saveChatVariables(new OwuiClient({ baseUrl: 'https://x.test', token: 't', fetch }), 'c 1', { topic: 'beta' });
    expect(kept).toEqual({ topic: 'beta' });
    expect(calls).toEqual([{ url: 'https://x.test/api/v1/chats/c%201', body: { chat: {}, variables: { topic: 'beta' } } }]);
    expect(chatVariablesOf({ variables: null })).toEqual({});
  });

  it('sends a new or temporary chat’s values with the message, and nothing otherwise', () => {
    const turn = { userMessage: { id: 'u', parentId: null, childrenIds: [], role: 'user', content: 'hi', timestamp: 1 }, replies: [{ id: 'r' }], messageIds: [{ model_id: 'a', message_id: 'r' }] } as never;
    const base = { turn, chatId: null, sessionId: 's', model: model('a', [topic]), features: {}, variables: {}, tasks: {} };
    expect(buildCompletionRequest({ ...base, chatVariables: { topic: 'beta' } }).chat_variables).toEqual({ topic: 'beta' });
    expect(buildCompletionRequest(base)).not.toHaveProperty('chat_variables');
  });
});
