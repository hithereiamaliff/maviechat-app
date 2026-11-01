import { openSocketSession, type SocketSession, type SocketStatus } from '@maviechat/owui-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, AppState, Platform } from 'react-native';
import { useToast } from '@/components/Toast';
import { useAuthed, useCapabilities } from '@/lib/server';
import { ChatStreams } from './chatStreams';

interface LiveContextValue {
  status: SocketStatus | 'idle';
  streams: ChatStreams;
  /** The socket id to send as `session_id`; waits up to `timeoutMs` for the socket to join. */
  waitForSession(timeoutMs?: number): Promise<string>;
}

const LiveContext = createContext<LiveContextValue | null>(null);

function confirm(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Confirm', onPress: () => resolve(true) },
    ]),
  );
}

function prompt(title: string, message: string, _placeholder?: string, value?: string): Promise<string | false> {
  if (Platform.OS !== 'ios') return Promise.resolve(false);
  return new Promise((resolve) =>
    Alert.prompt(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'OK', onPress: (text?: string) => resolve(text ?? '') },
      ],
      'plain-text',
      value,
    ),
  );
}

/**
 * One live socket for the signed-in app. Every chat event goes to `ChatStreams`;
 * coming back from the background refreshes the open chat and the sidebar
 * (the server keeps generating while the app is away).
 */
export function LiveProvider({ currentChatId, children }: { currentChatId: string | null; children: ReactNode }) {
  const { session } = useAuthed();
  const capabilities = useCapabilities();
  const queryClient = useQueryClient();
  const toast = useToast();
  const viewing = useRef<string | null>(currentChatId);
  const socketRef = useRef<SocketSession | null>(null);
  const [status, setStatus] = useState<SocketStatus | 'idle'>('idle');

  useEffect(() => {
    viewing.current = currentChatId;
  }, [currentChatId]);

  const [streams] = useState(
    () =>
      new ChatStreams(queryClient, {
        confirm,
        prompt,
        notify: (message, tone) => toast(message, tone),
        isViewing: (chatId) => viewing.current === chatId,
      }),
  );

  const { baseUrl, token } = session;
  const userId = session.user.id;
  const websocketOnly = capabilities?.websocketOnly;
  const heartbeatIntervalSec = capabilities?.heartbeatIntervalSec;

  useEffect(() => {
    if (websocketOnly === undefined) return;
    const socket = openSocketSession({
      baseUrl,
      token,
      expectedUserId: userId,
      websocketOnly,
      heartbeatIntervalSec,
      onStatus: (next) => setStatus(next),
    });
    socketRef.current = socket;
    const stop = socket.onChatEvent((event, reply) => streams.handle(event, reply));
    return () => {
      stop();
      socket.close();
      socketRef.current = null;
    };
  }, [baseUrl, token, userId, websocketOnly, heartbeatIntervalSec, streams]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      if (viewing.current) void queryClient.invalidateQueries({ queryKey: ['chat', viewing.current] });
    });
    return () => subscription.remove();
  }, [queryClient]);

  const value = useMemo<LiveContextValue>(
    () => ({
      status,
      streams,
      waitForSession: async (timeoutMs = 6000) => {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
          const socket = socketRef.current;
          if (socket?.status === 'joined' && socket.sessionId) return socket.sessionId;
          if (Date.now() > deadline) throw new Error('not connected');
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      },
    }),
    [status, streams],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveContextValue {
  const value = useContext(LiveContext);
  if (!value) throw new Error('useLive must be used inside LiveProvider');
  return value;
}
