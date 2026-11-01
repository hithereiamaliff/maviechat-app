import { shownMessages } from '@maviechat/deeptutor-protocol';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/IconButton';
import { useToast } from '@/components/Toast';
import { NEW_CHAT, updateDraft } from '@/features/chat/drafts';
import { deepTutorAttachment } from '@/features/deeptutor/crossReference';
import { sessionDate, useDtSession } from '@/features/deeptutor/queries';
import { SpaceHeader } from '@/features/deeptutor/SpaceHeader';
import { switchToOpenWebUI } from '@/features/deeptutor/switch';
import { describeError } from '@/lib/errors';
import { Markdown } from '@/markdown/Markdown';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { useSession } from '@/session/SessionProvider';
import { fonts, radius, usePalette } from '@/theme';

/** A DeepTutor chat, read-only, with a way to bring it into an Open WebUI chat. */
export default function DeepTutorSession() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? (params.id[0] ?? '') : (params.id ?? '');
  const { client, session } = useDtAuthed();
  const owui = useSession();
  const detail = useDtSession(id);
  const [attaching, setAttaching] = useState(false);
  const messages = detail.data ? shownMessages(detail.data).filter((message) => message.content?.trim()) : [];

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

  return (
    <View style={styles.screen}>
      <SpaceHeader
        leading={<IconButton icon="chevron-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/learn'))} />}
        title={detail.data?.title || 'DeepTutor chat'}
        subtitle={sessionDate(detail.data?.updated_at ?? detail.data?.created_at)}
      />
      {detail.isLoading ? (
        <ActivityIndicator style={styles.loading} color={palette.textMuted} />
      ) : detail.isError ? (
        <Text style={[styles.empty, { color: palette.textMuted }]}>{`Couldn't load this chat: ${describeError(detail.error)}`}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {messages.length === 0 ? <Text style={[styles.empty, { color: palette.textMuted }]}>This chat has no messages yet.</Text> : null}
          {messages.map((message) =>
            message.role === 'user' ? (
              <View key={String(message.id)} style={[styles.bubble, { backgroundColor: palette.bubble }]}>
                <Text selectable style={[styles.userText, { color: palette.text }]}>
                  {message.content.trim()}
                </Text>
              </View>
            ) : (
              <View key={String(message.id)} style={styles.reply}>
                <Text style={[styles.speaker, { color: palette.textMuted }]}>DeepTutor</Text>
                <Markdown text={message.content} baseUrl={session.baseUrl} />
              </View>
            ),
          )}
        </ScrollView>
      )}
      {owui.state.status === 'signed-in' && messages.length > 0 ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 8, borderTopColor: palette.border }]}>
          <Button label="Ask about it in Open WebUI" onPress={() => void askInOpenWebUI()} loading={attaching} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loading: { marginTop: 32 },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  empty: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: 32, paddingHorizontal: 24 },
  bubble: { alignSelf: 'flex-end', maxWidth: '85%', borderRadius: radius.xl, paddingHorizontal: 14, paddingVertical: 10 },
  userText: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23 },
  reply: { gap: 4 },
  speaker: { fontFamily: fonts.medium, fontSize: 13 },
  footer: { paddingHorizontal: 16, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
});
