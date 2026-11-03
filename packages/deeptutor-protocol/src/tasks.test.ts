import { describe, expect, it } from 'vitest';
import { DtClient } from './http';
import { createTask, dueMatches, getTaskBoard, isOverdue, linkSessionTasks, sessionStatusColor, updateTask } from './tasks';

function client(...answers: unknown[]) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const dt = new DtClient({
    baseUrl: 'https://learn.example.com',
    token: 'tok',
    fetch: async (url, init) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(answers.shift() ?? {}), { status: 200 });
    },
  });
  return { dt, calls };
}

const board = {
  cards: [
    { id: 'c1', title: 'Read chapter 3', note: '', status: 'doing', archived: false, created_at: 'a', updated_at: 'b', workspace_id: null, due_date: '2026-11-03' },
    { id: 'c2', title: 'Old', note: 'x', status: 'nope', archived: true, created_at: 'a', updated_at: 'b', workspace_id: null, due_date: null },
  ],
  colors: { todo: '#111111', doing: '#222222', done: 'red' },
  session_links: [{ workspace_id: '', session_id: 's1', task_ids: ['c2', 'c1'], status_link_enabled: true }],
  revision: 4,
};

describe('task board', () => {
  it('reads the board, keeping DeepTutor defaults for what is odd', async () => {
    const { dt } = client(board);
    const read = await getTaskBoard(dt);
    expect(read.cards.map((card) => [card.id, card.status, card.archived, card.dueDate])).toEqual([
      ['c1', 'doing', false, '2026-11-03'],
      ['c2', 'todo', true, null],
    ]);
    expect(read.colors).toEqual({ todo: '#111111', doing: '#222222', done: '#15803d' });
    // The last linked card colours the chat.
    expect(sessionStatusColor(read, 's1')).toBe('#222222');
    expect(sessionStatusColor(read, 'other')).toBeUndefined();
  });

  it('sends only what changes, with null clearing the due date', async () => {
    const { dt, calls } = client(board, board, board);
    await createTask(dt, { title: '  New  ', dueDate: '2026-11-05' });
    await updateTask(dt, 'c 1', { status: 'done', dueDate: null });
    await linkSessionTasks(dt, 's1', ['c1']);
    expect(calls.map((call) => [call.method, call.url.replace('https://learn.example.com', ''), call.body])).toEqual([
      ['POST', '/api/task-board/cards', { title: 'New', due_date: '2026-11-05' }],
      ['PATCH', '/api/task-board/cards/c%201', { status: 'done', due_date: null }],
      ['PUT', '/api/task-board/sessions/s1', { workspace_id: '', task_ids: ['c1'] }],
    ]);
  });

  it('filters by due day and week, and knows overdue', () => {
    const card = (dueDate: string | null) => ({ dueDate });
    expect(dueMatches(card('2026-11-03'), 'today', '2026-11-03', '2026-11-02', '2026-11-09')).toBe(true);
    expect(dueMatches(card('2026-11-08'), 'week', '2026-11-03', '2026-11-02', '2026-11-09')).toBe(true);
    expect(dueMatches(card('2026-11-09'), 'week', '2026-11-03', '2026-11-02', '2026-11-09')).toBe(false);
    expect(dueMatches(card(null), 'all', '2026-11-03', '', '')).toBe(true);
    expect(isOverdue({ dueDate: '2026-11-02', status: 'todo' }, '2026-11-03')).toBe(true);
    expect(isOverdue({ dueDate: '2026-11-02', status: 'done' }, '2026-11-03')).toBe(false);
  });
});
