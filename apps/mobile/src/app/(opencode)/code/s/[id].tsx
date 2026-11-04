import { abortSession, answerQuestion, deleteSession, getSession, isWorking, rejectQuestion, renameSession, replyPermission, sendPrompt, type MessageWithParts, type UserMessage } from '@maviechat/opencode-protocol';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToast } from '@/components/Toast';
import { describeOcError } from '@/features/opencode/errors';
import { useOcSessionLive } from '@/features/opencode/live';
import { OcComposer, type ModelPick } from '@/features/opencode/OcComposer';
import { OcHeader } from '@/features/opencode/OcHeader';
import { OcMessage } from '@/features/opencode/OcParts';
import { PermissionCard, QuestionCard } from '@/features/opencode/OcRequests';
import { folderName, ocKey, useOcAgents, useOcModels } from '@/features/opencode/queries';
import { useOcAuthed } from '@/session/OpenCodeProvider';
import { fonts, usePalette } from '@/theme';

/** One OpenCode session, live: its messages and tools, what it asks you, and the composer. */
export default function OpenCodeSession() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { id, dir } = useLocalSearchParams<{ id: string; dir: string }>();
  const directory = dir ?? '';
  const { client, accountId } = useOcAuthed();
  const { live, loaded, problem } = useOcSessionLive(id, directory);
  const session = useQuery({ queryKey: ocKey(accountId, 'session', id), queryFn: () => getSession(client, directory, id) });
  const models = useOcModels(directory);
  const agents = useOcAgents(directory);
  const list = useRef<FlashListRef<MessageWithParts>>(null);
  const following = useRef(true);
  const [model, setModel] = useState<ModelPick | null>(null);
  const [agent, setAgent] = useState<string | null>(null);

  // Unless chosen here, a reply uses what the last prompt used (or OpenCode's own default).
  const lastUser = [...live.messages].reverse().find((entry) => entry.info.role === 'user')?.info as UserMessage | undefined;
  const chosenModel = model ?? (lastUser?.model ? { providerID: lastUser.model.providerID, modelID: lastUser.model.modelID } : null);
  const chosenAgent = agent ?? lastUser?.agent ?? agents.data?.[0]?.name ?? null;
  // A session with no model yet uses the agent's own, else the machine's default.
  const defaultModel = agents.data?.find((item) => item.name === chosenAgent)?.model ?? models.data?.defaultModel ?? null;
  const working = isWorking(live);
  const title = session.data?.title || 'Session';

  const fail = (error: unknown) => toast(describeOcError(error), 'error');
  const send = async (text: string): Promise<boolean> => {
    try {
      following.current = true;
      await sendPrompt(client, directory, id, { text, model: chosenModel ?? undefined, agent: chosenAgent ?? undefined });
      return true;
    } catch (error) {
      fail(error);
      return false;
    }
  };

  const menu = [
    {
      key: 'rename',
      label: 'Rename',
      icon: 'pencil' as const,
      onPress: () =>
        Alert.prompt(
          'Rename Session',
          undefined,
          (value) => {
            if (value?.trim())
              void renameSession(client, directory, id, value.trim()).then(() => {
                void queryClient.invalidateQueries({ queryKey: ocKey(accountId, 'session', id) });
                void queryClient.invalidateQueries({ queryKey: ocKey(accountId, 'sessions') });
              }, fail);
          },
          'plain-text',
          title,
        ),
    },
    {
      key: 'delete',
      label: 'Delete',
      icon: 'trash' as const,
      destructive: true,
      onPress: () =>
        Alert.alert('Delete this session?', 'It is deleted on the machine too, for the terminal as well.', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () =>
              void deleteSession(client, directory, id).then(() => {
                void queryClient.invalidateQueries({ queryKey: ocKey(accountId, 'sessions') });
                router.replace('/code');
              }, fail),
          },
        ]),
    },
  ];

  const footer = (
    <View style={styles.footer}>
      {working && !live.permissions.length && !live.questions.length ? (
        <View style={styles.working}>
          <ActivityIndicator color={palette.textMuted} />
          <Text style={[styles.note, { color: palette.textMuted }]}>{live.status.type === 'retry' ? `Retrying: ${live.status.message}` : 'Working…'}</Text>
        </View>
      ) : null}
      {live.error && !working ? <Text style={[styles.note, { color: palette.danger }]}>{live.error}</Text> : null}
      {live.permissions.map((request) => (
        <PermissionCard key={request.id} request={request} onReply={(reply) => replyPermission(client, directory, request.id, reply).then(() => undefined, fail)} />
      ))}
      {live.questions.map((request) => (
        <QuestionCard
          key={request.id}
          request={request}
          onAnswer={(answers) => answerQuestion(client, directory, request.id, answers).then(() => undefined, fail)}
          onSkip={() => rejectQuestion(client, directory, request.id).then(() => undefined, fail)}
        />
      ))}
      {live.todos.length > 0 ? (
        <View style={[styles.todos, { borderColor: palette.border }]}>
          <Text style={[styles.todoTitle, { color: palette.textMuted }]}>To-do</Text>
          {live.todos.map((todo, index) => (
            <Text key={`${index}:${todo.content}`} style={[styles.note, { color: todo.status === 'completed' ? palette.textFaint : palette.text }]}>
              {todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '→' : '○'} {todo.content}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <OcHeader title={title} menu={menu} />
      <Text style={[styles.folder, { color: palette.textFaint }]} numberOfLines={1}>
        {folderName(directory)}
      </Text>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        {!loaded ? <ActivityIndicator style={styles.loading} color={palette.textMuted} /> : null}
        {problem && live.messages.length === 0 ? <Text style={[styles.note, styles.problem, { color: palette.danger }]}>{describeOcError(problem)}</Text> : null}
        <FlashList
          ref={list}
          data={live.messages}
          keyExtractor={(entry) => entry.info.id}
          renderItem={({ item }) => (
            <View style={styles.item}>
              <OcMessage entry={item} />
            </View>
          )}
          ListFooterComponent={footer}
          maintainVisibleContentPosition={{ startRenderingFromBottom: true, autoscrollToBottomThreshold: 0.2 }}
          onLoad={() => list.current?.scrollToEnd({ animated: false })}
          onScrollBeginDrag={() => {
            following.current = false;
          }}
          onContentSizeChange={() => {
            if (following.current) list.current?.scrollToEnd({ animated: false });
          }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
        />
        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <OcComposer
            working={working}
            models={models.data?.models ?? []}
            model={chosenModel}
            defaultModel={defaultModel}
            onModel={setModel}
            agents={agents.data ?? []}
            agent={chosenAgent}
            onAgent={setAgent}
            onSend={send}
            onStop={() => void abortSession(client, directory, id).catch(fail)}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  folder: { fontFamily: fonts.regular, fontSize: 12, textAlign: 'center', marginTop: -6, marginBottom: 2 },
  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
  item: { paddingVertical: 8 },
  footer: { gap: 12, paddingTop: 8 },
  working: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  problem: { padding: 16 },
  loading: { marginTop: 24 },
  todos: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, gap: 4 },
  todoTitle: { fontFamily: fonts.medium, fontSize: 13 },
  composer: { paddingHorizontal: 12, paddingTop: 6 },
});
