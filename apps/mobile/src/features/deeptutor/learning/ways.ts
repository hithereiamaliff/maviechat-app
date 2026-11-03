import { pageAvailable, type DtAuthStatus, type DtLearningActivity, type DtLearningKind, type DtModule } from '@maviechat/deeptutor-protocol';
import { router } from 'expo-router';
import type { IconName } from '@/components/Icon';
import { openDtPage } from '@/features/deeptutor/settings/DtGeneralSettings';

/** A way to learn in DeepTutor, in our own words: what it is, and three things it does. */
export interface LearningWay {
  kind: Exclude<DtLearningKind, 'watching'>;
  label: string;
  icon: IconName;
  summary: string;
  points: [string, string, string];
  /** DeepTutor's page for it (whether the server has it on; and where it opens until it's native). */
  path: string;
  /** What a learner account's policy calls it. */
  surface: 'books' | 'chat' | 'reading';
}

export const LEARNING_WAYS: LearningWay[] = [
  {
    kind: 'books',
    label: 'Books',
    icon: 'book-open',
    summary: 'DeepTutor writes a book on any subject: the chapters first, then every page in full.',
    points: ['Change the chapters before any page is written', 'Pages with figures, timelines and quizzes', 'Keeps your place, and the tutor reads along'],
    path: '/learning/books',
    surface: 'books',
  },
  {
    kind: 'mastery',
    label: 'Mastery Path',
    icon: 'map',
    summary: 'Say what you want to master. You and the tutor agree an outline, and it becomes a map of points to work through.',
    points: ['The outline is settled in a chat first', 'Each point keeps its own mastery level', 'Reviews come back when they fall due'],
    path: '/learning/mastery',
    surface: 'chat',
  },
  {
    kind: 'practice',
    label: 'Practice',
    icon: 'arrow-path',
    summary: 'Go over the questions you saved from quizzes, spaced out so they stick.',
    points: ['Questions come back on a schedule', 'Mark how well you knew each one', 'See what you keep getting wrong'],
    path: '/learning/practice',
    surface: 'chat',
  },
  {
    kind: 'reading',
    label: 'Reading',
    icon: 'document-text',
    summary: 'Read your own files, web pages and videos with the tutor beside you.',
    points: ['PDFs, e-books, web pages and videos', 'Highlights and notes stay with the text', 'Ask about the passage in front of you'],
    path: '/learning/reading',
    surface: 'reading',
  },
];

export const KIND_LABELS: Record<DtLearningKind, string> = { books: 'Book', mastery: 'Mastery Path', practice: 'Practice', reading: 'Reading', watching: 'Video' };
export const KIND_ICONS: Record<DtLearningKind, IconName> = { books: 'book-open', mastery: 'map', practice: 'arrow-path', reading: 'document-text', watching: 'film' };

/** The ways this account may start: the server has the page on, and a learner's policy allows it. */
export function waysFor(modules: DtModule[] | undefined, status: DtAuthStatus | undefined): LearningWay[] {
  const policy = (status?.learning_policy as { allowed_surfaces?: unknown; allowed_capabilities?: unknown } | null | undefined) ?? null;
  const allowed = Array.isArray(policy?.allowed_surfaces) ? (policy.allowed_surfaces as unknown[]) : null;
  // A learner's tutor chats on a path need the mastery mode, which their policy may not grant
  // (DeepTutor would refuse every turn), so the way isn't offered then.
  const modes = Array.isArray(policy?.allowed_capabilities) ? (policy.allowed_capabilities as unknown[]) : null;
  return LEARNING_WAYS.filter(
    (way) =>
      (!modules || pageAvailable(modules, way.path)) && (!allowed || allowed.includes(way.surface)) && !(way.kind === 'mastery' && modes && !modes.includes('mastery_path')),
  );
}

/** Opens an activity: natively where the app has it, else DeepTutor's own page. */
export function openActivity(activity: DtLearningActivity): void {
  const id = encodeURIComponent(activity.id);
  switch (activity.kind) {
    case 'mastery':
      router.push({ pathname: '/learn/mastery/[id]', params: { id: activity.id } });
      return;
    case 'practice':
      // The question on its own, as DeepTutor's hub opens it.
      router.push({ pathname: '/learn/practice', params: { entry: activity.id } });
      return;
    case 'books':
      openDtPage(`/learning/books/${id}`, activity.title || 'Book');
      return;
    case 'reading':
      openDtPage(`/learning/reading/${id}`, activity.title || 'Reading');
      return;
    case 'watching':
      openDtPage(`/learning/watching/${id}`, activity.title || 'Video');
  }
}

/** Starts a new activity of this kind. */
export function startWay(way: LearningWay): void {
  if (way.kind === 'mastery') router.push('/learn/mastery/new');
  else if (way.kind === 'practice') router.push('/learn/practice');
  else openDtPage(`${way.path}?create=1`, `New ${way.label === 'Books' ? 'Book' : way.label}`);
}
