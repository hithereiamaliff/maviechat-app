import type { DtPracticeQuestion, DtPracticeRating, DtReviewOutcome, DtSavedQuestion } from '@maviechat/deeptutor-protocol';

/** A practice round: the questions due, where you are, and how it went. */
export interface PracticeRound {
  items: DtPracticeQuestion[];
  index: number;
  reviewed: number;
  /** Questions rated "again", which come back at the end of the round. */
  again: number;
}

export function startRound(items: DtPracticeQuestion[]): PracticeRound {
  return { items, index: 0, reviewed: 0, again: 0 };
}

/**
 * After a review: "again" sends the question to the end of this round, carrying its new
 * schedule version (the next review must name it); anything else moves on.
 */
export function afterReview(round: PracticeRound, rating: DtPracticeRating, outcome: Pick<DtReviewOutcome, 'version'>): PracticeRound {
  const current = round.items[round.index];
  const items = rating === 'again' && current ? [...round.items, { ...current, state: { ...current.state, version: outcome.version } }] : round.items;
  return { items, index: round.index + 1, reviewed: round.reviewed + 1, again: round.again + (rating === 'again' ? 1 : 0) };
}

/** Skipping leaves the question as it was, due as before. */
export function afterSkip(round: PracticeRound): PracticeRound {
  return { ...round, index: round.index + 1 };
}

export function roundFinished(round: PracticeRound): boolean {
  return round.index >= round.items.length;
}

/** The choice letters an answer key names ("B", "A, C"), or the choice whose text it is. */
export function correctKeys(question: Pick<DtSavedQuestion, 'options' | 'correct_answer'>): string[] {
  const options = question.options ?? {};
  const answer = (question.correct_answer ?? '').trim();
  if (!answer) return [];
  const byKey = answer
    .split(/[,;\s]+/)
    .map((part) => part.replace(/[.)]$/, '').trim().toUpperCase())
    .filter((part) => part in options);
  if (byKey.length > 0) return [...new Set(byKey)];
  const byText = Object.entries(options).find(([, text]) => text.trim().toLowerCase() === answer.toLowerCase());
  return byText ? [byText[0]] : [];
}

/** When the next review is, in words ("now", "today 4:30 PM", "Thu 9:00 AM", "12 Nov"). */
export function dueLabel(seconds: number | null | undefined, now: Date = new Date()): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null;
  const due = new Date(seconds * 1000);
  if (due.getTime() <= now.getTime()) return 'now';
  const time = due.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const sameDay = due.toDateString() === now.toDateString();
  if (sameDay) return `today ${time}`;
  const days = (due.getTime() - now.getTime()) / 86_400_000;
  if (days < 6) return `${due.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
  return due.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
