import { describe, expect, it } from 'vitest';
import type { HistoryMessage } from './history';
import { OwuiClient, type FetchLike } from './http';
import { askUserComplete, askUserPayload, askUserQuestions, awaitingYou, pendingApprovals, pendingAskUser, resolveToolCall, toolArguments } from './interactions';
import { attachWebAddress, isWebAddress, knowledgeAttachment, searchKnowledgeBases, searchKnowledgeFiles } from './knowledge';
import { outputToBlocks } from './output';
import { applyInputVariables, fillBuiltinVariables, inputVariables, listPrompts, matchPrompts, menuTrigger, replaceTrigger } from './prompts';

const reply = (output: unknown[]): HistoryMessage => ({ id: 'r1', parentId: 'u1', childrenIds: [], role: 'assistant', content: '', done: false, output: output as HistoryMessage['output'] });

const askArgs = JSON.stringify({
  questions: [
    { id: 'colour', header: 'Colour', question: 'Which colour?', options: [{ label: 'Teal', description: 'Calm' }, { label: 'Orange', description: 'Warm' }] },
    { id: 'size', question: 'Which size?', options: [{ label: 'S' }, { label: '' }, { label: 'L' }], allow_other: false },
    { id: '', question: 'dropped' },
  ],
  allow_other: true,
});

function client(answer: unknown = {}) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(answer), { status: 200 });
  };
  return { owui: new OwuiClient({ baseUrl: 'https://chat.test', token: 't', fetch }), calls };
}

describe('replies that wait for you', () => {
  it('finds tool calls waiting for approval, but not answered or ask_user ones', () => {
    const message = reply([
      { type: 'function_call', call_id: 'c1', name: 'search_web', status: 'pending', arguments: '"{\\"q\\":\\"tea\\"}"' },
      { type: 'function_call', call_id: 'c2', name: 'done_already', status: 'pending', arguments: '{}' },
      { type: 'function_call_output', call_id: 'c2', output: [] },
      { type: 'function_call', id: 'c3', name: 'fetch', status: 'requires_approval' },
      { type: 'function_call', call_id: 'c4', name: 'ask_user', status: 'pending', arguments: askArgs },
      { type: 'function_call', call_id: 'c5', name: 'ran', status: 'completed' },
    ]);
    expect(pendingApprovals(message)).toEqual([
      { callId: 'c1', name: 'search_web', argumentsText: '{\n  "q": "tea"\n}' },
      { callId: 'c3', name: 'fetch', argumentsText: '' },
    ]);
    expect(awaitingYou(message)).toBe(true);
    expect(awaitingYou(reply([{ type: 'message', content: [] }]))).toBe(false);
  });

  it("reads the model's questions: header defaults, options without a label dropped, Other per question", () => {
    const pending = pendingAskUser(reply([{ type: 'function_call', call_id: 'c4', name: 'ask_user', status: 'pending', arguments: askArgs }]));
    expect(pending?.callId).toBe('c4');
    expect(pending?.questions).toEqual([
      { id: 'colour', header: 'Colour', question: 'Which colour?', options: [{ label: 'Teal', description: 'Calm' }, { label: 'Orange', description: 'Warm' }], allowOther: true },
      { id: 'size', header: 'Question 2', question: 'Which size?', options: [{ label: 'S', description: '' }, { label: 'L', description: '' }], allowOther: false },
    ]);
    expect(pendingAskUser(reply([{ type: 'function_call', call_id: 'c4', name: 'ask_user', status: 'completed', arguments: askArgs }]))).toBeNull();
    expect(askUserQuestions('nope')).toEqual([]);
    expect(toolArguments(JSON.stringify(JSON.stringify({ a: 1 })))).toEqual({ a: 1 });
    expect(toolArguments('not json')).toEqual({});
  });

  it('knows when every question is answered and sends the answers trimmed', () => {
    const questions = pendingAskUser(reply([{ type: 'function_call', call_id: 'c4', name: 'ask_user', status: 'pending', arguments: askArgs }]))!.questions;
    const answers = { colour: { type: 'option' as const, option_index: 0, label: 'Teal', description: 'Calm' }, size: { type: 'other' as const, text: '  medium ' } };
    expect(askUserComplete(questions, { colour: answers.colour })).toBe(false);
    expect(askUserComplete(questions, { ...answers, size: { type: 'other', text: '  ' } })).toBe(false);
    expect(askUserComplete(questions, answers)).toBe(true);
    expect(askUserPayload(questions, answers)).toEqual({ colour: answers.colour, size: { type: 'other', text: 'medium' } });
  });

  it('resolves with the call, the action and any answers', async () => {
    const { owui, calls } = client({ status: true, task_ids: ['t1'] });
    expect(await resolveToolCall(owui, 'chat 1', 'm1', 'c1', 'approve')).toMatchObject({ task_ids: ['t1'] });
    await resolveToolCall(owui, 'chat 1', 'm1', 'c4', 'answer', { answers: { colour: { type: 'other', text: 'blue' } }, timedOut: true });
    expect(calls).toEqual([
      { url: 'https://chat.test/api/v1/chats/chat%201/messages/m1/resolve', method: 'POST', body: { call_id: 'c1', action: 'approve' } },
      { url: 'https://chat.test/api/v1/chats/chat%201/messages/m1/resolve', method: 'POST', body: { call_id: 'c4', action: 'answer', answers: { colour: { type: 'other', text: 'blue' } }, timed_out: true } },
    ]);
  });

  it('shows a waiting or denied tool step as not running, and a finished reply\'s steps as finished', () => {
    const blocks = outputToBlocks(
      [
        { type: 'function_call', call_id: 'c1', name: 'search_web', status: 'pending' },
        { type: 'function_call', call_id: 'c2', name: 'fetch', status: 'rejected' },
        { type: 'reasoning', id: 'r', status: 'in_progress', content: [{ type: 'output_text', text: 'hm' }] },
      ] as never,
      true,
    );
    expect(blocks.map((block) => [block.kind, (block as { done?: boolean }).done, (block as { waiting?: boolean }).waiting ?? false, (block as { rejected?: boolean }).rejected ?? false])).toEqual([
      ['tool', true, true, false],
      ['tool', true, false, true],
      ['reasoning', true, false, false],
    ]);
  });
});

