import { DtBookActionError, DtHttpError, type DtBookDepth, type DtChapterType } from '@maviechat/deeptutor-protocol';
import { describeError } from '@/lib/errors';

/** A book's step, in a word (shown when it isn't simply ready). */
export const BOOK_STATUS_LABELS: Record<string, string> = {
  draft: 'Proposal',
  spine_ready: 'Outline',
  compiling: 'Writing',
  paused: 'Paused',
  ready: 'Ready',
  error: 'Error',
  archived: 'Archived',
};

export const PAGE_STATUS_LABELS: Record<string, string> = {
  pending: 'Not written yet',
  planning: 'Planning',
  generating: 'Writing',
  ready: 'Written',
  partial: 'Partly written',
  error: 'Failed',
};

export const DEPTH_LABELS: Record<DtBookDepth, { label: string; hint: string }> = {
  brief: { label: 'Brief', hint: 'Shorter chapters: the essentials.' },
  standard: { label: 'Standard', hint: 'A full chapter on each topic.' },
  deep: { label: 'Deep', hint: 'Longer chapters with more detail.' },
};

export const CHAPTER_TYPE_LABELS: Record<DtChapterType, { label: string; hint: string }> = {
  theory: { label: 'Theory', hint: 'Ideas and how they fit together' },
  derivation: { label: 'Derivation', hint: 'Step-by-step reasoning and proofs' },
  history: { label: 'History', hint: 'How the ideas came about' },
  practice: { label: 'Practice', hint: 'Worked examples and exercises' },
  concept: { label: 'Concept', hint: 'One idea, explained in depth' },
};

/** What each kind of block is, in the outline's picker and on a page being written. */
export const BLOCK_TYPE_LABELS: Record<string, string> = {
  section: 'Prose',
  text: 'Text',
  callout: 'Callouts',
  quiz: 'Quick checks',
  flash_cards: 'Flash cards',
  figure: 'Figures',
  interactive: 'Interactive pages',
  animation: 'Animations',
  code: 'Code',
  timeline: 'Timelines',
  deep_dive: 'Go deeper',
  user_note: 'Notes',
  concept_graph: 'Chapter map',
};

export const blockLabel = (type: string) => BLOCK_TYPE_LABELS[type] ?? type.replace(/_/g, ' ');

/** One block being written, in the singular. */
export const BLOCK_TYPE_SINGULAR: Record<string, string> = {
  section: 'prose',
  text: 'text',
  callout: 'a callout',
  quiz: 'a quick check',
  flash_cards: 'flash cards',
  figure: 'a figure',
  interactive: 'an interactive page',
  animation: 'an animation',
  code: 'code',
  timeline: 'a timeline',
  deep_dive: 'topics to go deeper',
  concept_graph: 'the chapter map',
};

/** Why writing failed, by DeepTutor's category, in plain words. */
export const FAILURE_CAUSES: Record<string, string> = {
  quota: "The model's quota or credit ran out.",
  authentication: "The model's credentials were refused.",
  rate_limit: 'The model was turning requests away for a while.',
  missing_dependency: 'DeepTutor lacks something one kind of block needs. Leave that kind out of the outline.',
  provider: "The model couldn't be reached, or took too long.",
  content: "The model's answer couldn't be read as that block.",
};

/** A book action's error, in words: paused books and edits from elsewhere get their own. */
export function bookErrorText(error: unknown): string {
  const code = error instanceof DtBookActionError ? error.code : error instanceof DtHttpError ? error.code : undefined;
  if (code === 'book_paused') return 'The book is paused. Resume the writing first.';
  if (code === 'book_revision_conflict' || code === 'book_revision_required') return 'The book changed somewhere else. It has been read again: try once more.';
  if (error instanceof DtBookActionError && error.code === 'disconnected') return 'The connection dropped. DeepTutor carries on; the book shows its progress when you come back.';
  return describeError(error);
}

/** Minutes and seconds (hours past an hour) since `startedAt` (Unix seconds). */
export function elapsed(startedAt: number, nowMs: number): string {
  const total = Math.max(0, Math.floor(nowMs / 1000 - startedAt));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}
