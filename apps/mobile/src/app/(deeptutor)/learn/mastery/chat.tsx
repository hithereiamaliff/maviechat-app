import { masteryTurnFields, type DtMasteryMode } from '@maviechat/deeptutor-protocol';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useToast } from '@/components/Toast';
import { DtComposer } from '@/features/deeptutor/chat/DtComposer';
import { useDtLive } from '@/features/deeptutor/chat/DtLiveProvider';
import { DtUserBubble } from '@/features/deeptutor/chat/DtReplyView';
import { extrasRequest, promptExtras, type DtExtras } from '@/features/deeptutor/chat/extras';
import { useDtChoice } from '@/features/deeptutor/chat/useDtChoice';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { PathBar } from '@/features/deeptutor/learning/PathBar';
import { MODE_NOTES, PATH_STARTERS } from '@/features/deeptutor/learning/pathChat';
import { useDtMasteryTopic } from '@/features/deeptutor/queries';
import { describeError } from '@/lib/errors';
import { fonts, radius, usePalette } from '@/theme';

const isMode = (value: unknown): value is DtMasteryMode => value === 'outline' || value === 'study' || value === 'review';

/**
 * A new chat on a mastery path, before its first message: pick the mode, then write, or tap one
 * of the starters. The first message makes the chat (DeepTutor files it under the path).
 */
export default function NewPathChat() {
  const palette = usePalette();
  const toast = useToast();
  const live = useDtLive();
  const params = useLocalSearchParams<{ path?: string; mode?: string }>();
  const pathId = typeof params.path === 'string' ? params.path : '';
  const topic = useDtMasteryTopic(pathId);
  const choice = useDtChoice(null);
  const [mode, setMode] = useState<DtMasteryMode>(isMode(params.mode) ? params.mode : 'study');
  const [pending, setPending] = useState<string | null>(null);
  const noOutline = topic.data ? topic.data.counts.total === 0 : false;
  const shownMode = mode === 'study' && noOutline ? 'outline' : mode;
  const waypoint = topic.data?.next?.pointName || topic.data?.modules.flatMap((module) => module.points).find((point) => point.status !== 'mastered')?.name;

  const send = async (text: string, extras?: DtExtras) => {
    setPending(text);
    try {
      const sessionId = await live.send({
        content: text,
        ...masteryTurnFields(pathId, shownMode),
        llmSelection: choice.model,
        ...(extras ? { knowledgeBases: choice.selectedKnowledgeBases, ...extrasRequest(extras) } : {}),
      });
      live.turns.setPrompt(sessionId, text, extras ? promptExtras(extras, choice.selectedKnowledgeBases) : undefined);
      router.replace({ pathname: '/learn/[id]', params: { id: sessionId } });
      return true;
    } catch (error) {
      setPending(null);
      toast(`Couldn't start the chat: ${describeError(error)}`, 'error');
      return false;
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="New Chat on the Path" />
      <PathBar
        topic={topic.data}
        mode={shownMode}
        onMode={pending ? undefined : setMode}
        onOpenPath={() => router.push({ pathname: '/learn/mastery/[id]', params: { id: pathId } })}
      />
      <KeyboardAvoidingView behavior="padding" style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {pending ? (
            <>
              <DtUserBubble text={pending} />
              <ActivityIndicator style={styles.spinner} color={palette.textMuted} />
            </>
          ) : (
            <>
              <Text style={[styles.heading, { color: palette.text }]}>{shownMode === 'study' ? (waypoint ? `Next up: ${waypoint}` : 'Study') : shownMode === 'outline' ? 'Design the outline' : 'Review'}</Text>
              <Text style={[styles.note, { color: palette.textMuted }]}>{MODE_NOTES[shownMode]}</Text>
              {PATH_STARTERS[shownMode].map((starter) => (
                <Pressable
                  key={starter}
                  accessibilityRole="button"
                  accessibilityHint="Sends this"
                  onPress={() => void send(starter)}
                  style={({ pressed }) => [styles.starter, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
                  <Text style={[styles.starterText, { color: palette.text }]}>{starter}</Text>
                </Pressable>
              ))}
            </>
          )}
        </ScrollView>
        <DtComposer
          draftKey={`dt:path:${pathId}`}
          running={pending !== null}
          onSend={(text, extras) => send(text, extras)}
          onStop={() => undefined}
          tools={choice.tools}
          selectedTools={[]}
          onToolsChange={choice.setSelectedTools}
          models={choice.models}
          model={choice.model}
          onModelChange={choice.setModel}
          modes={[]}
          mode="mastery_path"
          onModeChange={choice.setMode}
          config={{}}
          onSettingChange={choice.setSetting}
          knowledgeBases={choice.knowledgeBases}
          selectedKnowledgeBases={choice.selectedKnowledgeBases}
          onKnowledgeBasesChange={choice.setSelectedKnowledgeBases}
          placeholder={waypoint && shownMode === 'study' ? `Ask your tutor about "${waypoint}"` : 'Ask your tutor'}
        />
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 10, paddingBottom: 24 },
  heading: { fontFamily: fonts.semibold, fontSize: 20, marginTop: 8 },
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, marginBottom: 6 },
  starter: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 12 },
  starterText: { fontFamily: fonts.medium, fontSize: 15 },
  spinner: { marginTop: 20 },
});