describe('saved prompts and their variables', () => {
  it('lists prompts by name, without the slash', async () => {
    const { owui } = client([
      { command: '/summarise', name: 'Summarise', content: 'Sum up {{text}}' },
      { command: 'answer', title: 'Answer', content: 'x' },
      { command: '', content: 'no command' },
    ]);
    const prompts = await listPrompts(owui);
    expect(prompts.map((prompt) => `${prompt.command}:${prompt.name}`)).toEqual(['answer:Answer', 'summarise:Summarise']);
    expect(matchPrompts(prompts, 'SUM').map((prompt) => prompt.command)).toEqual(['summarise']);
  });

  it('fills in the built-in variables, leaving unknown profile ones as they are', () => {
    const now = new Date(2026, 10, 3, 9, 5, 7);
    const text = fillBuiltinVariables('{{USER_NAME}} {{CURRENT_DATE}} {{CURRENT_TIME}} {{CURRENT_WEEKDAY}} {{USER_AGE}} {{USER_BIO}} {{USER_LOCATION}} {{CLIPBOARD}} {{topic}}', {
      name: 'Ana',
      birthDate: '2000-11-04',
      clipboard: 'a\r\nb',
      now,
      timeZone: 'Asia/Kuala_Lumpur',
    });
    expect(text).toBe('Ana 2026-11-03 09:05:07 Tuesday 25 {{USER_BIO}} LOCATION_UNKNOWN a\nb {{topic}}');
    expect(fillBuiltinVariables('{{CLIPBOARD}}', { name: '' })).toBe('{{CLIPBOARD}}');
  });

  it('reads the variables a prompt asks for, with their types and settings', () => {
    const variables = inputVariables(
      'Write about {{topic}} in a {{tone | select:options=["Formal","Casual"]:required}} way, {{ words | number:min=50:max=500:default=100 }} words. {{notes|textarea:placeholder="Anything else"}} {{topic}} {{agree | type=checkbox}}',
    );
    expect(variables).toEqual([
      { name: 'topic', type: 'text', placeholder: undefined, default: undefined, required: false, options: [], min: undefined, max: undefined, step: undefined },
      { name: 'tone', type: 'select', placeholder: undefined, default: undefined, required: true, options: ['Formal', 'Casual'], min: undefined, max: undefined, step: undefined },
      { name: 'words', type: 'number', placeholder: undefined, default: '100', required: false, options: [], min: 50, max: 500, step: undefined },
      { name: 'notes', type: 'textarea', placeholder: 'Anything else', default: undefined, required: false, options: [], min: undefined, max: undefined, step: undefined },
      { name: 'agree', type: 'checkbox', placeholder: undefined, default: undefined, required: false, options: [], min: undefined, max: undefined, step: undefined },
    ]);
    expect(applyInputVariables('{{topic}} and {{ tone | select:options=["a:b"] }} and {{missing}}', { topic: 'tea', tone: 'Casual' })).toBe('tea and Casual and {{missing}}');
  });

  it('spots a menu being typed at the cursor and replaces it on picking', () => {
    expect(menuTrigger('Ask @gp', 7)).toEqual({ char: '@', query: 'gp', start: 4 });
    expect(menuTrigger('/sum', 4)).toEqual({ char: '/', query: 'sum', start: 0 });
    expect(menuTrigger('see https://x.y/z', 17)).toBeNull();
    expect(menuTrigger('mail me@x.com', 13)).toBeNull();
    expect(menuTrigger('# ', 2)).toBeNull();
    expect(menuTrigger('look #note here', 10)).toEqual({ char: '#', query: 'note', start: 5 });
    const trigger = menuTrigger('Hi /sum please', 7)!;
    expect(replaceTrigger('Hi /sum please', trigger, 7, 'Summarise:')).toEqual({ text: 'Hi Summarise: please', cursor: 13 });
  });
});

