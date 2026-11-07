import { timeGroupOf, type TimeGroup } from '@maviechat/owui-protocol';

/** A note's start for a list: its words without Markdown marks, on one line. */
export function notePreview(md: string): string {
  return md
    .replace(/```[^\n]*\n?/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** When a note changed: the time today, the day and month this year, else the date. */
export function noteWhen(ms: number, now: number): string {
  if (!ms) return '';
  const when = new Date(ms);
  const today = new Date(now);
  if (when.toDateString() === today.toDateString()) return when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (when.getFullYear() === today.getFullYear()) return when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Notes under the web's date headings (Today, Yesterday, Previous 7 days, Previous 30 days, then
 * months of this year, then years), by when each changed; headings in the order their first note
 * comes, as the web lists them (so by name, each heading gathers its notes in that order).
 */
export function groupNotes<T extends { updatedAt: number }>(notes: T[], now: Date): { group: TimeGroup; notes: T[] }[] {
  const groups = new Map<string, { group: TimeGroup; notes: T[] }>();
  for (const note of notes) {
    const group = timeGroupOf(note.updatedAt / 1000, now);
    const found = groups.get(group.key);
    if (found) found.notes.push(note);
    else groups.set(group.key, { group, notes: [note] });
  }
  return [...groups.values()];
}
