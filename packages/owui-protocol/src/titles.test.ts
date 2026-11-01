import { describe, expect, it } from 'vitest';
import type { HistoryMessage } from './history';
import { OwuiClient, type FetchLike } from './http';
import { generateTitle, parseGeneratedTitle, titleMessages, titleModel } from './titles';

const branch: HistoryMessage[] = [
  { id: 'u', parentId: null, childrenIds: ['a'], role: 'user', content: 'Plan a trip' },
  {
    id: 'a',
    parentId: 'u',
    childrenIds: [],
    role: 'assistant',
    content: '',
    model: 'gpt',
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'Sure.' }] }],
  } as HistoryMessage,
];

describe('title generation', () => {
  it('reads the visible text of the shown branch and its last model', () => {
    expect(titleMessages(branch)).toEqual([
      { role: 'user', content: 'Plan a trip' },
      { role: 'assistant', content: 'Sure.' },
    ]);
    expect(titleModel(branch, ['other'])).toBe('gpt');
    expect(titleModel(branch.slice(0, 1), ['', 'other'])).toBe('other');
    expect(titleModel([], undefined)).toBeNull();
  });

  it('finds the title in loose answers without breaking apostrophes', () => {
    expect(parseGeneratedTitle('{"title": "Alan\'s trip to Penang"}')).toBe("Alan's trip to Penang");
    expect(parseGeneratedTitle('Here you go:\n```json\n{ "title": "🌴 Trip plan" }\n```')).toBe('🌴 Trip plan');
    expect(parseGeneratedTitle("{'title': 'Budget review'}")).toBe('Budget review');
    expect(parseGeneratedTitle('{“title”: “Curly”}')).toBe('Curly');
    expect(parseGeneratedTitle('No JSON here')).toBeNull();
    expect(parseGeneratedTitle('{"title": "  "}')).toBeNull();
  });

  it('posts to the title task and reports a disabled task', async () => {
    const bodies: unknown[] = [];
    const answers = [{ choices: [{ message: { content: '{"title": "Trip"}' } }] }, { detail: 'Title generation is disabled' }];
    const fetch: FetchLike = async (url, init) => {
      bodies.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(answers.shift()), { status: 200 });
    };
    const client = new OwuiClient({ baseUrl: 'https://x.test', token: 't', fetch });
    await expect(generateTitle(client, { model: 'gpt', messages: titleMessages(branch), chatId: 'c1' })).resolves.toBe('Trip');
    expect(bodies[0]).toEqual({
      url: 'https://x.test/api/v1/tasks/title/completions',
      body: { model: 'gpt', messages: titleMessages(branch), chat_id: 'c1' },
    });
    await expect(generateTitle(client, { model: 'gpt', messages: [] })).rejects.toThrow('Title generation is disabled');
  });
});
