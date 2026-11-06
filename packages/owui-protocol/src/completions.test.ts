import { describe, expect, it } from 'vitest';
import {
  buildCompletionRequest,
  buildRegenerateTurn,
  buildTurn,
  chatFeatures,
  isTemporaryChatId,
  temporaryChatId,
  temporaryChatMessages,
} from './completions';
import type { ChatHistory } from './history';
import { uuidv4 } from './ids';
import { templateVariables } from './variables';

function counter() {
  let n = 0;
  return () => `id-${++n}`;
}

const history: ChatHistory = {
  currentId: 'a0',
  messages: {
    u0: { id: 'u0', parentId: null, childrenIds: ['a0'], role: 'user', content: 'Hi' },
    a0: { id: 'a0', parentId: 'u0', childrenIds: [], role: 'assistant', content: 'Hello', done: true },
  },
};

describe('buildTurn', () => {
  it('adds the user message under the shown leaf and one placeholder per model', () => {
    const turn = buildTurn({
      history,
      content: 'Next?',
      models: [{ id: 'gpt', name: 'GPT' }],
      now: new Date(1_700_000_000_000),
      newId: counter(),
    });
    expect(turn.userMessage).toEqual({
      id: 'id-1',
      parentId: 'a0',
      childrenIds: ['id-2'],
      role: 'user',
      content: 'Next?',
      timestamp: 1_700_000_000,
      models: ['gpt'],
    });
    expect(turn.replies).toEqual([
      {
        id: 'id-2',
        parentId: 'id-1',
        childrenIds: [],
        role: 'assistant',
        content: '',
        done: false,
        model: 'gpt',
        modelName: 'GPT',
        modelIdx: 0,
        timestamp: 1_700_000_000,
      },
    ]);
    expect(turn.messageIds).toEqual([{ model_id: 'gpt', message_id: 'id-2', modelIdx: 0 }]);
    expect(turn.history.currentId).toBe('id-2');
    expect(turn.history.messages.a0?.childrenIds).toEqual(['id-1']);
    // The input history is untouched.
    expect(history.messages.a0?.childrenIds).toEqual([]);
    expect(Object.keys(history.messages)).toEqual(['u0', 'a0']);
  });

  it('starts a new chat at the root', () => {
    const turn = buildTurn({ history: { messages: {}, currentId: null }, content: 'First', models: [{ id: 'm', name: 'M' }], newId: counter() });
    expect(turn.userMessage.parentId).toBeNull();
    expect(Object.keys(turn.history.messages)).toEqual(['id-1', 'id-2']);
  });
});

describe('buildCompletionRequest', () => {
  const turn = buildTurn({ history, content: 'Next?', models: [{ id: 'gpt', name: 'GPT' }], newId: counter() });
  const base = {
    turn,
    sessionId: 'sock-1',
    model: { id: 'gpt', name: 'GPT' },
    features: { voice: false, web_search: false, image_generation: false, code_interpreter: false },
    variables: { '{{USER_NAME}}': 'Test' },
    tasks: {},
  };

  it('matches the 0.11.3 web payload for an existing chat', () => {
    const body = buildCompletionRequest({ ...base, chatId: 'c1', system: '', params: { temperature: 0.2 } });
    expect(body).toEqual({
      stream: true,
      model: 'gpt',
      params: { temperature: 0.2 },
      tool_servers: [],
      features: base.features,
      variables: base.variables,
      model_item: base.model,
      session_id: 'sock-1',
      chat_id: 'c1',
      id: 'id-2',
      message_ids: [{ model_id: 'gpt', message_id: 'id-2', modelIdx: 0 }],
      parent_id: 'a0',
      user_message: turn.userMessage,
      background_tasks: { follow_up_generation: true },
    });
  });

  it('omits chat_id for a new chat and asks for a title and tags', () => {
    const body = buildCompletionRequest({ ...base, chatId: null, tasks: { followUps: false } });
    expect(body).not.toHaveProperty('chat_id');
    expect(body.background_tasks).toEqual({ title_generation: true, tags_generation: true, follow_up_generation: false });
  });

  it('sends only the system prompt as messages', () => {
    expect(buildCompletionRequest({ ...base, chatId: 'c1', system: '  Be brief.  ' }).messages).toEqual([{ role: 'system', content: 'Be brief.' }]);
  });

  it('names the system the model works on, only when there is one', () => {
    expect(buildCompletionRequest({ ...base, chatId: 'c1', terminalId: 'box-1' }).terminal_id).toBe('box-1');
    expect(buildCompletionRequest({ ...base, chatId: 'c1', terminalId: null })).not.toHaveProperty('terminal_id');
  });
});

