import type { DtClient } from './http';

/*
 * DeepTutor's question bank and practice (1.7.1). Questions answered in Quiz mode are saved to
 * a question bank (`/api/question-notebook`); Practice brings them back for review on a
 * spaced-repetition schedule (`/api/question-notebook/practice`): you answer, objective
 * questions are checked, and your rating sets the next review.
 */

/** A saved question and how you answered it. Unknown fields are kept. */
export interface DtSavedQuestion {
  id: number;
  session_id?: string;
  session_title?: string;
  question: string;
  question_type?: string;
  /** Choice letter → text, for choice questions. */
  options?: Record<string, string>;
  correct_answer?: string;
  explanation?: string;
  difficulty?: string;
  user_answer?: string;
  /** Where it came from ("deep_question" for Quiz mode). */
  source?: string;
  is_correct?: boolean;
  resolved?: boolean;
  bookmarked?: boolean;
  created_at?: number;
  updated_at?: number;
  categories?: DtQuestionCategory[] | null;
  [key: string]: unknown;
}

export interface DtQuestionCategory {
  id: number;
  name: string;
  entry_count?: number;
  [key: string]: unknown;
}

/** A question's schedule. `version` changes with each review, so two devices can't review it twice. */
export interface DtPracticeState {
  version: number;
  review_count?: number;
  interval_days?: number;
  /** Unix seconds; null before its first review. */
  due_at?: number | null;
  is_mistake?: number | boolean;
  [key: string]: unknown;
}

export interface DtPracticeQuestion {
  entry: DtSavedQuestion;
  state: DtPracticeState;
}

/** Today's practice, counted in your time zone. */
export interface DtPracticeSummary {
  total: number;
  mistakes: number;
  due: number;
  overdue: number;
  reviewed_today: number;
  /** Unix seconds of the next review, or null. */
  next_due_at: number | null;
  [key: string]: unknown;
}

/** Again: back into this round. Hard: needed a hint. Good: mastered for now. Easy: knew it confidently. */
export type DtPracticeRating = 'again' | 'hard' | 'good' | 'easy';

export interface DtReviewOutcome {
  rating: DtPracticeRating;
  /** Unix seconds of the next review. */
  due_at: number;
  mastered: boolean;
  /** The server's own check of the answer (null when it can't check this kind of question). */
  correct: boolean | null;
  version: number;
  [key: string]: unknown;
}

const BANK = '/api/question-notebook';
const PRACTICE = `${BANK}/practice`;

export function getPracticeSummary(client: DtClient, timeZone: string): Promise<DtPracticeSummary> {
  return client.get<DtPracticeSummary>(`${PRACTICE}/summary`, { query: { timezone: timeZone } });
}

/** The questions due now (mistakes and reviews), at most `limit`, optionally from one category. */
export function getPracticeQueue(client: DtClient, timeZone: string, { categoryId, limit = 20 }: { categoryId?: number; limit?: number } = {}): Promise<DtPracticeQuestion[]> {
  return client.get<DtPracticeQuestion[]>(`${PRACTICE}/queue`, { query: { timezone: timeZone, category_id: categoryId, limit } });
}

/** One question with its schedule, e.g. to practise it from the question bank. */
export function getPracticeQuestion(client: DtClient, id: number): Promise<DtPracticeQuestion> {
  return client.get<DtPracticeQuestion>(`${PRACTICE}/questions/${id}`);
}

/** Checks an answer: true or false for choice questions, null when it can't be checked (you compare it yourself). */
export async function checkPracticeAnswer(client: DtClient, id: number, answer: string): Promise<boolean | null> {
  const response = await client.post<{ correct?: unknown }>(`${PRACTICE}/questions/${id}/check`, { answer });
  return typeof response.correct === 'boolean' ? response.correct : null;
}

export interface DtReviewInput {
  /** The same id when retrying a review whose answer got lost (DeepTutor then answers it again). */
  requestId: string;
  /** The schedule's version when the question was shown. */
  version: number;
  rating: DtPracticeRating;
  answer: string;
  /** "I have mastered this", without checking. */
  selfReport?: boolean;
}

/**
 * Saves a review and schedules the next one. DeepTutor checks objective answers again: a wrong
 * one must be rated "again" (422 otherwise). 409 means the question was reviewed elsewhere meanwhile.
 */
export function reviewPracticeQuestion(client: DtClient, id: number, input: DtReviewInput): Promise<DtReviewOutcome> {
  return client.post<DtReviewOutcome>(`${PRACTICE}/questions/${id}/review`, {
    request_id: input.requestId,
    version: input.version,
    rating: input.rating,
    answer: input.answer,
    self_report: input.selfReport ?? false,
  });
}

/** How a question is answered: one choice, several choices, or written. */
export function answerKind(question: Pick<DtSavedQuestion, 'question_type' | 'options'>): 'choice' | 'multi' | 'written' {
  if (!question.options || Object.keys(question.options).length === 0) return 'written';
  return question.question_type === 'multi_choice' || question.question_type === 'multiple_select' ? 'multi' : 'choice';
}

/** The answer text DeepTutor checks: the choice letters, comma-separated for several. */
export function choiceAnswer(keys: string[]): string {
  return [...keys].sort().join(',');
}

export interface DtQuestionFilter {
  categoryId?: number;
  /** Only questions you got wrong. */
  mistakesOnly?: boolean;
  bookmarked?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listSavedQuestions(client: DtClient, filter: DtQuestionFilter = {}): Promise<{ items: DtSavedQuestion[]; total: number }> {
  const response = await client.get<{ items?: DtSavedQuestion[]; total?: number }>(`${BANK}/entries`, {
    query: {
      category_id: filter.categoryId,
      mistakes_only: filter.mistakesOnly || undefined,
      bookmarked: filter.bookmarked,
      search: filter.search?.trim() || undefined,
      limit: filter.limit ?? 50,
      offset: filter.offset ?? 0,
    },
  });
  return { items: response.items ?? [], total: response.total ?? 0 };
}

export async function updateSavedQuestion(client: DtClient, id: number, change: { bookmarked?: boolean; resolved?: boolean }): Promise<void> {
  await client.send('PATCH', `${BANK}/entries/${id}`, { body: change });
}

export async function deleteSavedQuestion(client: DtClient, id: number): Promise<void> {
  await client.delete(`${BANK}/entries/${id}`);
}

export function listQuestionCategories(client: DtClient): Promise<DtQuestionCategory[]> {
  return client.get<DtQuestionCategory[]>(`${BANK}/categories`);
}

/** Counts for the question bank: all, wrong, bookmarked. */
export function getQuestionBankStats(client: DtClient): Promise<{ total: number; wrong: number; unresolved: number; bookmarked: number; [key: string]: unknown }> {
  return client.get(`${BANK}/stats`);
}
