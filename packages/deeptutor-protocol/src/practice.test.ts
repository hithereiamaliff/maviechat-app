import { describe, expect, it } from 'vitest';
import { DtClient } from './http';
import {
  answerKind,
  checkPracticeAnswer,
  choiceAnswer,
  getPracticeQueue,
  getPracticeSummary,
  listSavedQuestions,
  reviewPracticeQuestion,
  updateSavedQuestion,
} from './practice';

function recordingClient(...answers: unknown[]) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const client = new DtClient({
    baseUrl: 'https://learn.example.com',
    token: 'tok',
    fetch: async (url, init) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(answers.shift() ?? {}), { status: 200 });
    },
  });
  return { client, calls };
}

describe('practice', () => {
  it('asks for today in your time zone', async () => {
    const { client, calls } = recordingClient({ total: 3, mistakes: 1, due: 2, overdue: 0, reviewed_today: 0, next_due_at: null }, []);
    expect((await getPracticeSummary(client, 'Asia/Kuala_Lumpur')).due).toBe(2);
    await getPracticeQueue(client, 'Asia/Kuala_Lumpur', { categoryId: 4 });
    expect(calls.map((call) => call.url)).toEqual([
      'https://learn.example.com/api/question-notebook/practice/summary?timezone=Asia%2FKuala_Lumpur',
      'https://learn.example.com/api/question-notebook/practice/queue?timezone=Asia%2FKuala_Lumpur&category_id=4&limit=20',
    ]);
  });

  it('checks answers, null when DeepTutor cannot', async () => {
    const { client, calls } = recordingClient({ correct: true }, { correct: null });
    expect(await checkPracticeAnswer(client, 7, 'B')).toBe(true);
    expect(await checkPracticeAnswer(client, 7, 'my essay')).toBeNull();
    expect(calls[0]).toEqual({ url: 'https://learn.example.com/api/question-notebook/practice/questions/7/check', method: 'POST', body: { answer: 'B' } });
  });

  it('sends a review with its request id and version', async () => {
    const { client, calls } = recordingClient({ rating: 'again', due_at: 1, mastered: false, correct: false, version: 3 });
    const outcome = await reviewPracticeQuestion(client, 7, { requestId: 'r'.repeat(20), version: 2, rating: 'again', answer: 'A' });
    expect(outcome.version).toBe(3);
    expect(calls[0]!.body).toEqual({ request_id: 'r'.repeat(20), version: 2, rating: 'again', answer: 'A', self_report: false });
  });

  it('tells choice, several-choice and written questions apart', () => {
    expect(answerKind({ question_type: 'choice', options: { A: 'x', B: 'y' } })).toBe('choice');
    expect(answerKind({ question_type: 'multiple_select', options: { A: 'x' } })).toBe('multi');
    expect(answerKind({ question_type: 'short_answer', options: {} })).toBe('written');
    expect(answerKind({ question_type: 'choice' })).toBe('written');
    expect(choiceAnswer(['C', 'A'])).toBe('A,C');
  });
});

describe('question bank', () => {
  it('filters only by what is set', async () => {
    const { client, calls } = recordingClient({ items: [{ id: 1, question: 'Q' }], total: 1 }, {});
    expect((await listSavedQuestions(client, { mistakesOnly: true, search: ' fractions ' })).total).toBe(1);
    expect(calls[0]!.url).toBe('https://learn.example.com/api/question-notebook/entries?mistakes_only=true&search=fractions&limit=50&offset=0');
    await updateSavedQuestion(client, 1, { bookmarked: true });
    expect(calls[1]).toEqual({ url: 'https://learn.example.com/api/question-notebook/entries/1', method: 'PATCH', body: { bookmarked: true } });
  });
});
