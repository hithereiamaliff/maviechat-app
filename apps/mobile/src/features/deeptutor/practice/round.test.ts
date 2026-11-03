import type { DtPracticeQuestion } from '@maviechat/deeptutor-protocol';
import { describe, expect, it } from 'vitest';
import { afterReview, afterSkip, correctKeys, dueLabel, roundFinished, startRound } from './round';

const question = (id: number, version = 0): DtPracticeQuestion => ({ entry: { id, question: `Q${id}` }, state: { version } });

describe('practice round', () => {
  it('moves on after a good review and finishes', () => {
    let round = startRound([question(1), question(2)]);
    round = afterReview(round, 'good', { version: 1 });
    expect(round).toMatchObject({ index: 1, reviewed: 1, again: 0 });
    round = afterSkip(round);
    expect(roundFinished(round)).toBe(true);
  });

  it('brings an "again" question back at the end, with its new version', () => {
    const round = afterReview(startRound([question(1, 4), question(2)]), 'again', { version: 5 });
    expect(round.items.map((item) => item.entry.id)).toEqual([1, 2, 1]);
    expect(round.items[2]!.state.version).toBe(5);
    expect(round).toMatchObject({ index: 1, reviewed: 1, again: 1 });
  });
});

describe('correctKeys', () => {
  const options = { A: 'Kuala Lumpur', B: 'Putrajaya', C: 'Penang' };
  it('reads letters, lists and choice text', () => {
    expect(correctKeys({ options, correct_answer: 'B' })).toEqual(['B']);
    expect(correctKeys({ options, correct_answer: 'a, C.' })).toEqual(['A', 'C']);
    expect(correctKeys({ options, correct_answer: 'Putrajaya' })).toEqual(['B']);
    expect(correctKeys({ options, correct_answer: '' })).toEqual([]);
    expect(correctKeys({ options: {}, correct_answer: 'B' })).toEqual([]);
  });
});

describe('dueLabel', () => {
  const now = new Date(2026, 10, 3, 12, 0, 0);
  it('says now, today, a weekday or a date', () => {
    expect(dueLabel(null, now)).toBeNull();
    expect(dueLabel(now.getTime() / 1000 - 60, now)).toBe('now');
    expect(dueLabel(now.getTime() / 1000 + 3600, now)).toMatch(/^today /);
    expect(dueLabel(now.getTime() / 1000 + 2 * 86400, now)).not.toMatch(/^today|now/);
  });
});
