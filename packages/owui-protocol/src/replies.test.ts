import { describe, expect, it } from 'vitest';
import type { ChatRecord } from './chats';
import { buildCompletionRequest, buildContinueTurn } from './completions';
import type { ChatHistory, HistoryMessage } from './history';
import type { ModelItem } from './models';
import {
  chatActionBody,
  editableTexts,
  mergeActionMessages,
  modelActions,
  ratingFeedback,
  replyCopy,
  scoreAllowed,
  withEditedTexts,
} from './replies';

const message = (id: string, role: string, parentId: string | null, extra: Partial<HistoryMessage> = {}): HistoryMessage => ({
  id,
  role,
  parentId,
  childrenIds: [],
  content: '',
  ...extra,
});

function chat(): ChatHistory {
  const u = message('u1', 'user', null, { content: 'Hi', childrenIds: ['a1', 'a2'] });
  const a1 = message('a1', 'assistant', 'u1', { content: 'Hello there', model: 'gpt', done: true, annotation: { rating: 1 }, feedbackId: 'f1' });
  const a2 = message('a2', 'assistant', 'u1', { content: 'Hey', model: 'llama', done: true });
  return { messages: { u1: u, a1, a2 }, currentId: 'a1' };
}

const structured = message('s1', 'assistant', 'u1', {
  output: [
    { type: 'message', content: [{ type: 'output_text', text: 'Let me look.' }] },
    { type: 'function_call', call_id: 'c1', name: 'search', arguments: '{}' },
    { type: 'function_call_output', call_id: 'c1', output: [{ type: 'input_text', text: 'found' }] },
    { type: 'message', content: [{ type: 'output_text', text: 'Here it is.' }] },
  ],
});

describe('editing a reply', () => {
  it('edits plain text, keeping the original', () => {
    const reply = chat().messages.a1!;
    expect(editableTexts(reply)).toEqual({ texts: ['Hello there'], structured: false });
    expect(withEditedTexts(reply, ['Hi again'])).toMatchObject({ content: 'Hi again', originalContent: 'Hello there' });
  });

  it('edits each text block of structured output, keeping the steps in place', () => {
    expect(editableTexts(structured)).toEqual({ texts: ['Let me look.', 'Here it is.'], structured: true });
    const edited = withEditedTexts(structured, ['Searching.', 'Done: found it.']);
    expect(edited.content).toBe('');
    expect(edited.output?.map((item) => item.type)).toEqual(['message', 'function_call', 'function_call_output', 'message']);
    expect(edited.output?.[3]).toMatchObject({ content: [{ type: 'output_text', text: 'Done: found it.' }] });
  });

  it('saves a copy as a new version beside the original, without its rating', () => {
    const { copy, parent } = replyCopy(chat(), 'a1', ['Edited'], { newId: 'a3', now: new Date(2000_000) });
    expect(copy).toMatchObject({ id: 'a3', parentId: 'u1', childrenIds: [], content: 'Edited', model: 'gpt', timestamp: 2000 });
    expect(copy.annotation).toBeUndefined();
    expect(copy.feedbackId).toBeUndefined();
    expect(copy.originalContent).toBeUndefined();
    expect(parent?.childrenIds).toEqual(['a1', 'a2', 'a3']);
  });
});

describe('rating a reply', () => {
  it('builds the evaluation record the web keeps', () => {
    const history = chat();
    const record = { id: 'c1', chat: { history } } as unknown as ChatRecord;
    const models = [{ id: 'gpt', info: { base_model_id: 'gpt-4o' } }, { id: 'llama', info: {} }] as unknown as ModelItem[];
    const feedback = ratingFeedback({ history, message: history.messages.a1!, annotation: { rating: 1, reason: 'accurate_information' }, chatId: 'c1', chat: record, models });
    expect(feedback).toEqual({
      type: 'rating',
      data: { rating: 1, reason: 'accurate_information', model_id: 'gpt', sibling_model_ids: ['llama'] },
      meta: { arena: false, model_id: 'gpt', message_id: 'a1', message_index: 2, chat_id: 'c1', base_models: { gpt: 'gpt-4o', llama: null } },
      snapshot: { chat: record },
    });
  });

  it('keeps scores to the side of the thumb', () => {
    expect(scoreAllowed(1, 6)).toBe(true);
    expect(scoreAllowed(1, 5)).toBe(false);
    expect(scoreAllowed(-1, 5)).toBe(true);
    expect(scoreAllowed(-1, 6)).toBe(false);
    expect(scoreAllowed(undefined, 8)).toBe(false);
  });
});

describe('action buttons', () => {
  it("reads a model's actions and sends the conversation up to the reply", () => {
    const model = { id: 'gpt', name: 'GPT', actions: [{ id: 'summarize', name: 'Summarize' }, { name: 'broken' }] } as unknown as ModelItem;
    expect(modelActions(model).map((action) => action.id)).toEqual(['summarize']);
    expect(modelActions(undefined)).toEqual([]);
    const history = chat();
    history.messages.a1 = { ...history.messages.a1!, output: [{ type: 'message', content: [{ type: 'output_text', text: 'From output' }] }] };
    const body = chatActionBody({ history, messageId: 'a1', model, chatId: 'c1', sessionId: 's1' });
    expect(body).toMatchObject({ model: 'gpt', chat_id: 'c1', session_id: 's1', id: 'a1', model_item: model });
    expect((body.messages as { id: string; content: string }[]).map((item) => [item.id, item.content])).toEqual([
      ['u1', 'Hi'],
      ['a1', 'From output'],
    ]);
  });

  it('merges what an action changed, keeping the earlier text', () => {
    const merged = mergeActionMessages(chat(), [{ id: 'a1', content: 'Summary' }, { id: 'nope', content: 'x' }]);
    expect(merged.messages.a1).toMatchObject({ content: 'Summary', originalContent: 'Hello there', model: 'gpt' });
    expect(merged.messages.nope).toBeUndefined();
    expect(mergeActionMessages(chat(), undefined)).toEqual(chat());
  });
});

describe('continuing a reply', () => {
  it('carries the reply on in place, named as the one to continue', () => {
    const turn = buildContinueTurn({ history: chat(), messageId: 'a1' });
    expect(turn.replies.map((reply) => [reply.id, reply.done])).toEqual([['a1', false]]);
    expect(turn.userMessage.id).toBe('u1');
    expect(turn.history.currentId).toBe('a1');
    const body = buildCompletionRequest({
      turn,
      chatId: 'c1',
      sessionId: 's1',
      model: { id: 'gpt', name: 'GPT' } as ModelItem,
      features: {},
      variables: {},
      tasks: {},
      continueMessageId: 'a1',
    });
    expect(body).toMatchObject({ id: 'a1', assistant_message_id: 'a1', parent_id: null, user_message: { id: 'u1' } });
    expect(body.message_ids).toBeUndefined();
    expect(() => buildContinueTurn({ history: chat(), messageId: 'u1' })).toThrow();
  });
});
