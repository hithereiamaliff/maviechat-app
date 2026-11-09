import { isTemporaryChatId, openSocketSession, type AskUserAnswer, type AskUserQuestion, type CodeOutput, type SocketSession, type SocketStatus } from '@maviechat/owui-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { showPrompt } from '@/components/dialogs';
import { AskUserCard } from '@/features/chat/AskUserCard';
import { patchChatRow } from '@/features/chats/cache';
import { setViewingChat } from '@/features/notifications/presence';
import { pushAnnouncesReplies } from '@/features/notifications/push';
import { PythonHost } from '@/features/python/PythonHost';
import { offerScriptFile, offerScriptPage, RunCodeSheet, type RunChoice } from '@/features/script/RunCodeSheet';
import { ScriptRunner } from '@/features/script/runner';
import { ScriptHost } from '@/features/script/ScriptHost';
import { PythonRunner } from '@/features/python/runner';
import { pythonFiles } from '@/features/python/serverFiles';
import { devicePrefs, setDevicePrefs } from '@/lib/devicePrefs';
import { useAuthed, useCapabilities } from '@/lib/server';
import { fonts, usePalette } from '@/theme';
import { ChatStreams } from './chatStreams';

interface LiveContextValue {
  status: SocketStatus | 'idle';
  streams: ChatStreams;
  /** The socket id to send as `session_id`; waits up to `timeoutMs` for the socket to join. */
  waitForSession(timeoutMs?: number): Promise<string>;
  /** Tells the server (and the sidebar) you've read this chat, as the web does on open, on leave and when a reply lands. */
  markRead(chatId: string): void;
  /** Runs Python on the phone (Pyodide, as the web runs it in the browser), sharing state with the code interpreter's runs. */
  runPython(code: string): Promise<CodeOutput>;
  /** Follows a note's changes from the web or another device (`events:note`) until the returned function is called. */
  watchNote(noteId: string, listener: (change: unknown) => void): () => void;
}

