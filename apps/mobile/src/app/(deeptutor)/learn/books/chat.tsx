import { bookTurnFields, linkPageChat } from '@maviechat/deeptutor-protocol';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useToast } from '@/components/Toast';
import { BookBar } from '@/features/deeptutor/books/BookBar';
import { PAGE_CHAT_STARTERS } from '@/features/deeptutor/books/pageChat';
import { useBookRefresh } from '@/features/deeptutor/books/useBooks';
import { DtComposer } from '@/features/deeptutor/chat/DtComposer';
import { useDtLive } from '@/features/deeptutor/chat/DtLiveProvider';
import { DtUserBubble } from '@/features/deeptutor/chat/DtReplyView';
import { extrasRequest, promptExtras, type DtExtras } from '@/features/deeptutor/chat/extras';
import { useDtChoice } from '@/features/deeptutor/chat/useDtChoice';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { useDtBook } from '@/features/deeptutor/queries';
import { describeError } from '@/lib/errors';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

/**
 * A new chat about a book's page, before its first message. The tutor reads the page along with
 * every message (and searches the book's knowledge bases); the chat is filed under the page, so
 * the page brings you back to it.
 */
export default function NewPageChat() {
  const palette = usePalette();
  const toast = useToast();
  const live = useDtLive();
  const { client } = useDtAuthed();
  const refresh = useBookRefresh();
  const params = useLocalSearchParams<{ book?: string; page?: string }>();
  const bookId = typeof params.book === 'string' ? params.book : '';
  const pageId = typeof params.page === 'string' ? params.page : '';
  const book = useDtBook(bookId);
  const choice = useDtChoice(null);
  const [pending, setPending] = useState<string | null>(null);
  const detail = book.data;
  const page = detail?.pages.find((item) => item.id === pageId);

  const send = async (text: string, extras?: DtExtras) => {
    if (!detail) return false;
    setPending(text);
    try {
      const sessionId = await live.send({ content: text, ...bookTurnFields(detail.book, pageId), llmSelection: choice.model, ...(extras ? extrasRequest(extras) : {}) });
      live.turns.setPrompt(sessionId, text, extras ? promptExtras(extras) : undefined);
      // Filed under the page (DeepTutor's own reader does this as the chat starts).
      await linkPageChat(client, bookId, pageId, sessionId).catch((error: unknown) => toast(`The chat isn't linked to the page: ${describeError(error)}`, 'error'));
      refresh(bookId, true);
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
      <DtHeader title="Ask About This Page" />
      <BookBar bookId={bookId} pageId={pageId} />
      <KeyboardAvoidingView behavior="padding" style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {pending ? (
            <>
              <DtUserBubble text={pending} />
              <ActivityIndicator style={styles.spinner} color={palette.textMuted} />
            </>
          ) : (
            <>
              <Text style={[styles.heading, { color: palette.text }]}>{page?.title ? `About “${page.title}”` : 'About this page'}</Text>
              <Text style={[styles.note, { color: palette.textMuted }]}>The tutor reads the page along with each message, so you can ask about anything on it.</Text>
              {PAGE_CHAT_STARTERS.map((starter) => (
                <Pressable
                  key={starter}
                  accessibilityRole="button"
                  accessibilityHint="Sends this"
                  disabled={!detail}
                  onPress={() => void send(starter)}
                  style={({ pressed }) => [styles.starter, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
                  <Text style={[styles.starterText, { color: palette.text }]}>{starter}</Text>
                </Pressable>
              ))}
            </>
          )}
        </ScrollView>
        <DtComposer
          draftKey={`dt:book:${bookId}:${pageId}`}
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
          placeholder="Ask about this page"
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
