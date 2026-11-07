/*
 * Between a note's editor and its chat, which opens on top of it: the text you had selected in the
 * note (it goes with your messages, as on the web), and replies you insert into the note (the
 * editor puts them where you were writing). Kept by note id while the app runs.
 */

const selections = new Map<string, string>();
const inserters = new Map<string, (markdown: string) => void>();

/** The text selected in the note when its chat was opened ('' for none). */
export const setNoteSelection = (noteId: string, text: string) => {
  if (text.trim()) selections.set(noteId, text);
  else selections.delete(noteId);
};

export const noteSelection = (noteId: string): string => selections.get(noteId) ?? '';

/** The open editor takes inserted replies; the returned function stops it. */
export function onInsertIntoNote(noteId: string, insert: (markdown: string) => void): () => void {
  inserters.set(noteId, insert);
  return () => {
    if (inserters.get(noteId) === insert) inserters.delete(noteId);
  };
}

/** Hands a reply to the note's open editor; false when no editor of it is open. */
export function insertIntoNote(noteId: string, markdown: string): boolean {
  const insert = inserters.get(noteId);
  if (!insert) return false;
  insert(markdown);
  return true;
}
