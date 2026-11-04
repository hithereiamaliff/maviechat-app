import {
  DtTurnConnection,
  getAuthStatus,
  sessionTitle,
  type DtSession,
  turnSocketUrl,
  type DtConnectionState,
  type DtTurnRequest,
} from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useToast } from '@/components/Toast';
import { pushTokenIfOn } from '@/features/notifications/push';
import { isRelayServer, watchDeepTutorTurn } from '@/features/notifications/relay';
import { DT_EXPIRED_NOTICE, DT_QUERY_ROOT, useDeepTutor, useDtAuthed } from '@/session/DeepTutorProvider';
import { dtSocketFactory } from '@/features/deeptutor/dtSocket';
import { LiveTurns, type LiveTurn } from './liveTurns';

interface DtLiveValue {
  turns: LiveTurns;
  state: DtConnectionState;
  /** Sends a message; resolves with its session (a new one for a new chat). */
  send(request: DtTurnRequest): Promise<string>;
  /** Asks DeepTutor to stop the session's running reply. */
  stop(sessionId: string): Promise<boolean>;
  regenerate(sessionId: string): void;
  /** Answers the questions the session's running turn asked. */
  answer(sessionId: string, answers: { questionId: string; text: string }[]): Promise<boolean>;
  /** Shows a turn already running (started before the app restarted, or on another device). */
  follow(sessionId: string, turnId: string): void;
}

const DtLiveContext = createContext<DtLiveValue | null>(null);

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
  // DeepTutor has no hook of its own: the push relay follows each turn and notifies the phone.
  // Which turns it follows, whether it serves this DeepTutor, and what you asked (by session,
  // "" for a new chat) for the notification's title.
  const [pushWatch] = useState(() => ({ watched: new Set<string>(), relayServes: true, prompts: new Map<string, string>() }));

  const connection = useMemo(() => {
    const sessionKey = (id: string) => [DT_QUERY_ROOT, baseUrl, 'session', id];
    const watchForPush = (sessionId: string, turnId: string) => {
      // Only a DeepTutor the relay serves: another server's sign-in never goes to the relay.
      if (!isRelayServer('deeptutor', baseUrl) || !pushWatch.relayServes || pushWatch.watched.has(turnId)) return;
      pushWatch.watched.add(turnId);
      const cached = queryClient.getQueryData<DtSession>(sessionKey(sessionId));
      const prompt = pushWatch.prompts.get(sessionId) ?? pushWatch.prompts.get('');
      pushWatch.prompts.delete('');
      const title = cached ? sessionTitle(cached) : prompt ? sessionTitle({ title: '', last_message: prompt }) : null;
      void pushTokenIfOn()
        .then((pushToken) => (pushToken ? watchDeepTutorTurn((input, init) => fetch(input, init), token, { pushToken, sessionId, turnId, title, server: baseUrl }) : null))
        .then((result) => {
          if (result === 'unsupported') pushWatch.relayServes = false;
        })
        .catch(() => pushWatch.watched.delete(turnId));
    };
    // The reply is saved when its turn ends: refetch, then let the saved message take over.
    const settle = (live: LiveTurn) => {
      void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, baseUrl, 'sessions'] });
      void queryClient.invalidateQueries({ queryKey: sessionKey(live.sessionId) }).finally(() => turns.remove(live.sessionId, live.turnId));
    };
    return new DtTurnConnection({
      url: turnSocketUrl(baseUrl),
      connect: dtSocketFactory(token),
      onEvent: (event) => {
        const live = turns.apply(event);
        if (event.type === 'session') {
          void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, baseUrl, 'sessions'] });
          watchForPush(event.session_id, event.turn_id);
        }
        if (event.type === 'done') {
          if (live) settle(live);
          // The end of a reply that isn't showing: the saved chat is still worth reading again.
          else void queryClient.invalidateQueries({ queryKey: sessionKey(event.session_id) });
        }
      },
      // After a reply ends, DeepTutor sends the chat's new title: fetch it, but start nothing.
      onLateEvent: (event) => {
        void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, baseUrl, 'sessions'] });
        void queryClient.invalidateQueries({ queryKey: sessionKey(event.session_id) });
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
  }, [baseUrl, token, queryClient, turns, toast, pushWatch]);

  useEffect(() => () => connection.close(), [connection]);

  // A refused socket sign-in: confirm with DeepTutor before signing out, as for a 401.
  useEffect(() => {
    if (state !== 'signed-out') return;
    getAuthStatus(client)
      .then((status) => (status.authenticated ? undefined : signOut({ notice: DT_EXPIRED_NOTICE })))
      .catch(() => undefined);
  }, [state, client, signOut]);

  // Ready before you send: an open socket and this phone's push token. A reply then reaches the
  // relay within a second of sending, before iOS freezes the app if you leave straight away
  // (from a cold start it took about three seconds, and the reply went unnoticed).
  // iOS closes sockets in the background, so coming back opens it again (and resumes any reply).
  useEffect(() => {
    if (isRelayServer('deeptutor', baseUrl)) void pushTokenIfOn();
    connection.connect();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') connection.connect();
    });
    return () => subscription.remove();
  }, [connection, baseUrl]);

  useEffect(() => () => turns.clear(), [turns, connection]);

  const value = useMemo<DtLiveValue>(
    () => ({
      turns,
      state,
      send: async (request) => {
        if (request.persistUserMessage !== false) pushWatch.prompts.set(request.sessionId ?? '', request.content);
        return (await connection.startTurn(request)).sessionId;
      },
      stop: async (sessionId) => {
        const turnId = turns.get(sessionId)?.turnId;
        return turnId ? connection.cancel(turnId) : false;
      },
      regenerate: (sessionId) => connection.regenerate(sessionId),
      answer: async (sessionId, answers) => {
        const turnId = turns.get(sessionId)?.turnId;
        return turnId ? connection.reply(turnId, { answers }) : false;
      },
      follow: (sessionId, turnId) => {
        if (turns.get(sessionId)?.turnId === turnId) return;
        connection.follow(turnId, 0);
      },
    }),
    [connection, state, turns, pushWatch.prompts],
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
