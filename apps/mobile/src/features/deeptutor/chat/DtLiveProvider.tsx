import {
  DtTurnConnection,
  getAuthStatus,
  TOKEN_COOKIE,
  turnSocketUrl,
  type DtConnectionState,
  type DtTurnRequest,
} from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useToast } from '@/components/Toast';
import { DT_EXPIRED_NOTICE, DT_QUERY_ROOT, useDeepTutor, useDtAuthed } from '@/session/DeepTutorProvider';
import { LiveTurns, type LiveTurn } from './liveTurns';

interface DtLiveValue {
  turns: LiveTurns;
  state: DtConnectionState;
  /** Sends a message; resolves with its session (a new one for a new chat). */
  send(request: DtTurnRequest): Promise<string>;
  /** Asks DeepTutor to stop the session's running reply. */
  stop(sessionId: string): Promise<boolean>;
  regenerate(sessionId: string): void;
  /** Shows a turn already running (started before the app restarted, or on another device). */
  follow(sessionId: string, turnId: string): void;
}

const DtLiveContext = createContext<DtLiveValue | null>(null);

// React Native's WebSocket takes request headers as a third argument, which the DOM typings don't declare.
const SocketWithHeaders = WebSocket as unknown as new (url: string, protocols: undefined, options: { headers: Record<string, string> }) => WebSocket;

/**
 * The DeepTutor space's live connection: one `/ws` socket for every chat, opened when a turn
 * needs it. The sign-in rides in a `Cookie` header, as DeepTutor's own pages send it.
 */
export function DtLiveProvider({ children }: { children: ReactNode }) {
  const { client, session } = useDtAuthed();
  const { signOut } = useDeepTutor();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [turns] = useState(() => new LiveTurns());
  const [state, setState] = useState<DtConnectionState>('idle');
  const { baseUrl, token } = session;

  const connection = useMemo(() => {
    const sessionKey = (id: string) => [DT_QUERY_ROOT, baseUrl, 'session', id];
    // The reply is saved when its turn ends: refetch, then let the saved message take over.
    const settle = (live: LiveTurn) => {
      void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, baseUrl, 'sessions'] });
      void queryClient.invalidateQueries({ queryKey: sessionKey(live.sessionId) }).finally(() => turns.remove(live.sessionId, live.turnId));
    };
    return new DtTurnConnection({
      url: turnSocketUrl(baseUrl),
      connect: (url, handlers) => {
        const socket = new SocketWithHeaders(url, undefined, { headers: { Cookie: `${TOKEN_COOKIE}=${token}` } });
        socket.onopen = () => handlers.onOpen();
        socket.onmessage = (event) => handlers.onMessage(event.data);
        socket.onclose = (event) => handlers.onClose(event.code);
        return { send: (data) => socket.send(data), close: () => socket.close() };
      },
      onEvent: (event) => {
        const live = turns.apply(event);
        if (event.type === 'session') void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, baseUrl, 'sessions'] });
        if (event.type === 'done' && live) settle(live);
      },
      onError: (error) => {
        if (!error.session_id || error.error_code === 'subscription_failed') return;
        if (error.error_code === 'regenerate_rejected') {
          // Nothing changed on the server: the reply that was there comes back.
          turns.remove(error.session_id);
          toast(`Couldn't regenerate: ${error.message || 'DeepTutor refused.'}`, 'error');
        } else {
          turns.fail(error.session_id, error.message || 'DeepTutor refused the message.');
        }
      },
      onWaiting: (sessionId) => {
        if (sessionId) turns.setActivity(sessionId, 'Waiting for DeepTutor to finish the last reply…');
      },
      onState: setState,
    });
  }, [baseUrl, token, queryClient, turns, toast]);

  useEffect(() => () => connection.close(), [connection]);

  // A refused socket sign-in: confirm with DeepTutor before signing out, as for a 401.
  useEffect(() => {
    if (state !== 'signed-out') return;
    getAuthStatus(client)
      .then((status) => (status.authenticated ? undefined : signOut({ notice: DT_EXPIRED_NOTICE })))
      .catch(() => undefined);
  }, [state, client, signOut]);

  // iOS closes sockets while the app is in the background; a running reply resumes on return.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') connection.wake();
    });
    return () => subscription.remove();
  }, [connection]);

  useEffect(() => () => turns.clear(), [turns, connection]);

  const value = useMemo<DtLiveValue>(
    () => ({
      turns,
      state,
      send: async (request) => (await connection.startTurn(request)).sessionId,
      stop: async (sessionId) => {
        const turnId = turns.get(sessionId)?.turnId;
        return turnId ? connection.cancel(turnId) : false;
      },
      regenerate: (sessionId) => connection.regenerate(sessionId),
      follow: (sessionId, turnId) => {
        if (turns.get(sessionId)?.turnId === turnId) return;
        connection.follow(turnId, 0);
      },
    }),
    [connection, state, turns],
  );

  return <DtLiveContext.Provider value={value}>{children}</DtLiveContext.Provider>;
}

export function useDtLive(): DtLiveValue {
  const value = useContext(DtLiveContext);
  if (!value) throw new Error('useDtLive outside the DeepTutor space');
  return value;
}

/** The session's live turn, if one is streaming or just finished. */
export function useLiveTurn(sessionId: string | null): LiveTurn | undefined {
  const { turns } = useDtLive();
  return useSyncExternalStore(turns.subscribe, () => (sessionId ? turns.get(sessionId) : undefined));
}