/** The web waits this long before saying the connection was lost, so brief drops pass silently. */
const LOST_NOTICE_DELAY_MS = 2000;

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
  return new Promise((resolve) =>
    showPrompt(
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
  // Notes followed, kept here so a socket opened later (or again) follows them too.
  const noteWatches = useRef(new Set<{ noteId: string; listener: (change: unknown) => void; stop?: () => void }>());
  const [status, setStatus] = useState<SocketStatus | 'idle'>('idle');
  const lostTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnedLost = useRef(false);

  useEffect(() => {
    viewing.current = currentChatId;
  }, [currentChatId]);

  // Push banners show while the app is open too, except for the chat on screen.
  useEffect(() => {
    setViewingChat(currentChatId);
  }, [currentChatId]);
  useEffect(() => () => setViewingChat(null), []);

  // Python for code blocks' Run and the code interpreter, started on first use.
  const [python] = useState(() => new PythonRunner());
  useEffect(() => () => python.dispose(), [python]);
  // The latest sign-in, for fetching the code interpreter's files.
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Tools' JavaScript, each run in a fresh sealed page; what it offers (files, pages) goes to the person.
  const [script] = useState(() => new ScriptRunner({ file: offerScriptFile, open: offerScriptPage }));
  useEffect(() => () => script.dispose(), [script]);
  // Asked one at a time, in a sheet, before any of it runs (unless this phone says otherwise).
  const [askingCode, setAskingCode] = useState<{ code: string; done: (choice: RunChoice) => void } | null>(null);
  const asks = useRef<Promise<unknown>>(Promise.resolve());
  const askToRun = (code: string): Promise<RunChoice> => {
    const asked = asks.current.then(() => new Promise<RunChoice>((resolve) => setAskingCode({ code, done: resolve })));
    asks.current = asked.catch(() => undefined);
    return asked;
  };

  // The model's questions asked live, one set at a time, answered in a sheet.
  const [asking, setAsking] = useState<{ questions: AskUserQuestion[]; deadline: number | null; done: (answers: Record<string, AskUserAnswer> | null) => void } | null>(null);
  const [streams] = useState(
    () =>
      new ChatStreams(queryClient, {
        confirm,
        prompt,
        ask: (questions, deadline) => new Promise((resolve) => setAsking({ questions, deadline, done: resolve })),
        notify: (message, tone) => toast(message, tone),
        isViewing: (chatId) => viewing.current === chatId,
        // Open WebUI reports saved chats' replies only, so temporary chats keep the app's own notice.
        pushAnnounces: (chatId) => !isTemporaryChatId(chatId) && pushAnnouncesReplies(session.user.id),
        // The code interpreter's code, with the chat's files in /mnt/uploads, as the web runs it.
        runPython: async (code, files) => {
          const { files: prepared, notes } = await pythonFiles(sessionRef.current, files);
          const output = await python.run({ code, files: prepared });
          return notes.length ? { ...output, stderr: `${notes.join('\n')}\n${output.stderr}` } : output;
        },
        // A tool's JavaScript, as the web runs it, but sealed off from the app; the server gets its result, or why not.
        runScript: async (code) => {
          const mode = devicePrefs().toolCode;
          if (mode === 'never') return { error: 'Running tools’ JavaScript is turned off on this phone.' };
          if (mode === 'ask') {
            const choice = await askToRun(code);
            if (choice === 'skip') return { error: 'The user chose not to run this code on their phone.' };
            if (choice === 'always') setDevicePrefs({ toolCode: 'run' });
          }
          const outcome = await script.run(code);
          return outcome.ok ? outcome.result : { error: `The code failed: ${outcome.error}` };
        },
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
      onStatus: (next) => {
        setStatus(next);
        if (next === 'reconnecting' && !lostTimer.current) {
          lostTimer.current = setTimeout(() => {
            lostTimer.current = null;
            if (socketRef.current?.status === 'joined' || AppState.currentState !== 'active') return;
            warnedLost.current = true;
            toast('Connection lost. Reconnecting…', 'error');
          }, LOST_NOTICE_DELAY_MS);
        } else if (next === 'joined') {
          if (lostTimer.current) clearTimeout(lostTimer.current);
          lostTimer.current = null;
          if (warnedLost.current) toast('Reconnected', 'success');
          warnedLost.current = false;
        }
      },
    });
    socketRef.current = socket;
    const stop = socket.onChatEvent((event, reply) => streams.handle(event, reply));
    const watches = noteWatches.current;
    for (const watch of watches) watch.stop = socket.watchNote(watch.noteId, watch.listener);
    return () => {
      stop();
      for (const watch of watches) {
        watch.stop?.();
        watch.stop = undefined;
      }
      if (lostTimer.current) clearTimeout(lostTimer.current);
      lostTimer.current = null;
      socket.close();
      socketRef.current = null;
    };
  }, [baseUrl, token, userId, websocketOnly, heartbeatIntervalSec, streams, toast]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      if (viewing.current) void queryClient.invalidateQueries({ queryKey: ['chat', viewing.current] });
    });
    return () => subscription.remove();
  }, [queryClient]);

  // Stable, so screens can mark read in effects without re-running them on every socket status change.
  const markRead = useCallback(
    (chatId: string) => {
      if (!chatId || isTemporaryChatId(chatId)) return;
      socketRef.current?.markRead(chatId);
      patchChatRow(queryClient, chatId, { last_read_at: Math.floor(Date.now() / 1000) });
    },
    [queryClient],
  );

  const runPython = useCallback((code: string) => python.run({ code }), [python]);

  const watchNote = useCallback((noteId: string, listener: (change: unknown) => void) => {
    const watch: { noteId: string; listener: (change: unknown) => void; stop?: () => void } = { noteId, listener, stop: socketRef.current?.watchNote(noteId, listener) };
    noteWatches.current.add(watch);
    return () => {
      watch.stop?.();
      noteWatches.current.delete(watch);
    };
  }, []);

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
      markRead,
      runPython,
      watchNote,
    }),
    [status, streams, markRead, runPython, watchNote],
  );

  const decide = (choice: RunChoice) => {
    askingCode?.done(choice);
    setAskingCode(null);
  };
  const finish = (answers: Record<string, AskUserAnswer> | null) => {
    asking?.done(answers);
    setAsking(null);
  };
  return (
    <LiveContext.Provider value={value}>
      {children}
      <PythonHost runner={python} baseUrl={baseUrl} />
      <ScriptHost runner={script} />
      <Modal visible={askingCode !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => decide('skip')}>
        {askingCode ? <RunCodeSheet code={askingCode.code} onChoose={decide} /> : null}
      </Modal>
      <Modal visible={asking !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => finish(null)}>
        {asking ? <LiveQuestions questions={asking.questions} deadline={asking.deadline} onDone={finish} /> : null}
      </Modal>
    </LiveContext.Provider>
  );
}

function LiveQuestions({ questions, deadline, onDone }: { questions: AskUserQuestion[]; deadline: number | null; onDone: (answers: Record<string, AskUserAnswer> | null) => void }) {
  const palette = usePalette();
  const skip = useCallback(() => onDone(null), [onDone]);
  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
        The model has a question
      </Text>
      <Text style={[styles.note, { color: palette.textMuted }]}>Its reply waits for your answer.</Text>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <AskUserCard questions={questions} deadline={deadline} onSubmit={(answers) => onDone(answers)} onSkip={skip} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingTop: 20 },
  title: { fontFamily: fonts.semibold, fontSize: 18, paddingHorizontal: 20 },
  note: { fontFamily: fonts.regular, fontSize: 14, paddingHorizontal: 20, marginTop: 4 },
  content: { padding: 16 },
});

export function useLive(): LiveContextValue {
  const value = useContext(LiveContext);
  if (!value) throw new Error('useLive must be used inside LiveProvider');
  return value;
}