describe('chatFeatures', () => {
  it('only passes toggles the server allows', () => {
    const allowed = { feature: (id: string) => id === 'webSearch' };
    expect(chatFeatures(allowed as never, { webSearch: true, imageGeneration: true }, true)).toEqual({
      voice: false,
      image_generation: false,
      code_interpreter: false,
      web_search: true,
      memory: true,
    });
  });
});

describe('templateVariables', () => {
  it('formats like the web app', () => {
    const now = new Date(2026, 10, 1, 9, 5, 7); // Sunday
    expect(templateVariables({ name: 'Ali', timeZone: 'Asia/Kuala_Lumpur' }, now)).toEqual({
      '{{USER_NAME}}': 'Ali',
      '{{USER_EMAIL}}': 'Unknown',
      '{{USER_LOCATION}}': 'Unknown',
      '{{CURRENT_DATETIME}}': '2026-11-01 09:05:07',
      '{{CURRENT_DATE}}': '2026-11-01',
      '{{CURRENT_TIME}}': '09:05:07',
      '{{CURRENT_WEEKDAY}}': 'Sunday',
      '{{CURRENT_TIMEZONE}}': 'Asia/Kuala_Lumpur',
      '{{USER_LANGUAGE}}': 'en-US',
    });
  });
});

describe('uuidv4', () => {
  it('produces distinct v4 UUIDs', () => {
    const ids = new Set(Array.from({ length: 200 }, () => uuidv4()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('regenerate and temporary chats', () => {
  it('adds a sibling reply under the same user message', () => {
    const turn = buildRegenerateTurn({ history, userMessageId: 'u0', model: { id: 'gpt', name: 'GPT' }, newId: () => 'r2' });
    expect(turn.userMessage.childrenIds).toEqual(['a0', 'r2']);
    expect(turn.replies[0]).toMatchObject({ id: 'r2', parentId: 'u0', done: false, model: 'gpt', modelIdx: 0 });
    expect(turn.history.currentId).toBe('r2');
    expect(history.messages.u0?.childrenIds).toEqual(['a0']);
    expect(() => buildRegenerateTurn({ history, userMessageId: 'gone', model: { id: 'm', name: 'M' } })).toThrow();
  });

  it('sends the regeneration prompt', () => {
    const turn = buildRegenerateTurn({ history, userMessageId: 'u0', model: { id: 'gpt', name: 'GPT' }, newId: () => 'r2' });
    const body = buildCompletionRequest({
      turn,
      chatId: 'c1',
      sessionId: 's',
      model: { id: 'gpt', name: 'GPT' },
      features: {},
      variables: {},
      tasks: {},
      regenerationPrompt: 'More Concise',
    });
    expect(body).toMatchObject({ regeneration_prompt: 'More Concise', parent_id: null, id: 'r2', user_message: { id: 'u0' } });
  });

  it('builds the full conversation for temporary chats and skips title and tags', () => {
    const branch = [
      { id: 'u', parentId: null, childrenIds: ['a'], role: 'user', content: 'Look', files: [{ type: 'image', url: 'data:image/png;base64,AA' }] },
      { id: 'a', parentId: 'u', childrenIds: [], role: 'assistant', content: 'Nice', model: 'm', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Nice' }] }] },
      { id: 'a2', parentId: 'u', childrenIds: [], role: 'assistant', content: '   ' },
    ];
    const messages = temporaryChatMessages(branch, 'Be kind');
    expect(messages).toEqual([
      { role: 'system', content: 'Be kind' },
      { role: 'user', content: [{ type: 'text', text: 'Look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } }] },
      { role: 'assistant', model: 'm', output: branch[1]?.output },
    ]);
    const turn = buildTurn({ history: { messages: {}, currentId: null }, content: 'Hi', models: [{ id: 'm', name: 'M' }], newId: counter() });
    const body = buildCompletionRequest({
      turn,
      chatId: temporaryChatId('sock'),
      sessionId: 'sock',
      model: { id: 'm', name: 'M' },
      features: {},
      variables: {},
      tasks: {},
      temporaryMessages: messages,
    });
    expect(body.chat_id).toBe('temporary:sock');
    expect(body.messages).toBe(messages);
    expect(body.background_tasks).toEqual({ follow_up_generation: true });
    expect(isTemporaryChatId('temporary:x')).toBe(true);
    expect(isTemporaryChatId('local:x')).toBe(true);
    expect(isTemporaryChatId('c1')).toBe(false);
  });
});
