/** The web's limit: a paste longer than this becomes a text file when "Paste long text as a file" is on. */
export const PASTED_TEXT_LIMIT = 1000;

/**
 * What a change to the message box pasted, when it was one insertion longer than `limit`
 * (a phone's text field reports a paste only as the new text); else null.
 */
export function pastedText(previous: string, next: string, limit = PASTED_TEXT_LIMIT): string | null {
  if (next.length - previous.length <= limit) return null;
  let start = 0;
  while (start < previous.length && previous[start] === next[start]) start++;
  let end = 0;
  while (end < previous.length - start && previous[previous.length - 1 - end] === next[next.length - 1 - end]) end++;
  // Only an insertion: everything that was there is still there, around the new part.
  if (start + end !== previous.length) return null;
  const inserted = next.slice(start, next.length - end);
  return inserted.length > limit ? inserted : null;
}
