import { describe, expect, it } from 'vitest';
import { groupNotes, notePreview } from './noteText';

const now = new Date(2026, 10, 7, 15, 0);
const at = (year: number, month: number, day: number) => new Date(year, month, day, 9, 0).getTime();

describe('the Notes list', () => {
  it('puts notes under the web’s date headings, newest first', () => {
    const notes = [
      { id: 'a', updatedAt: at(2026, 10, 7) },
      { id: 'b', updatedAt: at(2026, 10, 6) },
      { id: 'c', updatedAt: at(2026, 10, 2) },
      { id: 'd', updatedAt: at(2026, 9, 20) },
      { id: 'e', updatedAt: at(2026, 2, 1) },
      { id: 'f', updatedAt: at(2025, 5, 1) },
    ];
    expect(groupNotes(notes, now).map(({ group, notes: inside }) => [group.label, inside.map((note) => note.id).join('')])).toEqual([
      ['Today', 'a'],
      ['Yesterday', 'b'],
      ['Previous 7 days', 'c'],
      ['Previous 30 days', 'd'],
      ['March', 'e'],
      ['2025', 'f'],
    ]);
  });

  it('gathers each heading’s notes where its first note comes (as by name)', () => {
    const notes = [
      { id: 'apple', updatedAt: at(2026, 10, 7) },
      { id: 'berry', updatedAt: at(2026, 2, 1) },
      { id: 'cherry', updatedAt: at(2026, 10, 7) },
    ];
    expect(groupNotes(notes, now).map(({ group, notes: inside }) => [group.label, inside.map((note) => note.id)])).toEqual([
      ['Today', ['apple', 'cherry']],
      ['March', ['berry']],
    ]);
  });

  it('shows the start of a note without its marks', () => {
    expect(notePreview('# Plan\n\n- [ ] **milk** and [eggs](https://x.test)')).toBe('Plan milk and eggs');
  });
});
