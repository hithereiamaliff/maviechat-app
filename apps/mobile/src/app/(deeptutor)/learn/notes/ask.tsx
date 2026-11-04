import { anchorNoteThread, firstBlockId, noteTitle } from '@maviechat/deeptutor-protocol';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useToast } from '@/components/Toast';
import { DtComposer } from '@/features/deeptutor/chat/DtComposer';
import { useDtLive } from '@/features/deeptutor/chat/DtLiveProvider';
import { DtUserBubble } from '@/features/deeptutor/chat/DtReplyView';
import { extrasRequest, type DtExtras } from '@/features/deeptutor/chat/extras';
import { useDtChoice } from '@/features/deeptutor/chat/useDtChoice';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { useNotePage, useNotesRefresh } from '@/features/deeptutor/notes/queries';
import { describeError } from '@/lib/errors';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, usePalette } from '@/theme';

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));

/**
 * A new conversation with Dito about a Co-Writer page: the first message starts the chat (with
 * the page, so Dito can read it and suggest edits), which is then tied to the page's first line,
 * as DeepTutor ties it, and carries on as a chat.
 */
export default function AskDito() {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useDtAuthed();
  const live = useDtLive();
  const choice = useDtChoice(null);
  const pageId = one(useLocalSearchParams<{ id: string }>().id);
  const page = useNotePage(pageId);
  const refresh = useNotesRefresh();
  const [pending, setPending] = useState<string | null>(null);
  const title = page.data ? noteTitle(page.data) : 'the page';

  const send = async (text: string, extras: DtExtras) => {
    const blockId = page.data ? firstBlockId(page.data) : '';
    setPending(text);
    try {
      const sessionId = await live.send({ content: text, capability: 'chat', tools: choice.selectedTools, llmSelection: choice.model, noteDocumentId: pageId, ...extrasRequest(extras) });
      live.turns.setPrompt(sessionId, text, undefined);
      if (blockId) await anchorNoteThread(client, pageId, { sessionId, blockId, quote: text.slice(0, 600) }).catch(() => undefined);
      refresh();
      router.replace({ pathname: '/learn/[id]', params: { id: sessionId } });
      return true;
    } catch (error) {
      setPending(null);
      toast(`Couldn't send: ${describeError(error)}`, 'error');
      return false;
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="Ask Dito" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.intro, { color: palette.textMuted }]}>{`Dito reads “${title}” and can suggest edits to it; nothing changes until you accept one, on the page.`}</Text>
        {pending ? <DtUserBubble text={pending} /> : null}
      </ScrollView>
      <View>
        <DtComposer
          draftKey={`dt:note:${pageId}`}
          running={pending !== null}
          onSend={send}
          onStop={() => undefined}
          tools={choice.tools}
          selectedTools={choice.selectedTools}
          onToolsChange={choice.setSelectedTools}
          models={choice.models}
          model={choice.model}
          onModelChange={choice.setModel}
          modes={[]}
          mode="chat"
          onModeChange={() => undefined}
          config={{}}
          onSettingChange={() => undefined}
          knowledgeBases={choice.knowledgeBases}
          selectedKnowledgeBases={[]}
          onKnowledgeBasesChange={() => undefined}
          knowledgeFixed
          placeholder={`Ask about “${title}”`}
          autoFocus
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexGrow: 1, padding: 16, gap: 12 },
  intro: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
});
