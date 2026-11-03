import { describe, expect, it } from 'vitest';
import { DtClient } from './http';
import { getLearningJournal, journalIsEmpty } from './journal';
import { deleteRecord, exportNotebook, updateRecord } from './notebooks';
import { searchSnippet } from './sessions';

function client(...answers: { body: string; type?: string }[]) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const dt = new DtClient({
    baseUrl: 'https://learn.example.com',
    token: 'tok',
    fetch: async (url, init) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const answer = answers.shift() ?? { body: '{}' };
      return new Response(answer.body, { status: 200, headers: { 'content-type': answer.type ?? 'application/json' } });
    },
  });
  return { dt, calls };
}

describe('notebooks', () => {
  it('changes and deletes records by notebook and record id', async () => {
    const { dt, calls } = client({ body: '{}' }, { body: '{}' });
    await updateRecord(dt, 'n 1', 'r/2', { title: 'New' });
    await deleteRecord(dt, 'n 1', 'r/2');
    expect(calls).toEqual([
      { url: 'https://learn.example.com/api/notebooks/n%201/records/r%2F2', method: 'PUT', body: { title: 'New' } },
      { url: 'https://learn.example.com/api/notebooks/n%201/records/r%2F2', method: 'DELETE', body: undefined },
    ]);
  });

  it('exports Markdown as text', async () => {
    const { dt } = client({ body: '# Notes\n\nHello', type: 'text/markdown' });
    expect(await exportNotebook(dt, 'n1')).toBe('# Notes\n\nHello');
  });
});

describe('learning journal', () => {
  it('reads what DeepTutor wrote, newest record first, and knows an empty one', async () => {
    const { dt } = client({
      body: JSON.stringify({
        mission: { topic: 'Calculus', why: 'Exam', level: 'beginner' },
        last_session: { summary: 'Limits', next_focus: 'Derivatives' },
        records: [{ id: '2', title: 'Chain rule', insight: 'Multiply the derivatives', created_at: '2026-11-02' }, { id: '1' }],
      }),
    });
    const journal = await getLearningJournal(dt);
    expect(journal.mission.topic).toBe('Calculus');
    expect(journal.last_session.next_focus).toBe('Derivatives');
    expect(journal.records.map((item) => item.title)).toEqual(['Chain rule']);
    expect(journalIsEmpty(journal)).toBe(false);
    const empty = await getLearningJournal(client({ body: '{"mission":{},"last_session":{},"records":[]}' }).dt);
    expect(journalIsEmpty(empty)).toBe(true);
  });
});

describe('searchSnippet', () => {
  const session = (match: string) => ({ id: 's', title: 't', match_excerpt: match });
  it('cuts the matching message around the words searched for', () => {
    const long = `${'a'.repeat(200)} the secret word is papaya ${'b'.repeat(200)}`;
    const snippet = searchSnippet(session(long), 'PAPAYA', 20);
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet).toContain('papaya');
    expect(searchSnippet(session('Short   text'), 'x')).toBe('Short text');
    expect(searchSnippet({ id: 's', title: 't' }, 'x')).toBe('');
    expect(searchSnippet({ id: 's', title: 't', match_content: 'older field' }, 'x')).toBe('older field');
  });
});
