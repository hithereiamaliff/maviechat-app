import { DtPartnerChat, partnerHistoryPage, partnerSocketUrl, type DtPartnerChatState, type DtPartnerRecord, type DtPartnerTurn } from '@maviechat/deeptutor-protocol';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { dtSocketFactory } from '@/features/deeptutor/dtSocket';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';

export interface PartnerChatEvents {
  /** DeepTutor didn't take a message: give its words back. */
  onRefused(prompt: string, message: string): void;
  /** The partner said something on its own (a reminder). */
  onProactive(content: string): void;
}

/**
 * A conversation with a partner: its messages, a page at a time from the newest, and the reply in
 * progress over the partner's socket. The socket reconnects when the app comes back, and follows
 * a reply that kept going on DeepTutor while the app was away.
 */
export function usePartnerChat(partnerId: string, sessionKey: string | null, events: PartnerChatEvents) {
  const { client, session } = useDtAuthed();
  const queryClient = useQueryClient();
  const [state, setState] = useState<DtPartnerChatState>('connecting');
  const [detail, setDetail] = useState('');
  const [live, setLive] = useState<DtPartnerTurn | null>(null);
  // A finished reply stays on screen until the conversation has been read again with it in.
  const [ended, setEnded] = useState<{ turn: DtPartnerTurn; at: number } | null>(null);
  const chat = useRef<DtPartnerChat | null>(null);
  const keyRef = useRef(sessionKey);
  const handlers = useRef(events);
  useEffect(() => {
    handlers.current = events;
  }, [events]);

  const historyKey = [DT_QUERY_ROOT, session.baseUrl, 'partners', 'history', partnerId, sessionKey] as const;
  const history = useInfiniteQuery({
    queryKey: historyKey,
    queryFn: ({ pageParam }) => partnerHistoryPage(client, partnerId, sessionKey as string, pageParam),
    initialPageParam: null as number | null,
    getNextPageParam: (page) => page.nextBefore ?? undefined,
    enabled: Boolean(sessionKey),
  });

  // One socket per partner, for as long as the screen is open.
  useEffect(() => {
    const connection = new DtPartnerChat({
      url: partnerSocketUrl(session.baseUrl, partnerId),
      connect: dtSocketFactory(session.token),
      onState: (next, why) => {
        setState(next);
        setDetail(why ?? '');
      },
      onTurn: setLive,
      onEnd: (turn) => {
        setEnded({ turn, at: Date.now() });
        void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'partners'] });
      },
      onRefused: (prompt, _reason, message) => handlers.current.onRefused(prompt, message),
      onProactive: (content) => handlers.current.onProactive(content),
    });
    chat.current = connection;
    if (keyRef.current) connection.open(keyRef.current);
    const subscription = AppState.addEventListener('change', (appState) => {
      if (appState === 'active') connection.wake();
    });
    return () => {
      subscription.remove();
      connection.close();
      chat.current = null;
    };
  }, [partnerId, session.baseUrl, session.token, queryClient]);

  useEffect(() => {
    keyRef.current = sessionKey;
    if (sessionKey) chat.current?.open(sessionKey);
  }, [sessionKey]);

  // Oldest first: pages come newest first, each oldest first within.
  const records: DtPartnerRecord[] = useMemo(() => (history.data?.pages ?? []).slice().reverse().flatMap((page) => page.records), [history.data]);
  const historyRead = history.dataUpdatedAt;
  const shownEnded = ended && ended.turn.sessionKey === sessionKey && historyRead < ended.at ? ended.turn : null;

  return {
    state,
    /** Why the partner can't be reached, when DeepTutor said. */
    detail,
    records,
    /** The reply being written, or one just finished that the conversation doesn't hold yet. */
    turn: live ?? shownEnded,
    running: live !== null,
    loading: history.isLoading,
    error: history.error,
    olderAvailable: history.hasNextPage,
    loadingOlder: history.isFetchingNextPage,
    loadOlder: () => {
      if (history.hasNextPage && !history.isFetchingNextPage) void history.fetchNextPage();
    },
    reload: () => void history.refetch(),
    send: (text: string) => chat.current?.send(text) ?? false,
    stop: () => chat.current?.stop(),
    /** After Start or Stop: the socket follows the partner's new runtime. */
    reconnect: () => chat.current?.reconnect(),
  };
}
