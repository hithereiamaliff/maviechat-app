import { applyGroupFrame, DtGroupSocket, groupFrames, groupHistory, groupRounds, groupSocketUrl, NO_GROUP_LIVE, type DtGroupFrame, type DtGroupLive, type DtGroupSocketState, type DtPartnerGroup } from '@maviechat/deeptutor-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { dtSocketFactory } from '@/features/deeptutor/dtSocket';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';

/**
 * A group discussion: its rounds (stored, plus what's on the way from the group's socket) and the
 * actions on them. Members' steps arrive by the hundred, so the socket's news is applied once a
 * frame. Each operation's end reads the discussion again.
 */
export function useGroupChat(group: DtPartnerGroup | undefined, sessionKey: string | null) {
  const { client, session } = useDtAuthed();
  const queryClient = useQueryClient();
  const groupId = group?.id ?? '';
  const [state, setState] = useState<DtGroupSocketState>('connecting');
  // What's on the way, for the discussion it came from (switching discussions leaves it behind).
  const [tagged, setTagged] = useState<{ key: string | null; live: DtGroupLive }>({ key: null, live: NO_GROUP_LIVE });
  const live = tagged.key === sessionKey ? tagged.live : NO_GROUP_LIVE;
  const socket = useRef<DtGroupSocket | null>(null);
  const keyRef = useRef(sessionKey);
  const pending = useRef<DtGroupFrame[]>([]);
  const scheduled = useRef<number | null>(null);
  // A question you asked one member to put to another: approved the moment DeepTutor files it.
  const asking = useRef<{ requesterId: string; targetId: string; question: string } | null>(null);

  const setLive = useCallback((change: (current: DtGroupLive) => DtGroupLive) => {
    setTagged((previous) => {
      const key = keyRef.current;
      return { key, live: change(previous.key === key ? previous.live : NO_GROUP_LIVE) };
    });
  }, []);

  const historyKey = useMemo(() => [DT_QUERY_ROOT, session.baseUrl, 'partners', 'group-history', groupId, sessionKey] as const, [session.baseUrl, groupId, sessionKey]);
  const history = useQuery({ queryKey: historyKey, queryFn: () => groupHistory(client, groupId, sessionKey as string), enabled: Boolean(groupId && sessionKey) });

  useEffect(() => {
    if (!groupId) return;
    const flush = () => {
      scheduled.current = null;
      const frames = pending.current.splice(0);
      if (!frames.length) return;
      setLive((current) => frames.reduce(applyGroupFrame, current));
      if (frames.some((frame) => frame.type === 'done' || frame.type === 'cancelled' || frame.type === 'error')) {
        void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'partners'] });
      }
    };
    const connection = new DtGroupSocket({
      url: groupSocketUrl(session.baseUrl, groupId),
      connect: dtSocketFactory(session.token),
      onFrame: (frame) => {
        const asked = asking.current;
        if (asked && frame.type === 'invocation_updated' && frame.invocation.status === 'pending' && frame.invocation.requesterId === asked.requesterId && frame.invocation.targetId === asked.targetId && frame.invocation.question === asked.question) {
          asking.current = null;
          if (keyRef.current && connection.send(groupFrames.approve(keyRef.current, frame.invocation.id))) setLive((current) => ({ ...current, running: current.running + 1 }));
        }
        pending.current.push(frame);
        if (scheduled.current === null) scheduled.current = requestAnimationFrame(flush);
      },
      onState: setState,
    });
    socket.current = connection;
    if (keyRef.current) connection.open(keyRef.current);
    const subscription = AppState.addEventListener('change', (appState) => {
      if (appState === 'active') connection.wake();
    });
    return () => {
      subscription.remove();
      if (scheduled.current !== null) cancelAnimationFrame(scheduled.current);
      scheduled.current = null;
      pending.current = [];
      connection.close();
      socket.current = null;
    };
  }, [groupId, session.baseUrl, session.token, queryClient, setLive]);

  // Another discussion: what was on the way belongs to the last one.
  useEffect(() => {
    keyRef.current = sessionKey;
    if (sessionKey) socket.current?.open(sessionKey);
  }, [sessionKey]);

  const memberOrder = useMemo(() => group?.memberIds ?? [], [group]);
  const names = useMemo(() => Object.fromEntries((group?.members ?? []).map((member) => [member.id, member.name])), [group]);
  const rounds = useMemo(() => groupRounds(history.data ?? [], memberOrder, live, names), [history.data, memberOrder, live, names]);

  /** Sends a frame that starts an operation (it counts as running until its end arrives). */
  const start = (data: string) => {
    if (!socket.current?.send(data)) return false;
    setLive((current) => ({ ...current, running: current.running + 1, error: null }));
    return true;
  };
  const key = sessionKey ?? '';

  return {
    state,
    rounds,
    running: live.running > 0,
    error: live.error,
    loading: history.isLoading,
    loadError: history.error,
    reload: () => void history.refetch(),
    send: (content: string, mentions: string[] | null) => start(groupFrames.message(key, content, mentions)),
    approve: (invocationId: string) => start(groupFrames.approve(key, invocationId)),
    reject: (invocationId: string) => Boolean(socket.current?.send(groupFrames.reject(key, invocationId))),
    /** "Ask another member": a proposal you make is approved at once, as on the web. */
    ask: (requesterId: string, targetId: string, question: string) => {
      asking.current = { requesterId, targetId, question };
      return Boolean(socket.current?.send(groupFrames.ask(key, requesterId, targetId, question)));
    },
    retry: (turnId: string, partnerId: string) => start(groupFrames.retry(key, turnId, partnerId)),
    summarise: (turnId: string, partnerId: string) => start(groupFrames.summarise(key, turnId, partnerId)),
    stop: () => Boolean(socket.current?.send(groupFrames.cancel(key))),
    clearError: () => setLive((current) => ({ ...current, error: null })),
  };
}
