import {
  activeTurnOf,
  bookOfPreferences,
  bookTurnFields,
  citedLocators,
  citedTimes,
  getSession,
  isLegacyWatching,
  isPinned,
  masteryOfPreferences,
  masteryTurnFields,
  messageAttachments,
  messageReferences,
  migrateWatchingChat,
  newlyMastered,
  readingOfPreferences,
  readingTurnFields,
  saveQuizResults,
  setMasteryMode,
  savedReply,
  sessionTitle,
  shownMessages,
  type DtMasteryGrade,
  type DtMasteryMode,
  type DtMasteryQuestion,
  type DtMasteryTopic,
  type DtMessage,
  type DtOutline,
  type DtQuizQuestion,
} from '@maviechat/deeptutor-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import type { MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { NEW_CHAT, updateDraft } from '@/features/chat/drafts';
import { capabilityName, isNativeCapability } from '@/features/deeptutor/chat/capabilities';
import { DtComposer } from '@/features/deeptutor/chat/DtComposer';
import { useDtLive, useLiveTurn } from '@/features/deeptutor/chat/DtLiveProvider';
import { DtFindSheet } from '@/features/deeptutor/chat/DtFind';
import { DtMessageList, type DtListItem, type DtMessageListHandle } from '@/features/deeptutor/chat/DtMessageList';
import { extrasRequest, promptExtras, type DtExtras } from '@/features/deeptutor/chat/extras';
import type { PromptExtras } from '@/features/deeptutor/chat/liveTurns';
import type { MasteryCardAnswer } from '@/features/deeptutor/chat/DtMasteryCard';
import type { DtReplyActions } from '@/features/deeptutor/chat/DtReplyView';
import type { QuizAnswer } from '@/features/deeptutor/chat/quiz';
import { useDtChoice } from '@/features/deeptutor/chat/useDtChoice';
import { BookBar } from '@/features/deeptutor/books/BookBar';
import { deepTutorAttachment } from '@/features/deeptutor/crossReference';
import { PathBar } from '@/features/deeptutor/learning/PathBar';
import { ReadingBar } from '@/features/deeptutor/reading/ReadingBar';
import { readingPlaces } from '@/features/deeptutor/reading/readingContext';
import { useDtBook, useDtMasteryTopic, useDtNotebooks, useDtSession, useDtSessions } from '@/features/deeptutor/queries';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { switchToOpenWebUI } from '@/features/deeptutor/switch';
import { TaskLinkSheet } from '@/features/deeptutor/tasks/TaskLinkSheet';
import { useDtChatActions } from '@/features/deeptutor/useDtChatActions';
import { setViewingChat } from '@/features/notifications/presence';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { useSession } from '@/session/SessionProvider';
import { fonts, radius, usePalette } from '@/theme';

