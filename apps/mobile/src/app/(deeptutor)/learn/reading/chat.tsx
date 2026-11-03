import { readingTurnFields } from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
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
import { ReadingBar } from '@/features/deeptutor/reading/ReadingBar';
import { readingPlaces } from '@/features/deeptutor/reading/readingContext';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

/** Our starters for a new chat about what you're reading: tapping one sends it. */
const STARTERS = ['Summarise what I’m reading.', 'Explain the main idea of this page simply.', 'Ask me a question to check I understood.'];

/**
 * A new chat with the tutor about a collection, before its first message. The tutor reads the
 * file and the page you're on (and a passage, if you chose one) with every message.
 */
export default function NewReadingChat() {
  const palette = usePalette();
  const toast = useToast();
  const live = useDtLive();
  const queryClient = useQueryClient();
  const { session } = useDtAuthed();
  const params = useLocalSearchParams<{ collection?: string }>();
  const collectionId = typeof params.collection === 'string' ? params.collection : '';
  const choice = useDtChoice(null);
  const [pending, setPending] = useState<string | null>(null);

  const send = async (text: string, extras?: DtExtras) => {
    setPending(text);
    const place = readingPlaces.get(collectionId);
    const selection = readingPlaces.takeSelection(collectionId);
    try {
      const sessionId = await live.send({
        content: text,
        llmSelection: choice.model,
        ...(extras ? extrasRequest(extras) : {}),
        ...readingTurnFields({ collectionId, materialId: place?.materialId || null, revision: place?.revision, viewport: { locator: place?.locator, selection, timeSeconds: place?.timeSeconds } }),
      });
      live.turns.setPrompt(sessionId, text, extras ? promptExtras(extras) : undefined);
      readingPlaces.update(collectionId, { chatId: sessionId });
      void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'reading', 'chats', collectionId] });
      router.replace({ pathname: '/learn/[id]', params: { id: sessionId } });
      return true;
    } catch (error) {
      if (selection) readingPlaces.update(collectionId, { selection });
      setPending(null);
      toast(`Couldn't start the chat: ${describeError(error)}`, 'error');
      return false;
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="Ask the Tutor" />
      <ReadingBar collectionId={collectionId} materialId="" cited={[]} />
      <KeyboardAvoidingView behavior="padding" style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {pending ? (
            <>
              <DtUserBubble text={pending} />
              <ActivityIndicator style={styles.spinner} color={palette.textMuted} />
            </>
          ) : (
            <>
              <Text style={[styles.heading, { color: palette.text }]}>About what you&apos;re reading</Text>
              <Text style={[styles.note, { color: palette.textMuted }]}>The tutor reads the file and the page you&apos;re on with each message, and answers from them with page references.</Text>
              {STARTERS.map((starter) => (
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
          draftKey={`dt:reading:${collectionId}`}
          running={pending !== null}
          onSend={(text, extras) => send(text, extras)}
          onStop={() => undefined}
          tools={[]}
          selectedTools={[]}
          onToolsChange={choice.setSelectedTools}
          models={choice.models}
          model={choice.model}
          onModelChange={choice.setModel}
          modes={[]}
          mode="chat"
          onModeChange={choice.setMode}
          config={{}}
          onSettingChange={choice.setSetting}
          knowledgeBases={[]}
          selectedKnowledgeBases={[]}
          onKnowledgeBasesChange={choice.setSelectedKnowledgeBases}
          knowledgeFixed
          placeholder="Ask about what you're reading"
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
