import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { IconButton } from '@/components/IconButton';
import { useToast } from '@/components/Toast';
import { DtComposer } from '@/features/deeptutor/chat/DtComposer';
import { useDtLive } from '@/features/deeptutor/chat/DtLiveProvider';
import { DtUserBubble } from '@/features/deeptutor/chat/DtReplyView';
import { useDtChoice } from '@/features/deeptutor/chat/useDtChoice';
import { SpaceHeader } from '@/features/deeptutor/SpaceHeader';
import { SwitchToOpenWebUIButton } from '@/features/deeptutor/SpaceSwitch';
import { describeError } from '@/lib/errors';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, usePalette } from '@/theme';

const DT_NEW_CHAT = 'dt:new';

/** A new DeepTutor chat (Chat mode). The first message creates the session, then its screen takes over. */
export default function DeepTutorNewChat() {
  const palette = usePalette();
  const toast = useToast();
  const { session } = useDtAuthed();
  const live = useDtLive();
  const choice = useDtChoice(null);
  const [pending, setPending] = useState<string | null>(null);

  const send = async (text: string) => {
    setPending(text);
    try {
      const sessionId = await live.send({ content: text, capability: 'chat', ...choice.request });
      live.turns.setPrompt(sessionId, text);
      router.replace({ pathname: '/learn/[id]', params: { id: sessionId } });
      return true;
    } catch (error) {
      setPending(null);
      toast(`Couldn't send: ${describeError(error)}`, 'error');
      return false;
    }
  };

  return (
    <View style={styles.screen}>
      <SpaceHeader
        leading={
          <>
            <IconButton icon="chevron-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/learn'))} />
            <SwitchToOpenWebUIButton />
          </>
        }
        title="New chat"
        subtitle={session.account.username}
      />
      <KeyboardAvoidingView behavior="padding" style={styles.body}>
        {pending ? (
          <ScrollView contentContainerStyle={styles.pending}>
            <DtUserBubble text={pending} />
            <ActivityIndicator style={styles.spinner} color={palette.textMuted} />
          </ScrollView>
        ) : (
          <View style={styles.welcome}>
            <Text style={[styles.hello, { color: palette.text }]}>What would you like to learn?</Text>
            <Text style={[styles.hint, { color: palette.textMuted }]}>
              Ask DeepTutor anything. Switch on tools such as web search under the box. Quiz, Research and the other modes are in the DeepTutor web app for now.
            </Text>
          </View>
        )}
        <DtComposer
          draftKey={DT_NEW_CHAT}
          running={pending !== null}
          onSend={send}
          onStop={() => undefined}
          tools={choice.tools}
          selectedTools={choice.selectedTools}
          onToolsChange={choice.setSelectedTools}
          models={choice.models}
          model={choice.model}
          onModelChange={choice.setModel}
          autoFocus
        />
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1 },
  welcome: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 10 },
  hello: { fontFamily: fonts.semibold, fontSize: 24, textAlign: 'center' },
  hint: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  pending: { paddingHorizontal: 16, paddingBottom: 24 },
  spinner: { alignSelf: 'flex-start', marginTop: 24 },
});
