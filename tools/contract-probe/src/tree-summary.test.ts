import { describe, expect, it } from 'vitest';
import { summarizeTree } from './tree-summary';

describe('summarizeTree', () => {
  it('counts roles, branches, multi-model turns and output items without content', () => {
    const chat = {
      id: 'c1',
      title: 'secret title',
      chat: {
        models: ['a', 'b'],
        history: {
          currentId: 'm3',
          messages: {
            m1: { id: 'm1', role: 'user', content: 'hi', models: ['a', 'b'], childrenIds: ['m2', 'm3'] },
            m2: { id: 'm2', role: 'assistant', content: 'x', modelIdx: 0, output: [{ type: 'message' }, { type: 'reasoning' }] },
            m3: { id: 'm3', role: 'assistant', content: 'y', modelIdx: 1, output: [{ type: 'message' }] },
          },
        },
      },
    };

    const summary = summarizeTree(chat);
    expect(summary).toEqual({
      messageCount: 3,
      roles: { user: 1, assistant: 2 },
      branchPoints: 1,
      multiModelTurns: 1,
      withOutput: 2,
      withModelIdx: 2,
      outputItemTypes: ['message', 'reasoning'],
      messageKeys: ['childrenIds', 'content', 'id', 'modelIdx', 'models', 'output', 'role'],
      hasCurrentId: true,
      chatKeys: ['chat', 'id', 'title'],
      innerKeys: ['history', 'models'],
    });
    expect(JSON.stringify(summary)).not.toContain('secret');
  });

  it('copes with malformed chats', () => {
    expect(summarizeTree({}).messageCount).toBe(0);
    expect(summarizeTree({ chat: { history: { messages: null } } }).hasCurrentId).toBe(false);
  });
});
