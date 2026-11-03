import { describe, expect, it } from 'vitest';
import type { ChatHistory, HistoryMessage } from './history';
import { OwuiClient, OwuiHttpError, type FetchLike } from './http';
import { defaultModelIds, modelsLabel, pickModelIds, type ModelItem } from './models';
import {
  CompletionTextReader,
  groupPosition,
  groupsDone,
  mergedResponse,
  mergeInput,
  mergeResponses,
  replyGroups,
  switchGroupVersion,
} from './multi';

const reply = (id: string, modelIdx: number | undefined, model: string, extra: Partial<HistoryMessage> = {}): HistoryMessage => ({
  id,
  parentId: 'u1',
  childrenIds: [],
  role: 'assistant',
  content: `answer ${id}`,
  model,
  ...(modelIdx === undefined ? {} : { modelIdx }),
  done: true,
  ...extra,
});

// "Question" went to two models; model a was regenerated (a1, a2), and the chat went on from b1.
const history: ChatHistory = {
  currentId: 'u2',
  messages: {
    u1: { id: 'u1', parentId: null, childrenIds: ['a1', 'b1', 'a2'], role: 'user', content: 'Question', models: ['m-a', 'm-b'] },
    a1: reply('a1', 0, 'm-a'),
    b1: reply('b1', 1, 'm-b', { childrenIds: ['u2'] }),
    a2: reply('a2', 0, 'm-a', { content: '', output: [{ type: 'message', content: [{ type: 'output_text', text: 'From output' }] }] } as Partial<HistoryMessage>),
    u2: { id: 'u2', parentId: 'b1', childrenIds: [], role: 'user', content: 'Next' },
  },
};

describe('multi-model turns', () => {
  it('groups the answers by column, showing the branch reply and else the newest version', () => {
    const groups = replyGroups(history, 'b1');
    expect(groups).toEqual([
      { modelIdx: 0, modelId: 'm-a', ids: ['a1', 'a2'], shownId: 'a2' },
      { modelIdx: 1, modelId: 'm-b', ids: ['b1'], shownId: 'b1' },
    ]);
    expect(replyGroups(history, 'a1')?.[0]?.shownId).toBe('a1');
    expect(groupPosition(groups![0]!)).toEqual({ index: 1, count: 2 });
  });

  it('is null for a one-model turn and for a reply outside every column', () => {
    const single: ChatHistory = { currentId: 'x', messages: { u: { id: 'u', parentId: null, childrenIds: ['x'], role: 'user', content: 'q', models: ['m'] }, x: { ...reply('x', 0, 'm'), parentId: 'u' } } };
    expect(replyGroups(single, 'x')).toBeNull();
    const stray: ChatHistory = { ...history, messages: { ...history.messages, z: reply('z', 5, 'm-z') } };
    expect(replyGroups(stray, 'z')).toBeNull();
  });

  it('groups replies saved without modelIdx by model id', () => {
    const legacy: ChatHistory = {
      currentId: 'o2',
      messages: {
        u1: { id: 'u1', parentId: null, childrenIds: ['o1', 'o2'], role: 'user', content: 'q', models: ['m-a', 'm-b'] },
        o1: reply('o1', undefined, 'm-a'),
        o2: reply('o2', undefined, 'm-b'),
      },
    };
    expect(replyGroups(legacy, 'o2')?.map((group) => group.ids)).toEqual([['o1'], ['o2']]);
  });

  it('switches a column to the newest leaf of its other version', () => {
    const groups = replyGroups(history, 'b1')!;
    expect(switchGroupVersion(history, groups[0]!, -1)).toBe('a1');
    expect(switchGroupVersion(history, groups[0]!, 1)).toBeNull();
    expect(switchGroupVersion(history, { ...groups[1]!, ids: ['b1', 'b2'], shownId: 'b2' }, -1)).toBe('u2');
  });

  it('knows when every shown answer is done', () => {
    const groups = replyGroups(history, 'b1')!;
    expect(groupsDone(history, groups)).toBe(true);
    const running: ChatHistory = { ...history, messages: { ...history.messages, a2: { ...history.messages.a2!, done: false } } };
    expect(groupsDone(running, groups)).toBe(false);
  });

  it('builds the merge request from the shown answers and reads a merged answer back', () => {
    const groups = replyGroups(history, 'b1')!;
    expect(mergeInput(history, groups, 'b1')).toEqual({ model: 'm-b', prompt: 'Question', responses: ['From output', 'answer b1'] });
    expect(mergeInput(history, groups, 'b1', 'chat-1').chatId).toBe('chat-1');
    expect(mergedResponse({ ...history.messages.b1!, merged: { status: true, content: 'Both' } })).toEqual({ status: true, content: 'Both', timestamp: undefined });
    expect(mergedResponse(history.messages.b1)).toBeNull();
    expect(mergedResponse({ ...history.messages.b1!, merged: { status: false, content: 'x' } })).toBeNull();
  });
});

