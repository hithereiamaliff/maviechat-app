import { getNote, listNotes, listPinnedNotes, NOTES_PAGE_SIZE, type NoteListQuery, type NoteSummary } from '@maviechat/owui-protocol';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthed, useCapabilities } from '@/lib/server';

/** Notes are on for this account: the server's switch, and `features.notes` (allowed unless denied, as on the web). */
export function useNotesOn(): boolean {
  const capabilities = useCapabilities();
  return capabilities?.feature('notes', true) ?? false;
}

/** Notes as the Notes page lists them, 60 a page, more as you scroll. */
export function useNotesList(query: Omit<NoteListQuery, 'page'>) {
  const { client } = useAuthed();
  return useInfiniteQuery({
    queryKey: ['notes', 'list', query],
    queryFn: ({ pageParam }) => listNotes(client, { ...query, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last: { items: NoteSummary[]; total: number }, pages: { items: NoteSummary[] }[]) =>
      last.items.length >= NOTES_PAGE_SIZE && pages.reduce((sum, page) => sum + page.items.length, 0) < last.total ? pages.length + 1 : undefined,
    staleTime: 15_000,
  });
}

/** The notes you pinned to the sidebar. */
export function usePinnedNotes() {
  const { client } = useAuthed();
  const on = useNotesOn();
  return useQuery({ queryKey: ['notes', 'pinned'], queryFn: () => listPinnedNotes(client), enabled: on, staleTime: 30_000 });
}

export function useNote(id: string) {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['notes', 'note', id], queryFn: () => getNote(client, id), enabled: Boolean(id) });
}

/** Reloads every list of notes (and the pinned ones). */
export function useNotesRefresh(): () => void {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: ['notes'] });
}
