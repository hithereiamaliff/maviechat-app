import { describe, expect, it } from 'vitest';
import { OwuiClient, type FetchLike } from './http';
import { feedbackCsv, getFeedback, getModelHistory, listFeedback } from './adminEvaluations';

function routedClient(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push(url);
    return new Response(JSON.stringify(routes[`${init?.method ?? 'GET'} ${new URL(url).pathname}`] ?? {}), { status: 200 });
  };
  return { client: new OwuiClient({ baseUrl: 'https://chat.test', token: 't', fetch }), calls };
}

const ROW = { id: 'f1', user_id: 'u1', user: { name: 'Amy' }, data: { rating: 1, model_id: 'gpt-a', sibling_model_ids: ['gpt-b'], reason: 'Accurate', comment: 'Nice, "short"', details: { rating: 8 }, tags: ['code'] }, meta: { chat_id: 'c1', message_id: 'm2' }, updated_at: 1_730_000_000 };

describe('admin evaluations', () => {
  it('reads feedback with who gave it and what it compared', async () => {
    const { client, calls } = routedClient({ 'GET /api/v1/evaluations/feedbacks/list': { items: [ROW], total: 1 } });
    const { items } = await listFeedback(client, { modelId: 'gpt-a' });
    expect(calls[0]).toBe('https://chat.test/api/v1/evaluations/feedbacks/list?page=1&order_by=updated_at&direction=desc&model_id=gpt-a');
    expect(items[0]).toEqual({ id: 'f1', userName: 'Amy', modelId: 'gpt-a', siblings: ['gpt-b'], result: 'won', score: 8, reason: 'Accurate', comment: 'Nice, "short"', tags: ['code'], chatId: 'c1', messageId: 'm2', updatedAt: 1_730_000_000_000 });
  });

  it('finds the rated reply and its prompt in the kept copy of the chat', async () => {
    const snapshot = { chat: { history: { messages: { m1: { id: 'm1', content: 'What is 2+2?' }, m2: { id: 'm2', parentId: 'm1', content: '4' } } } } };
    const { client } = routedClient({ 'GET /api/v1/evaluations/feedback/f1': { ...ROW, snapshot } });
    expect(await getFeedback(client, 'f1')).toMatchObject({ prompt: 'What is 2+2?', reply: '4' });
    const bare = routedClient({ 'GET /api/v1/evaluations/feedback/f1': ROW }).client;
    expect(await getFeedback(bare, 'f1')).toMatchObject({ prompt: '', reply: '' });
  });

  it('doesn’t ask for the history of a model id with a slash', async () => {
    const { client, calls } = routedClient({});
    expect(await getModelHistory(client, 'org/model', 30)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('writes CSV with quoting', async () => {
    const { items } = await listFeedback(routedClient({ 'GET /api/v1/evaluations/feedbacks/list': { items: [ROW], total: 1 } }).client);
    const lines = feedbackCsv(items).split('\n');
    expect(lines[0]).toBe('id,user,model,compared with,result,score,reason,comment,tags,updated');
    expect(lines[1]).toBe('f1,Amy,gpt-a,gpt-b,won,8,Accurate,"Nice, ""short""",code,2024-10-27T03:33:20.000Z');
  });
});
