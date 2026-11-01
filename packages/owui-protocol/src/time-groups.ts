/** Sidebar date buckets, matching the web app: Today, Yesterday, Previous 7 days, Previous 30 days, then months of this year, then years. */
export interface TimeGroup {
  key: string;
  label: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Bucket for a chat updated at `updatedAtSec` (Unix seconds), in the device's time zone. */
export function timeGroupOf(updatedAtSec: number, now: Date = new Date()): TimeGroup {
  const updated = new Date(updatedAtSec * 1000);
  const days = Math.round((startOfDay(now) - startOfDay(updated)) / DAY_MS);
  if (days <= 0) return { key: 'today', label: 'Today' };
  if (days === 1) return { key: 'yesterday', label: 'Yesterday' };
  if (days <= 7) return { key: 'previous-7', label: 'Previous 7 days' };
  if (days <= 30) return { key: 'previous-30', label: 'Previous 30 days' };
  if (updated.getFullYear() === now.getFullYear()) {
    return { key: `month-${updated.getMonth()}`, label: MONTHS[updated.getMonth()] as string };
  }
  return { key: `year-${updated.getFullYear()}`, label: String(updated.getFullYear()) };
}

/** Splits a newest-first list into consecutive date sections. */
export function groupByTime<T extends { updated_at: number }>(items: T[], now: Date = new Date()): { group: TimeGroup; items: T[] }[] {
  const sections: { group: TimeGroup; items: T[] }[] = [];
  for (const item of items) {
    const group = timeGroupOf(item.updated_at, now);
    const last = sections[sections.length - 1];
    if (last && last.group.key === group.key) last.items.push(item);
    else sections.push({ group, items: [item] });
  }
  return sections;
}
