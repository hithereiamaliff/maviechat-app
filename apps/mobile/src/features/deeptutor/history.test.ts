import type { DtSessionSummary } from '@maviechat/deeptutor-protocol';
import { describe, expect, it } from 'vitest';
import { filterHistory } from './history';

const chat = (id: string, preferences: Record<string, unknown> = {}): DtSessionSummary => ({ id, title: id, preferences });
const all = [chat('a'), chat('b', { archived: true }), chat('t', { session_kind: 'selection_tutor', parent_session_id: 'a' }), chat('u', { session_kind: 'selection_tutor', archived: true })];
const ids = (list: DtSessionSummary[]) => list.map((item) => item.id);

describe('filterHistory', () => {
  it('shows active chats and threads by default choice', () => {
    expect(ids(filterHistory(all, 'active', 'all'))).toEqual(['a', 't']);
  });
  it('narrows to archived, main chats or threads', () => {
    expect(ids(filterHistory(all, 'archived', 'all'))).toEqual(['b', 'u']);
    expect(ids(filterHistory(all, 'all', 'main'))).toEqual(['a', 'b']);
    expect(ids(filterHistory(all, 'all', 'threads'))).toEqual(['t', 'u']);
  });
});
