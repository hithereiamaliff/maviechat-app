import {
  applyBookEvent,
  BOOK_EVENT_KINDS,
  bookSocketUrl,
  DtBookWatch,
  EMPTY_BOOK_LIVE,
  PAGE_EVENT_KINDS,
  type DtBookLive,
  type DtBookSocketOptions,
} from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { dtSocketFactory } from '@/features/deeptutor/dtSocket';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';

/** Where book actions go: `/ws/books`, one socket per action, signed in by cookie. */
export function useBookSocket(): DtBookSocketOptions {
  const { session } = useDtAuthed();
  return useMemo(() => ({ url: bookSocketUrl(session.baseUrl), connect: dtSocketFactory(session.token) }), [session.baseUrl, session.token]);
}

/** Reads again what a book change touches: the book, the library and the learning hub (and the book's pages, unless `bookOnly`). */
export function useBookRefresh() {
  const queryClient = useQueryClient();
  const { session } = useDtAuthed();
  return useCallback(
    (bookId: string | null, bookOnly = false) => {
      if (bookId) void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'books', 'book', bookId], exact: bookOnly });
      void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'books', 'list'] });
      void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'learning-index'] });
    },
    [queryClient, session.baseUrl],
  );
}

/**
 * Follows a book's writing while its screen is in front: what's under way now (from DeepTutor's
 * events), and fresh reads of the book and its pages when an event says they changed. DeepTutor
 * replays what was missed, so coming back from the background (iOS closes the socket) catches up.
 */
export function useBookWatch(bookId: string, enabled = true): DtBookLive {
  const { session } = useDtAuthed();
  const queryClient = useQueryClient();
  const key = `${session.baseUrl} ${bookId}`;
  const [state, setState] = useState<{ key: string; live: DtBookLive }>({ key: '', live: EMPTY_BOOK_LIVE });

  const watch = useMemo(() => {
    if (!bookId) return null;
    const bookKey = [DT_QUERY_ROOT, session.baseUrl, 'books', 'book', bookId];
    const waiting = new Set<string>();
    // Events come in bursts: read again once per burst (as DeepTutor's web app does).
    const soon = (name: string, ms: number, run: () => void) => {
      if (waiting.has(name)) return;
      waiting.add(name);
      setTimeout(() => {
        waiting.delete(name);
        run();
      }, ms);
    };
    return new DtBookWatch({
      url: bookSocketUrl(session.baseUrl),
      connect: dtSocketFactory(session.token),
      bookId,
      onEvent: (event) => {
        setState((current) => ({ key, live: applyBookEvent(current.key === key ? current.live : EMPTY_BOOK_LIVE, event) }));
        if (PAGE_EVENT_KINDS.has(event.kind) && event.pageId) {
          soon(`page ${event.pageId}`, 250, () => void queryClient.invalidateQueries({ queryKey: [...bookKey, 'page', event.pageId] }));
        }
        if (BOOK_EVENT_KINDS.has(event.kind) || event.kind === 'page_compile_started') {
          soon('book', 300, () => {
            void queryClient.invalidateQueries({ queryKey: bookKey, exact: true });
            void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'books', 'list'] });
            void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'learning-index'] });
          });
        }
      },
      onReset: () => setState({ key, live: EMPTY_BOOK_LIVE }),
    });
  }, [bookId, key, session.baseUrl, session.token, queryClient]);

  useFocusEffect(
    useCallback(() => {
      if (!watch || !enabled) return;
      watch.start();
      const subscription = AppState.addEventListener('change', (next) => {
        if (next === 'active') watch.wake();
      });
      return () => {
        subscription.remove();
        watch.stop();
      };
    }, [watch, enabled]),
  );

  return state.key === key ? state.live : EMPTY_BOOK_LIVE;
}

/** The time now, ticking every second while `on`. */
export function useTicking(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [on]);
  return now;
}
