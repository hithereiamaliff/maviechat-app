import { describe, expect, it } from 'vitest';
import { learningCounts, learningIndexOf, matchesLearningFilter, pageAvailable, type DtModule } from './learning';

const index = learningIndexOf({
  sources: {
    books: [
      { id: 'b1', title: 'Rivers', status: 'ready', created_at: 100, updated_at: 500, reading: { percent: 40 }, metadata: {} },
      { id: 'b2', title: 'Volcanoes', status: 'paused', created_at: 90, updated_at: 300, metadata: { pause_reason: 'Quota reached' } },
      { id: 'b3', title: 'Deserts', status: 'compiling', created_at: 80, updated_at: 350, metadata: {} },
    ],
    mastery: [
      {
        path_id: 'p1',
        name: '',
        updated_at: 600,
        metadata: { goal: 'Learn fractions', status: 'active', created_at: 50 },
        map: { counts: { total: 4, mastered: 1 } },
        reviews: [
          { knowledge_point_name: 'Halves', due: true },
          { knowledge_point_name: 'Thirds', due: false },
        ],
      },
      { path_id: 'p2', name: 'Old path', updated_at: 700, metadata: { goal: 'x', status: 'archived' }, map: { counts: { total: 2, mastered: 2 } }, reviews: [{ due: true }] },
    ],
    reading: [{ workspace_id: 'r1', title: 'Papers', created_at: 10, updated_at: 200 }],
    watching: [
      { session_id: 's1', title: 'A lecture', created_at: 5, updated_at: 400, preferences: { workspace_mode: 'immersive_watching' } },
      { session_id: 's2', title: 'Not a video', updated_at: 999, preferences: {} },
    ],
    practice: [{ id: 7, question: 'What is 2+2?', created_at: 20, updated_at: 0 }],
  },
  failed: ['reading', 'nonsense'],
});

describe('learning hub', () => {
  it('lists every kind newest first, leaving out archived paths and chats that are not videos', () => {
    expect(index.activities.map((item) => `${item.kind}:${item.id}`)).toEqual([
      'mastery:p1',
      'books:b1',
      'watching:s1',
      'books:b3',
      'books:b2',
      'reading:r1',
      'practice:7',
    ]);
    const path = index.activities[0]!;
    expect(path.title).toBe('Learn fractions');
    expect(path.progress).toBe(0.25);
    expect(index.activities[1]!.progress).toBe(0.4);
    expect(index.activities.at(-1)!.updatedAt).toBe(20);
    expect(index.failed).toEqual(['reading']);
  });

  it('collects reviews due and books in progress, paused first', () => {
    expect(index.reviewsDue).toEqual([{ pathId: 'p1', title: 'Learn fractions', points: ['Halves'] }]);
    expect(index.booksInProgress.map((book) => `${book.id}:${book.status}:${book.reason}`)).toEqual(['b2:paused:Quota reached', 'b3:compiling:']);
  });

  it('filters by kind (Reading takes videos too) and by title, and counts each kind', () => {
    const titles = (filter: Parameters<typeof matchesLearningFilter>[1], query = '') => index.activities.filter((item) => matchesLearningFilter(item, filter, query)).map((item) => item.id);
    expect(titles('reading')).toEqual(['s1', 'r1']);
    expect(titles('all', 'RIV')).toEqual(['b1']);
    const counts = learningCounts(index.activities);
    expect(counts.books.count).toBe(3);
    expect(counts.books.latest?.id).toBe('b1');
    expect(counts.watching.count).toBe(1);
  });

  it('reads an empty or odd answer as nothing', () => {
    expect(learningIndexOf(null)).toEqual({ activities: [], reviewsDue: [], booksInProgress: [], failed: [] });
  });

  it('knows a page is on when an enabled, ready module serves it', () => {
    const modules: DtModule[] = [
      { id: 'mastery', enabled: true, ready: true, navigation: ['/mastery', '/learning/mastery'], capabilities: ['mastery_path'] },
      { id: 'books', enabled: false, ready: true, navigation: ['/learning/books'], capabilities: [] },
    ];
    expect(pageAvailable(modules, '/learning/mastery')).toBe(true);
    expect(pageAvailable(modules, '/learning/mastery/abc')).toBe(true);
    expect(pageAvailable(modules, '/learning/books')).toBe(false);
    expect(pageAvailable(modules, '/learning/masteryx')).toBe(false);
  });
});
