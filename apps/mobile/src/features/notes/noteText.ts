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
