import { dueFlashcards, getNotePage, listNotePages, listNoteSuggestions, listNoteThreads, noteBacklinks } from '@maviechat/deeptutor-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';

function useNotesKey() {
  const { session } = useDtAuthed();
  return (...rest: string[]) => [DT_QUERY_ROOT, session.baseUrl, 'notes', ...rest];
}

export function useNotePages() {
  const { client } = useDtAuthed();
  const key = useNotesKey();
  return useQuery({ queryKey: key('pages'), queryFn: () => listNotePages(client), staleTime: 15_000 });
}

export function useNotePage(id: string) {
  const { client } = useDtAuthed();
  const key = useNotesKey();
  return useQuery({ queryKey: key('page', id), queryFn: () => getNotePage(client, id), enabled: Boolean(id), staleTime: 10_000 });
}

export function useNoteBacklinks(id: string) {
  const { client } = useDtAuthed();
  const key = useNotesKey();
  return useQuery({ queryKey: key('backlinks', id), queryFn: () => noteBacklinks(client, id), enabled: Boolean(id), staleTime: 60_000 });
}

export function useNoteThreads(id: string) {
  const { client } = useDtAuthed();
  const key = useNotesKey();
  return useQuery({ queryKey: key('threads', id), queryFn: () => listNoteThreads(client, id), enabled: Boolean(id), staleTime: 10_000 });
}

export function useNoteSuggestions(id: string) {
  const { client } = useDtAuthed();
  const key = useNotesKey();
  return useQuery({ queryKey: key('suggestions', id), queryFn: () => listNoteSuggestions(client, id), enabled: Boolean(id), staleTime: 10_000 });
}

export function useDueCards() {
  const { client } = useDtAuthed();
  const key = useNotesKey();
  return useQuery({ queryKey: key('due'), queryFn: () => dueFlashcards(client), staleTime: 30_000 });
}

export function useNotesRefresh(): () => void {
  const queryClient = useQueryClient();
  const key = useNotesKey();
  return () => void queryClient.invalidateQueries({ queryKey: key() });
}
