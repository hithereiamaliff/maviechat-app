import type { DtQuizQuestion } from '@maviechat/deeptutor-protocol';
import { describe, expect, it } from 'vitest';
import { choicesFor, isCorrect } from './quiz';

const question = (patch: Partial<DtQuizQuestion>): DtQuizQuestion => ({
  id: 'q_1',
  question: 'Q',
  type: 'choice',
  options: [
    { key: 'A', text: 'Carbon dioxide and water' },
    { key: 'B', text: 'Glucose and oxygen' },
  ],
  answer: 'A',
  explanation: '',
  difficulty: 'easy',
  ...patch,
});

describe('checking Quiz answers', () => {
  it('matches a choice by its key, whatever form the answer takes', () => {
    expect(isCorrect(question({}), 'A')).toBe(true);
    expect(isCorrect(question({}), 'B')).toBe(false);
    expect(isCorrect(question({ answer: 'A. Carbon dioxide and water' }), 'A')).toBe(true);
    expect(isCorrect(question({ answer: 'Glucose and oxygen' }), 'B')).toBe(true);
  });

  it('matches blanks and true/false by text, and leaves written answers to you', () => {
    expect(isCorrect(question({ type: 'fill_in_blank', options: [], answer: 'thylakoid membranes' }), ' Thylakoid  membranes. ')).toBe(true);
    expect(isCorrect(question({ type: 'fill_in_blank', options: [], answer: 'stroma' }), 'grana')).toBe(false);
    expect(isCorrect(question({ type: 'concept', options: [], answer: 'True' }), 'true')).toBe(true);
    expect(isCorrect(question({ type: 'written', options: [], answer: 'An essay' }), 'Mine')).toBeNull();
    expect(isCorrect(question({ type: 'written', options: [] }), '  ')).toBe(false);
  });

  it('offers True and False when a true/false question has no options', () => {
    expect(choicesFor(question({ type: 'concept', options: [] })).map((choice) => choice.key)).toEqual(['True', 'False']);
    expect(choicesFor(question({ type: 'fill_in_blank', options: [] }))).toEqual([]);
  });
});
