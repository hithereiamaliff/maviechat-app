/**
 * The note editor's Undo and Redo, as the web's buttons beside the title: the text as it was
 * before each change. Typing is kept a burst at a time (a pause starts a new step); formatting,
 * ticking a box, an insert and a change taken in from elsewhere (the note's chat rewriting it,
 * say) are steps of their own.
 */
export interface TextHistory {
  past: string[];
  future: string[];
  /** When the last step was kept (milliseconds), to join typing into bursts. */
  at: number;
  /** Whether the last step was typing. */
  typing: boolean;
}

/** Keystrokes closer together than this are one step. */
export const BURST_MS = 1500;
const MOST = 100;

export const emptyHistory = (): TextHistory => ({ past: [], future: [], at: 0, typing: false });

/** Keeps `before` (the text just before a change) as a step back, unless the change carries on the same burst of typing. */
export function remember(history: TextHistory, before: string, at: number, typing: boolean): TextHistory {
  if (typing && history.typing && at - history.at < BURST_MS && history.past.length) return { ...history, at, future: [] };
  if (history.past[history.past.length - 1] === before && history.future.length === 0) return { ...history, at, typing };
  return { past: [...history.past, before].slice(-MOST), future: [], at, typing };
}

/** One step back from `current`: the text to show, and the history after it (null when there's nothing to undo). */
export function undo(history: TextHistory, current: string): { history: TextHistory; text: string } | null {
  const text = history.past[history.past.length - 1];
  if (text === undefined) return null;
  return { history: { past: history.past.slice(0, -1), future: [...history.future, current], at: 0, typing: false }, text };
}

/** One step forward again (null when nothing was undone). */
export function redo(history: TextHistory, current: string): { history: TextHistory; text: string } | null {
  const text = history.future[history.future.length - 1];
  if (text === undefined) return null;
  return { history: { past: [...history.past, current], future: history.future.slice(0, -1), at: 0, typing: false }, text };
}
