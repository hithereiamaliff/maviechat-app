import type { DtQuizQuestion } from '@maviechat/deeptutor-protocol';

/** Your answer to a Quiz question, kept while the app runs. */
export interface QuizAnswer {
  value: string;
  /** Checked (choices check at once; written answers when you reveal the answer). */
  checked: boolean;
  /** Null until known: written answers are marked by you. */
  correct: boolean | null;
}

export const NO_ANSWER: QuizAnswer = { value: '', checked: false, correct: null };

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:!?'"`]+$/g, '')
    .trim();

/** The option key an answer names: "A", "A.", "A) text", or the option's own text. */
function optionKey(question: DtQuizQuestion, answer: string): string | null {
  const trimmed = answer.trim();
  const byKey = /^([A-Za-z])(?:$|[.):\s])/.exec(trimmed)?.[1]?.toUpperCase();
  if (byKey && question.options.some((option) => option.key.toUpperCase() === byKey)) return byKey;
  const byText = question.options.find((option) => normalize(option.text) === normalize(trimmed));
  return byText ? byText.key.toUpperCase() : null;
}

/** Whether DeepTutor's answer is yours: choices by option, true/false and blanks by text. Null when only you can tell. */
export function isCorrect(question: DtQuizQuestion, value: string): boolean | null {
  if (!value.trim()) return false;
  if (question.options.length > 0) {
    const expected = optionKey(question, question.answer);
    return expected ? optionKey(question, value) === expected : normalize(value) === normalize(question.answer);
  }
  if (question.type === 'concept' || question.type === 'fill_in_blank') return normalize(value) === normalize(question.answer);
  return null;
}

/** True/false questions sometimes come without options; these stand in. */
export function choicesFor(question: DtQuizQuestion): { key: string; text: string }[] {
  if (question.options.length > 0) return question.options;
  if (question.type === 'concept') {
    return [
      { key: 'True', text: 'True' },
      { key: 'False', text: 'False' },
    ];
  }
  return [];
}
