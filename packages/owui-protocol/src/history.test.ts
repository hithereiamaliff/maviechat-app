import { describe, expect, it } from 'vitest';
import { branchPath, initialLeaf, newestLeaf, siblingIds, siblingPosition, switchSibling, type ChatHistory, type HistoryMessage } from './history';

function msg(id: string, parentId: string | null, childrenIds: string[] = [], role = 'user'): HistoryMessage {
  return { id, parentId, childrenIds, role, content: id };
}

// u1 → (a1, a2); a1 → u2 → a3; a2 → u3 → (a4, a5)
const history: ChatHistory = {
  currentId: 'a3',
  messages: {
    u1: msg('u1', null, ['a1', 'a2']),
    a1: msg('a1', 'u1', ['u2'], 'assistant'),
    a2: msg('a2', 'u1', ['u3'], 'assistant'),
    u2: msg('u2', 'a1', ['a3']),
    a3: msg('a3', 'u2', [], 'assistant'),
    u3: msg('u3', 'a2', ['a4', 'a5']),
    a4: msg('a4', 'u3', [], 'assistant'),
    a5: msg('a5', 'u3', [], 'assistant'),
  },
};

describe('history tree', () => {
  it('walks the shown branch from the root', () => {
    expect(branchPath(history).map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a3']);
    expect(branchPath(history, 'a4').map((m) => m.id)).toEqual(['u1', 'a2', 'u3', 'a4']);
  });

  it('survives missing parents and cycles', () => {
    const broken: ChatHistory = { currentId: 'x', messages: { x: msg('x', 'missing'), y: msg('y', 'z'), z: msg('z', 'y') } };
    expect(branchPath(broken).map((m) => m.id)).toEqual(['x']);
    expect(branchPath(broken, 'y').map((m) => m.id)).toEqual(['z', 'y']);
    expect(branchPath({ currentId: null, messages: {} })).toEqual([]);
  });

  it('finds siblings, including root messages', () => {
    expect(siblingIds(history, 'a2')).toEqual(['a1', 'a2']);
    expect(siblingIds(history, 'u1')).toEqual(['u1']);
    expect(siblingPosition(history, 'a2')).toEqual({ index: 1, count: 2 });
  });

  it('switching a branch lands on the newest leaf below the sibling', () => {
    expect(newestLeaf(history, 'a2')).toBe('a5');
    expect(switchSibling(history, 'a1', 1)).toBe('a5');
    expect(switchSibling(history, 'a2', -1)).toBe('a3');
    expect(switchSibling(history, 'a1', -1)).toBeNull();
    expect(switchSibling(history, 'a5', 1)).toBeNull();
  });

  it('opens on the server current message, then currentId, then the newest root leaf', () => {
    expect(initialLeaf(history, 'a4')).toBe('a4');
    expect(initialLeaf(history, 'gone')).toBe('a3');
    expect(initialLeaf({ ...history, currentId: null })).toBe('a5');
    expect(initialLeaf({ currentId: null, messages: {} })).toBeNull();
  });
});