describe('merging', () => {
  it('reads streamed pieces across chunk boundaries, dropping a leading line break', () => {
    const reader = new CompletionTextReader();
    reader.push('data: {"choices":[{"delta":{"content":"\\n"}}]}\n\ndata: {"choices":[{"delta":{"con');
    reader.push('tent":"Hello"}}]}\n\n: keep-alive\n\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\ndata: [DONE]\n');
    expect(reader.end()).toBe('Hello world');
  });

  it('reads one JSON answer, and throws the error a stream carries', () => {
    const whole = new CompletionTextReader();
    whole.push('{"choices":[{"message":{"content":"All at once"}}]}');
    expect(whole.end()).toBe('All at once');
    const failed = new CompletionTextReader();
    expect(() => failed.push('data: {"error":{"message":"Model is busy"}}\n')).toThrow('Model is busy');
  });

  it('streams from the merge endpoint and reports the text as it grows', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const encoder = new TextEncoder();
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"One"}}]}\n\n'));
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":" two"}}]}\n\ndata: [DONE]\n\n'));
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
    const seen: string[] = [];
    const text = await mergeResponses(new OwuiClient({ baseUrl: 'https://x.test', token: 't', fetch }), { model: 'm', prompt: 'p', responses: ['a', 'b'], chatId: 'c1' }, (so) => seen.push(so));
    expect(text).toBe('One two');
    expect(seen).toEqual(['One', 'One two', 'One two']);
    expect(calls).toEqual([{ url: 'https://x.test/api/v1/tasks/moa/completions', body: { model: 'm', prompt: 'p', responses: ['a', 'b'], stream: true, chat_id: 'c1' } }]);
  });

  it('throws the server refusal before reading', async () => {
    const fetch: FetchLike = async () => new Response(JSON.stringify({ detail: 'Model not found' }), { status: 404 });
    await expect(mergeResponses(new OwuiClient({ baseUrl: 'https://x.test', fetch }), { model: 'm', prompt: 'p', responses: [] })).rejects.toBeInstanceOf(OwuiHttpError);
  });
});

describe('choosing several models', () => {
  const models = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }] as ModelItem[];

  it('starts with your saved models, else the server defaults, else the first', () => {
    expect(defaultModelIds(models, { ui: { models: ['b', 'gone', 'c'] } }, { default_models: 'a' } as never)).toEqual(['b', 'c']);
    expect(defaultModelIds(models, { ui: { models: ['gone'] } }, { default_models: 'c, a' } as never)).toEqual(['c', 'a']);
    expect(defaultModelIds(models, undefined, undefined)).toEqual(['a']);
    expect(defaultModelIds([], undefined, undefined)).toEqual([]);
  });

  it('adds and removes with Compare on, keeping one; replaces with it off', () => {
    expect(pickModelIds(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(pickModelIds(['a', 'b'], 'a', true)).toEqual(['b']);
    expect(pickModelIds(['a'], 'a', true)).toEqual(['a']);
    expect(pickModelIds(['a', 'b'], 'c', false)).toEqual(['c']);
  });

  it('labels the input bar with the first model and how many more', () => {
    expect(modelsLabel(['A', 'B', 'C'])).toBe('A +2');
    expect(modelsLabel(['A'])).toBe('A');
    expect(modelsLabel([])).toBe('Select a model');
  });
});
