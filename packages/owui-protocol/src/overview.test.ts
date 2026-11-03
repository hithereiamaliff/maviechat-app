import { describe, expect, it } from 'vitest';
import type { ChatHistory, HistoryMessage } from './history';
import { overviewRows } from './overview';

const node = (id: string, parentId: string | null, childrenIds: string[], role = 'user', content = id): HistoryMessage => ({ id, parentId, childrenIds, role, content });

describe('overview', () => {
  it('stays flat without forks and steps in at each fork, marking the shown branch', () => {
    const history: ChatHistory = {
      currentId: 'a2',
      messages: {
        u1: node('u1', null, ['a1']),
        a1: node('a1', 'u1', ['u2', 'u2b'], 'assistant', 'First\nanswer'),
        u2: node('u2', 'a1', ['a2']),
        a2: node('a2', 'u2', [], 'assistant'),
        u2b: node('u2b', 'a1', ['a3']),
        a3: node('a3', 'u2b', [], 'assistant'),
      },
    };
    const rows = overviewRows(history, 'a3');
    expect(rows.map((row) => `${row.id}:${row.indent}${row.shown ? '*' : ''}${row.version ? `(${row.version.index + 1}/${row.version.count})` : ''}`)).toEqual([
      'u1:0*',
      'a1:0*',
      'u2:1(1/2)',
      'a2:1',
      'u2b:1*(2/2)',
      'a3:1*',
    ]);
    expect(rows[1]!.text).toBe('First answer');
  });

  it('shows assistant output text, several roots as versions, and survives a cycle', () => {
    const history: ChatHistory = {
      currentId: null,
      messages: {
        r1: node('r1', null, ['x']),
        r2: node('r2', null, []),
        x: { ...node('x', 'r1', ['r1'], 'assistant', ''), output: [{ type: 'message', content: [{ type: 'output_text', text: 'From output' }] }] } as HistoryMessage,
      },
    };
    const rows = overviewRows(history, null);
    expect(rows.map((row) => [row.id, row.indent, row.version?.count ?? 0])).toEqual([
      ['r1', 0, 2],
      ['x', 0, 0],
      ['r2', 0, 2],
    ]);
    expect(rows[1]!.text).toBe('From output');
  });
});