describe('knowledge and web pages for the menus', () => {
  it('reads knowledge bases and files, and attaches them as the web does', async () => {
    const { owui, calls } = client({ items: [{ id: 'k1', name: 'Recipes', description: 'Food', extra: 1 }, { name: 'no id' }] });
    const bases = await searchKnowledgeBases(owui, 'rec');
    expect(bases).toEqual([{ kind: 'collection', id: 'k1', name: 'Recipes', description: 'Food', raw: { id: 'k1', name: 'Recipes', description: 'Food', extra: 1 } }]);
    expect(calls[0]!.url).toBe('https://chat.test/api/v1/knowledge/search?query=rec');
    expect(knowledgeAttachment(bases[0]!)).toMatchObject({ type: 'collection', id: 'k1', name: 'Recipes', status: 'processed', extra: 1 });
    const files = await searchKnowledgeFiles(client({ items: [{ id: 'f1', filename: 'soup.pdf', collection: { name: 'Recipes' } }] }).owui, '');
    expect(files[0]).toMatchObject({ kind: 'file', id: 'f1', name: 'soup.pdf', description: 'Recipes' });
  });

  it('accepts plain web addresses and attaches a page as its text', async () => {
    expect(isWebAddress('https://example.com/a?b=1')).toBe(true);
    expect(isWebAddress('example.com')).toBe(false);
    expect(isWebAddress('https://')).toBe(false);
    const { owui, calls } = client({ type: 'text', name: 'Example', content: 'Hello page', url: 'https://example.com/', collection_name: 'web-1' });
    const item = await attachWebAddress(owui, ' https://example.com ');
    expect(calls[0]).toMatchObject({ url: 'https://chat.test/api/v1/retrieval/process/url', body: { url: 'https://example.com', collection_name: null } });
    expect(item).toMatchObject({ type: 'text', name: 'Example', url: 'https://example.com/', status: 'uploaded', file: { data: { content: 'Hello page' } } });
    const image = await attachWebAddress(client({ type: 'image', name: 'cat.png', file: { id: 'img1', meta: { content_type: 'image/png', size: 9 } } }).owui, 'https://x.test/cat.png');
    expect(image).toMatchObject({ type: 'image', id: 'img1', url: 'img1', content_type: 'image/png', size: 9 });
  });
});