/** A DeepTutor chat: its messages, the reply being written, and the composer. */
export default function DeepTutorChat() {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? (params.id[0] ?? '') : (params.id ?? '');
  const { client, session } = useDtAuthed();
  const owui = useSession();
  const live = useDtLive();
  const chatActions = useDtChatActions();
  const turn = useLiveTurn(id);
  const detail = useDtSession(id);
  const capability = typeof detail.data?.capability === 'string' ? detail.data.capability : undefined;
  const choice = useDtChoice(detail.data?.preferences, capability);
  const [pinKey, setPinKey] = useState<string | undefined>(undefined);
  const [attaching, setAttaching] = useState(false);
  const [finding, setFinding] = useState(false);
  const [linkingTasks, setLinkingTasks] = useState(false);
  const listRef = useRef<DtMessageListHandle>(null);
  // Names for what earlier messages referred to (saved as ids).
  const notebooks = useDtNotebooks();
  const chats = useDtSessions('');
  // A mastery path's chat: the path it works on, and its mode.
  const path = masteryOfPreferences(detail.data?.preferences);
  const topic = useDtMasteryTopic(path?.pathId ?? '');
  // A chat about a book's page: the tutor reads the page with every message.
  const page = path ? null : bookOfPreferences(detail.data?.preferences);
  const pageBook = useDtBook(page?.bookId ?? '');
  // A chat about a reading collection: the tutor reads the file and the page you're on.
  const reading = path || page ? null : readingOfPreferences(detail.data?.preferences);
  const readingId = reading?.collectionId ?? '';
  const native = isNativeCapability(capability) || Boolean(path) || Boolean(page) || Boolean(reading);
  // A video chat from before DeepTutor 1.7.1 moves into Reading when it's opened, as on the web:
  // the video joins a collection, and the chat carries on as one of its chats.
  const legacy = detail.data ? isLegacyWatching(detail.data) : false;
  const migration = useQuery({
    queryKey: [DT_QUERY_ROOT, session.baseUrl, 'migrate-watching', id],
    queryFn: async () => {
      const moved = await migrateWatchingChat(client, id);
      if (moved.id === id) queryClient.setQueryData([DT_QUERY_ROOT, session.baseUrl, 'session', id], moved);
      for (const family of ['sessions', 'learning-index', 'reading']) void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, family] });
      return moved.id || id;
    },
    enabled: legacy,
    retry: false,
    staleTime: Infinity,
  });
  useEffect(() => {
    if (migration.data && migration.data !== id) router.replace({ pathname: '/learn/[id]', params: { id: migration.data } });
  }, [migration.data, id]);
  const running = turn?.reply.status === 'running' || turn?.reply.status === 'waiting';

  // After each reply in a path chat, the path is read again; a point newly mastered gets a note
  // (from the screen in front only: the path's page may be open underneath).
  const lastTopic = useRef<DtMasteryTopic | undefined>(undefined);
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
      };
    }, []),
  );
  useEffect(() => {
    const now = topic.data;
    if (!now) return;
    const gained = newlyMastered(lastTopic.current, now);
    lastTopic.current = now;
    if (gained.length && focused.current) toast(`Mastered: ${gained.map((point) => point.name).join(', ')}`, 'success');
  }, [topic.data, toast]);
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running && path) void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'mastery'] });
    wasRunning.current = running;
  }, [running, path, queryClient, session.baseUrl]);

  // Passage actions in the reader carry on in the reading chat you're in.
  useFocusEffect(
    useCallback(() => {
      if (readingId) readingPlaces.update(readingId, { chatId: id });
    }, [readingId, id]),
  );

  // A notification about the chat on screen needs no banner.
  useFocusEffect(
    useCallback(() => {
      setViewingChat(id);
      return () => setViewingChat(null);
    }, [id]),
  );

  // A reply still being written (started before the app restarted, or elsewhere): follow it.
  const activeTurn = detail.data ? activeTurnOf(detail.data) : null;
  useEffect(() => {
    if (activeTurn && !turn) live.follow(id, activeTurn);
  }, [activeTurn, turn, live, id]);

  // Saved messages change only when the session is fetched again, so a streaming reply leaves them be.
  const saved = useMemo(() => (detail.data ? shownMessages(detail.data) : []), [detail.data]);
  const savedItems = useMemo(() => {
    const signedIn = { Authorization: `Bearer ${session.token}` };
    const notebookName = (id: string) => notebooks.data?.find((notebook) => notebook.id === id)?.name ?? 'Notebook';
    const chatTitle = (id: string) => {
      const chat = chats.data?.find((item) => item.id === id);
      return chat ? sessionTitle(chat) : 'Earlier chat';
    };
    const userItem = (message: DtMessage): DtListItem => {
      const references = messageReferences(message);
      return {
        key: `m${message.id}`,
        kind: 'user',
        text: message.content,
        attachments: messageAttachments(message).map((attachment, index) => ({
          key: `${message.id}-${index}`,
          type: attachment.type,
          filename: attachment.filename,
          uri: attachment.url ? `${session.baseUrl}${attachment.url}` : null,
          headers: signedIn,
        })),
        references: [
          ...references.notebooks.map((id) => ({ key: `n${id}`, icon: 'book-open' as const, label: notebookName(id) })),
          ...references.chats.map((id) => ({ key: `c${id}`, icon: 'chat-bubble-left' as const, label: chatTitle(id) })),
          ...references.knowledgeBases.map((name) => ({ key: `k${name}`, icon: 'archive-box' as const, label: name })),
        ],
      };
    };
    return saved.flatMap((message): DtListItem[] =>
      message.role === 'user'
        ? [userItem(message)]
        : message.role === 'assistant'
          ? [{ key: `m${message.id}`, kind: 'reply', reply: savedReply(message), last: false }]
          : [],
    );
  }, [saved, session.baseUrl, session.token, notebooks.data, chats.data]);
  const items = useMemo(() => {
    const list = [...savedItems];
    const replySaved = turn?.reply.assistantMessageId != null && saved.some((message) => String(message.id) === String(turn.reply.assistantMessageId));
    if (turn && !replySaved) {
      const lastSaved = saved[saved.length - 1];
      if (turn.prompt !== null) {
        // Your message is saved when the turn starts; until the session shows it, show it here.
        if (!(lastSaved?.role === 'user' && lastSaved.content.trim() === turn.prompt.trim())) list.push({ key: 'live-prompt', kind: 'user', text: turn.prompt, ...pendingExtras(turn.promptExtras) });
      } else if (turn.replacesLast && lastSaved?.role === 'assistant') {
        // A regenerate: the new reply takes the old one's place.
        list.pop();
      }
      list.push({ key: 'live-reply', kind: 'reply', reply: turn.reply, last: false });
    }
    const last = list[list.length - 1];
    if (last?.kind === 'reply') list[list.length - 1] = { ...last, last: true };
    return list;
  }, [saved, savedItems, turn]);

  // DeepTutor doesn't remember the reading place between messages: the reader's (and a passage you chose) go each time.
  const readingRequest = (text: string, extras: DtExtras, target: { collectionId: string; materialId: string }) => {
    const place = readingPlaces.get(target.collectionId);
    const selection = readingPlaces.takeSelection(target.collectionId);
    const materialId = place?.materialId || target.materialId || null;
    const here = place && place.materialId === materialId ? place : undefined;
    return {
      content: text,
      sessionId: id,
      llmSelection: choice.model,
      ...extrasRequest(extras),
      ...readingTurnFields({ collectionId: target.collectionId, materialId, revision: here?.revision, viewport: { locator: here?.locator, selection, timeSeconds: here?.timeSeconds } }),
    };
  };

  const send = async (text: string, extras: DtExtras) => {
    live.turns.begin(id, text, promptExtras(extras, choice.selectedKnowledgeBases));
    setPinKey(`send-${Date.now()}`);
    try {
      await live.send(
        path
          ? // A path chat keeps its path and mode on every turn; the tutor brings its own tools.
            { content: text, sessionId: id, ...masteryTurnFields(path.pathId, null), llmSelection: choice.model, knowledgeBases: choice.selectedKnowledgeBases, ...extrasRequest(extras) }
          : reading
            ? readingRequest(text, extras, reading)
            : page
            ? // A page's chat sends the page each time, with the book's knowledge bases (the chat keeps its own until the book is read).
              {
                content: text,
                sessionId: id,
                ...(pageBook.data ? bookTurnFields(pageBook.data.book, page.pageId) : { capability: 'chat', bookReferences: [{ book_id: page.bookId, page_ids: [page.pageId] }] }),
                llmSelection: choice.model,
                ...extrasRequest(extras),
              }
            : { content: text, sessionId: id, ...choice.request, ...extrasRequest(extras) },
      );
      return true;
    } catch (error) {
      live.turns.remove(id);
      toast(`Couldn't send: ${describeError(error)}`, 'error');
      return false;
    }
  };

  const regenerate = () => {
    live.turns.beginRegenerate(id);
    setPinKey(`regenerate-${Date.now()}`);
    live.regenerate(id);
  };

  // Research's outline → the research: the same question again, with the outline confirmed and no new message.
  const startResearch = async (outline: DtOutline) => {
    const question = [...saved].reverse().find((message) => message.role === 'user')?.content ?? '';
    live.turns.beginContinuation(id);
    setPinKey(`research-${Date.now()}`);
    try {
      await live.send({
        content: outline.topic || question,
        sessionId: id,
        capability: 'deep_research',
        config: { ...outline.config, confirmed_outline: outline.subTopics },
        persistUserMessage: false,
        llmSelection: choice.model,
      });
    } catch (error) {
      live.turns.remove(id);
      toast(`Couldn't start the research: ${describeError(error)}`, 'error');
    }
  };

  // A question card from a path's tutor: your answer (or a skip) is your next message.
  const answerCard = async (question: DtMasteryQuestion, reply: MasteryCardAnswer, skip = false) => {
    if (!path) return false;
    const content = skip ? "Let's skip this question." : reply.text;
    live.turns.begin(id, content);
    setPinKey(`card-${Date.now()}`);
    try {
      await live.send({
        content,
        sessionId: id,
        ...masteryTurnFields(path.pathId, null),
        llmSelection: choice.model,
        ...(skip
          ? { masterySkip: { question_id: question.id } }
          : { masteryAnswer: { question_id: question.id, text: reply.text, ...(question.type === 'group' && reply.answers ? { answers: reply.answers } : {}) } }),
      });
      return true;
    } catch (error) {
      live.turns.remove(id);
      toast(`Couldn't send: ${describeError(error)}`, 'error');
      return false;
    }
  };

  const switchMode = async (mode: DtMasteryMode) => {
    if (!path) return;
    try {
      await setMasteryMode(client, path.pathId, id, mode);
      void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'session', id] });
    } catch (error) {
      toast(`Couldn't switch: ${describeError(error)}`, 'error');
    }
  };

  // Rulings on the tutor's questions arrive with later replies, so they're gathered across the chat.
  // The pages and moments the tutor's latest answer cites, a tap away in the reader.
  const cited = useMemo(() => {
    const last = readingId ? [...items].reverse().find((item) => item.kind === 'reply') : undefined;
    return last?.kind === 'reply' ? { pages: citedLocators(last.reply.answer), times: citedTimes(last.reply.answer) } : { pages: [], times: [] };
  }, [items, readingId]);

  const masteryState = useMemo(() => {
    const grades: Record<string, DtMasteryGrade> = {};
    const skipped: string[] = [];
    const rejected = new Set<string>();
    for (const item of items) {
      if (item.kind !== 'reply') continue;
      for (const grade of item.reply.mastery.grades) {
        grades[grade.questionId] = grade;
        for (const part of grade.parts) grades[part.questionId] = part;
        rejected.delete(grade.questionId);
      }
      skipped.push(...item.reply.mastery.skipped);
      for (const questionId of item.reply.mastery.rejected) rejected.add(questionId);
    }
    return { grades, skipped, rejected: [...rejected] };
  }, [items]);

  const answer = async (answers: { questionId: string; text: string }[]) => {
    const accepted = await live.answer(id, answers);
    if (!accepted) toast("DeepTutor didn't take the answers. The question may have expired.", 'error');
    return accepted;
  };

  const saveQuiz = async (turnId: string, questions: DtQuizQuestion[], answers: Record<string, QuizAnswer>) => {
    await saveQuizResults(
      client,
      id,
      turnId,
      questions.map((question) => ({
        question_id: question.id,
        question: question.question,
        question_type: question.type,
        options: Object.fromEntries(question.options.map((option) => [option.key, option.text])),
        user_answer: answers[question.id]?.value ?? '',
        correct_answer: question.answer,
        explanation: question.explanation,
        difficulty: question.difficulty,
        is_correct: answers[question.id]?.correct === true,
      })),
    );
    void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'session', id] });
  };

  const stop = () => {
    void live.stop(id).then(async (accepted) => {
      if (accepted) return;
      // Nothing to stop: if DeepTutor says no reply is running, let go of the one showing, so you can send again.
      const fresh = await queryClient
        .fetchQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'session', id], queryFn: () => getSession(client, id), staleTime: 0 })
        .catch(() => null);
      if (fresh && !activeTurnOf(fresh)) {
        live.turns.remove(id);
        toast('That reply had already finished.');
      } else {
        toast("DeepTutor didn't stop the reply. Try again in a moment.", 'error');
      }
    });
  };

  // DeepTutor → Open WebUI: the chat becomes an attachment on a new Open WebUI chat.
  const askInOpenWebUI = async () => {
    setAttaching(true);
    try {
      const item = await deepTutorAttachment(client, id);
      updateDraft(NEW_CHAT, (draft) => ({ ...draft, files: [...draft.files, item] }));
      switchToOpenWebUI();
      toast('Attached to a new chat. Ask your question about it.');
    } catch (error) {
      toast(`Couldn't attach this chat: ${describeError(error)}`, 'error');
    } finally {
      setAttaching(false);
    }
  };

  const title = detail.data ? sessionTitle(detail.data) : turn?.prompt ? sessionTitle({ title: '', last_message: turn.prompt }) : 'DeepTutor chat';
  const leave = () => router.replace('/learn');
  const pinned = detail.data ? isPinned(detail.data) : false;

  const openOnWeb = () => router.push({ pathname: '/learn/web', params: { path: `/chat/${encodeURIComponent(id)}` } });
  // Replies get handlers that stay the same between frames (the latest version runs when tapped).
  const handlers = useRef({ regenerate, startResearch, answer, saveQuiz, openOnWeb, answerCard });
  useEffect(() => {
    handlers.current = { regenerate, startResearch, answer, saveQuiz, openOnWeb, answerCard };
  });
  const inPath = Boolean(path);
  const actions = useMemo<DtReplyActions>(
    () => ({
      // A path's tutor keeps score of each answer, so its replies aren't regenerated.
      onRegenerate: native && !inPath && !running ? () => handlers.current.regenerate() : undefined,
      onStartResearch: running ? undefined : (outline) => handlers.current.startResearch(outline),
      onAnswer: (answers) => handlers.current.answer(answers),
      onSaveQuiz: (turnId, questions, answers) => handlers.current.saveQuiz(turnId, questions, answers),
      onOpenWeb: () => handlers.current.openOnWeb(),
      mastery: inPath
        ? {
            ...masteryState,
            onAnswer: running ? undefined : (question, reply) => handlers.current.answerCard(question, reply),
            onSkip: running ? undefined : (question) => handlers.current.answerCard(question, { text: '' }, true),
          }
        : undefined,
    }),
    [native, inPath, running, masteryState],
  );
  const openPath = () => (path ? router.push({ pathname: '/learn/mastery/[id]', params: { id: path.pathId } }) : undefined);
  const openPage = () => (page?.pageId ? router.push({ pathname: '/learn/books/[id]/[page]', params: { id: page.bookId, page: page.pageId } }) : undefined);
  const waypoint = topic.data?.next?.pointName || topic.data?.modules.flatMap((module) => module.points).find((point) => point.status !== 'mastered')?.name;
  const menu: MenuItem[] = [
    ...(path ? [{ key: 'path', label: 'Open the Path', icon: 'map' as const, onPress: openPath }] : []),
    ...(page?.pageId && !pageBook.isError ? [{ key: 'page', label: 'Open the Page', icon: 'book-open' as const, onPress: openPage }] : []),
    ...(reading ? [{ key: 'collection', label: 'Open the Collection', icon: 'folder' as const, onPress: () => router.push({ pathname: '/learn/reading/[id]', params: { id: reading.collectionId } }) }] : []),
    ...(owui.state.status === 'signed-in' && items.length > 0
      ? [{ key: 'ask', label: attaching ? 'Attaching…' : 'Ask About It in Open WebUI', icon: 'chat-bubble-left' as const, onPress: () => void askInOpenWebUI() }]
      : []),
    { key: 'find', label: 'Find in Chat', icon: 'magnifying-glass', onPress: () => setFinding(true) },
    { key: 'rename', label: 'Rename Chat', icon: 'pencil', onPress: () => chatActions.rename(id, detail.data ? sessionTitle(detail.data) : '') },
    ...(detail.data ? [{ key: 'tasks', label: 'Linked Tasks', icon: 'view-columns' as const, onPress: () => setLinkingTasks(true) }] : []),
    ...(detail.data
      ? [
          {
            key: 'pin',
            label: pinned ? 'Unpin Chat' : 'Pin Chat',
            icon: pinned ? ('bookmark-slash' as const) : ('bookmark' as const),
            onPress: () => chatActions.setPinned(id, !pinned),
          },
          { key: 'archive', label: 'Archive Chat', icon: 'archive-box' as const, onPress: () => chatActions.setArchived(id, true, leave) },
        ]
      : []),
    { key: 'web', label: 'Open in DeepTutor Web App', icon: 'arrow-top-right-on-square', onPress: openOnWeb },
    { key: 'delete', label: 'Delete Chat', icon: 'trash', destructive: true, onPress: () => chatActions.remove(id, leave) },
  ];

  return (
    <View style={styles.screen}>
      <DtHeader title={title} menu={menu} />
      {path ? (
        <PathBar topic={topic.data} mode={path.mode ?? 'study'} onMode={running ? undefined : (mode) => void switchMode(mode)} onOpenPath={() => openPath()} />
      ) : null}
      {page ? <BookBar bookId={page.bookId} pageId={page.pageId} /> : null}
      {reading ? <ReadingBar collectionId={reading.collectionId} materialId={reading.materialId} cited={cited.pages} times={cited.times} /> : null}
      {legacy ? (
        <View style={styles.moving}>
          {migration.isError ? (
            <>
              <Text style={[styles.webNoteText, { color: palette.textMuted }]}>{`Couldn't move this video chat into Reading: ${describeError(migration.error)}`}</Text>
              <Button label="Try Again" onPress={() => void migration.refetch()} />
              <Button label="Open in DeepTutor Web App" variant="secondary" onPress={openOnWeb} />
            </>
          ) : (
            <>
              <ActivityIndicator color={palette.textMuted} />
              <Text style={[styles.webNoteText, { color: palette.textMuted }]}>Moving this video chat into Reading…</Text>
            </>
          )}
        </View>
      ) : null}
      <KeyboardAvoidingView behavior="padding" style={[styles.body, legacy && styles.hidden]}>
        {detail.isLoading && !turn ? (
          <ActivityIndicator style={styles.loading} color={palette.textMuted} />
        ) : detail.isError && !turn ? (
          <Text style={[styles.empty, { color: palette.textMuted }]}>{`Couldn't load this chat: ${describeError(detail.error)}`}</Text>
        ) : (
          <DtMessageList ref={listRef} items={items} baseUrl={session.baseUrl} actions={actions} pinToBottomKey={pinKey} />
        )}
        {native ? (
          <DtComposer
            draftKey={`dt:${id}`}
            running={running}
            onSend={send}
            onStop={stop}
            // A page's chat uses your own tool settings and the book's knowledge bases, as on DeepTutor.
            tools={page || reading ? [] : choice.tools}
            selectedTools={page || reading ? [] : choice.selectedTools}
            onToolsChange={choice.setSelectedTools}
            models={choice.models}
            model={choice.model}
            onModelChange={choice.setModel}
            // A path chat's mode is the path's own (above); DeepTutor's other modes aren't offered here.
            modes={path || page || reading ? [] : choice.modes}
            mode={path ? 'mastery_path' : page || reading ? 'chat' : choice.mode}
            onModeChange={choice.setMode}
            placeholder={path ? (waypoint ? `Ask your tutor about "${waypoint}"` : 'Ask your tutor') : page ? 'Ask about this page' : reading ? "Ask about what you're reading" : undefined}
            config={choice.config}
            onSettingChange={choice.setSetting}
            knowledgeBases={choice.knowledgeBases}
            selectedKnowledgeBases={page || reading ? [] : choice.selectedKnowledgeBases}
            onKnowledgeBasesChange={choice.setSelectedKnowledgeBases}
            knowledgeFixed={Boolean(page || reading)}
            personal={path || page || reading ? undefined : choice.personal}
            sessionId={id}
          />
        ) : (
          <View style={[styles.webNote, { backgroundColor: palette.surface }]}>
            <Text style={[styles.webNoteText, { color: palette.textMuted }]}>
              {`This chat uses DeepTutor's ${capabilityName(capability)} mode, which the app shows read-only for now. Continue it in the DeepTutor web app.`}
            </Text>
            <Button label="Open in DeepTutor Web App" onPress={openOnWeb} />
          </View>
        )}
      </KeyboardAvoidingView>
      <DtFindSheet
        visible={finding}
        items={items}
        onClose={() => setFinding(false)}
        onPick={(key) => {
          setFinding(false);
          // After the sheet has gone, so the list can move.
          setTimeout(() => listRef.current?.scrollToKey(key), 400);
        }}
      />
      <TaskLinkSheet sessionId={id} visible={linkingTasks} onClose={() => setLinkingTasks(false)} />
    </View>
  );
}

/** Your message's photos, files and references, shown until the saved session has it. */
function pendingExtras(extras: PromptExtras | undefined): Pick<Extract<DtListItem, { kind: 'user' }>, 'attachments' | 'references'> {
  if (!extras) return {};
  const icons = { notebook: 'book-open', chat: 'chat-bubble-left', knowledge: 'archive-box' } as const;
  return {
    attachments: extras.attachments,
    references: extras.references.map((reference) => ({ key: reference.key, icon: icons[reference.kind], label: reference.label })),
  };
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1 },
  loading: { marginTop: 32 },
  empty: { flex: 1, fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: 32, paddingHorizontal: 24 },
  webNote: { margin: 12, marginBottom: 24, padding: 14, gap: 10, borderRadius: radius.lg },
  webNoteText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  moving: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  hidden: { display: 'none' },
});
