import { activeTurnOf, deleteSession, saveQuizResults, savedReply, sessionTitle, shownMessages, type DtOutline, type DtQuizQuestion } from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/IconButton';
import { MenuButton, type MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { NEW_CHAT, updateDraft } from '@/features/chat/drafts';
import { capabilityName, isNativeCapability } from '@/features/deeptutor/chat/capabilities';
import { DtComposer } from '@/features/deeptutor/chat/DtComposer';
import { useDtLive, useLiveTurn } from '@/features/deeptutor/chat/DtLiveProvider';
import { DtMessageList, type DtListItem } from '@/features/deeptutor/chat/DtMessageList';
import type { DtReplyActions } from '@/features/deeptutor/chat/DtReplyView';
import type { QuizAnswer } from '@/features/deeptutor/chat/quiz';
import { useDtChoice } from '@/features/deeptutor/chat/useDtChoice';
import { deepTutorAttachment } from '@/features/deeptutor/crossReference';
import { sessionDate, useDtSession } from '@/features/deeptutor/queries';
import { SpaceHeader } from '@/features/deeptutor/SpaceHeader';
import { SwitchToOpenWebUIButton } from '@/features/deeptutor/SpaceSwitch';
import { switchToOpenWebUI } from '@/features/deeptutor/switch';
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
  const turn = useLiveTurn(id);
  const detail = useDtSession(id);
  const capability = typeof detail.data?.capability === 'string' ? detail.data.capability : undefined;
  const choice = useDtChoice(detail.data?.preferences, capability);
  const [pinKey, setPinKey] = useState<string | undefined>(undefined);
  const [attaching, setAttaching] = useState(false);
  const native = isNativeCapability(capability);
  const running = turn?.reply.status === 'running' || turn?.reply.status === 'waiting';

  // A reply still being written (started before the app restarted, or elsewhere): follow it.
  const activeTurn = detail.data ? activeTurnOf(detail.data) : null;
  useEffect(() => {
    if (activeTurn && !turn) live.follow(id, activeTurn);
  }, [activeTurn, turn, live, id]);

  // Saved messages change only when the session is fetched again, so a streaming reply leaves them be.
  const saved = useMemo(() => (detail.data ? shownMessages(detail.data) : []), [detail.data]);
  const savedItems = useMemo(
    () =>
      saved.flatMap((message): DtListItem[] =>
        message.role === 'user'
          ? [{ key: `m${message.id}`, kind: 'user', text: message.content }]
          : message.role === 'assistant'
            ? [{ key: `m${message.id}`, kind: 'reply', reply: savedReply(message), last: false }]
            : [],
      ),
    [saved],
  );
  const items = useMemo(() => {
    const list = [...savedItems];
    const replySaved = turn?.reply.assistantMessageId != null && saved.some((message) => String(message.id) === String(turn.reply.assistantMessageId));
    if (turn && !replySaved) {
      const lastSaved = saved[saved.length - 1];
      if (turn.prompt !== null) {
        // Your message is saved when the turn starts; until the session shows it, show it here.
        if (!(lastSaved?.role === 'user' && lastSaved.content.trim() === turn.prompt.trim())) list.push({ key: 'live-prompt', kind: 'user', text: turn.prompt });
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

  const send = async (text: string) => {
    live.turns.begin(id, text);
    setPinKey(`send-${Date.now()}`);
    try {
      await live.send({ content: text, sessionId: id, ...choice.request });
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
    void live.stop(id).then((accepted) => {
      if (!accepted) toast("DeepTutor didn't stop the reply. It may have finished already.", 'error');
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

  const confirmDelete = () =>
    Alert.alert('Delete this chat?', 'It moves to the recycle bin in DeepTutor.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deleteSession(client, id)
            .then(() => {
              void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'sessions'] });
              live.turns.remove(id);
              if (router.canGoBack()) router.back();
              else router.replace('/learn');
            })
            .catch((error: unknown) => toast(`Couldn't delete: ${describeError(error)}`, 'error')),
      },
    ]);

  const openOnWeb = () => router.push({ pathname: '/learn/web', params: { path: `/chat/${encodeURIComponent(id)}` } });
  // Replies get handlers that stay the same between frames (the latest version runs when tapped).
  const handlers = useRef({ regenerate, startResearch, answer, saveQuiz, openOnWeb });
  useEffect(() => {
    handlers.current = { regenerate, startResearch, answer, saveQuiz, openOnWeb };
  });
  const actions = useMemo<DtReplyActions>(
    () => ({
      onRegenerate: native && !running ? () => handlers.current.regenerate() : undefined,
      onStartResearch: running ? undefined : (outline) => handlers.current.startResearch(outline),
      onAnswer: (answers) => handlers.current.answer(answers),
      onSaveQuiz: (turnId, questions, answers) => handlers.current.saveQuiz(turnId, questions, answers),
      onOpenWeb: () => handlers.current.openOnWeb(),
    }),
    [native, running],
  );
  const menu: MenuItem[] = [
    ...(owui.state.status === 'signed-in' && items.length > 0
      ? [{ key: 'ask', label: attaching ? 'Attaching…' : 'Ask About It in Open WebUI', icon: 'chat-bubble-left' as const, onPress: () => void askInOpenWebUI() }]
      : []),
    { key: 'web', label: 'Open in DeepTutor Web App', icon: 'arrow-top-right-on-square', onPress: openOnWeb },
    { key: 'delete', label: 'Delete Chat', icon: 'trash', destructive: true, onPress: confirmDelete },
  ];

  return (
    <View style={styles.screen}>
      <SpaceHeader
        leading={
          <>
            <IconButton icon="chevron-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/learn'))} />
            <SwitchToOpenWebUIButton />
          </>
        }
        title={detail.data ? sessionTitle(detail.data) : turn?.prompt ? sessionTitle({ title: '', last_message: turn.prompt }) : 'DeepTutor chat'}
        subtitle={[sessionDate(detail.data?.updated_at ?? detail.data?.created_at), native ? null : capabilityName(capability)].filter(Boolean).join(' · ')}
        trailing={
          <>
            <IconButton icon="pencil-square" label="New chat" onPress={() => router.push('/learn/new')} />
            <MenuButton label="Chat options" items={menu} />
          </>
        }
      />
      <KeyboardAvoidingView behavior="padding" style={styles.body}>
        {detail.isLoading && !turn ? (
          <ActivityIndicator style={styles.loading} color={palette.textMuted} />
        ) : detail.isError && !turn ? (
          <Text style={[styles.empty, { color: palette.textMuted }]}>{`Couldn't load this chat: ${describeError(detail.error)}`}</Text>
        ) : (
          <DtMessageList items={items} baseUrl={session.baseUrl} actions={actions} pinToBottomKey={pinKey} />
        )}
        {native ? (
          <DtComposer
            draftKey={`dt:${id}`}
            running={running}
            onSend={send}
            onStop={stop}
            tools={choice.tools}
            selectedTools={choice.selectedTools}
            onToolsChange={choice.setSelectedTools}
            models={choice.models}
            model={choice.model}
            onModelChange={choice.setModel}
            modes={choice.modes}
            mode={choice.mode}
            onModeChange={choice.setMode}
            config={choice.config}
            onSettingChange={choice.setSetting}
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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1 },
  loading: { marginTop: 32 },
  empty: { flex: 1, fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: 32, paddingHorizontal: 24 },
  webNote: { margin: 12, marginBottom: 24, padding: 14, gap: 10, borderRadius: radius.lg },
  webNoteText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
});
