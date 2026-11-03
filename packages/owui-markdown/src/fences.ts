/**
 * Whether a code block's markdown is finished: indented blocks always are; a fenced one once its
 * closing fence (the same character, at least as long) has arrived. While a reply streams, the
 * last block is often still open, and a diagram drawn from half its code would be wrong.
 */
export function isClosedCodeBlock(raw: string): boolean {
  const open = /^ {0,3}(`{3,}|~{3,})/.exec(raw);
  if (!open?.[1]) return true;
  const fence = open[1];
  const lines = raw.trimEnd().split('\n');
  if (lines.length < 2) return false;
  const last = lines[lines.length - 1]!.trim();
  return last.length >= fence.length && [...last].every((char) => char === fence[0]);
}
