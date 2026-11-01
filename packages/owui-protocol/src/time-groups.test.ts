import { describe, expect, it } from 'vitest';
import { folderTree } from './folders';
import { groupByTime, timeGroupOf } from './time-groups';

const now = new Date(2026, 10, 1, 15, 0); // 1 Nov 2026, 15:00 local
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime() / 1000;

describe('timeGroupOf', () => {
  it('buckets like the web sidebar', () => {
    expect(timeGroupOf(at(2026, 10, 1, 0), now).label).toBe('Today');
    expect(timeGroupOf(at(2026, 9, 31, 23), now).label).toBe('Yesterday');
    expect(timeGroupOf(at(2026, 9, 26), now).label).toBe('Previous 7 days');
    expect(timeGroupOf(at(2026, 9, 10), now).label).toBe('Previous 30 days');
    expect(timeGroupOf(at(2026, 6, 4), now).label).toBe('July');
    expect(timeGroupOf(at(2025, 11, 31), now).label).toBe('2025');
  });

  it('treats future timestamps (clock skew) as today', () => {
    expect(timeGroupOf(at(2026, 10, 2), now).label).toBe('Today');
  });
});

describe('groupByTime', () => {
  it('keeps order and merges consecutive items of the same bucket', () => {
    const items = [
      { id: 'a', updated_at: at(2026, 10, 1) },
      { id: 'b', updated_at: at(2026, 10, 1, 8) },
      { id: 'c', updated_at: at(2026, 9, 31) },
      { id: 'd', updated_at: at(2026, 6, 4) },
    ];
    expect(groupByTime(items, now).map((s) => [s.group.label, s.items.map((i) => i.id)])).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
      ['July', ['d']],
    ]);
  });
});

describe('folderTree', () => {
  it('nests by parent and sorts by name; orphans become top-level', () => {
    const base = { created_at: 0, updated_at: 0 };
    const tree = folderTree([
      { id: '1', name: 'work', parent_id: null, ...base },
      { id: '2', name: 'Archive', parent_id: null, ...base },
      { id: '3', name: 'b-sub', parent_id: '1', ...base },
      { id: '4', name: 'a-sub', parent_id: '1', ...base },
      { id: '5', name: 'Orphan', parent_id: 'missing', ...base },
    ]);
    expect(tree.map((n) => n.name)).toEqual(['Archive', 'Orphan', 'work']);
    expect(tree[2]?.children.map((n) => n.name)).toEqual(['a-sub', 'b-sub']);
  });
});
