import { refreshSuggestions } from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { useToast } from '@/components/Toast';
import { updateDraft } from '@/features/chat/drafts';
import { isNativeCapability, modeInfo } from '@/features/deeptutor/chat/capabilities';
import { DtComposer, type DtComposerHandle } from '@/features/deeptutor/chat/DtComposer';
import { useDtLive } from '@/features/deeptutor/chat/DtLiveProvider';
import { DtUserBubble } from '@/features/deeptutor/chat/DtReplyView';
import { DT_NEW_CHAT, extrasRequest, promptExtras, type DtExtras } from '@/features/deeptutor/chat/extras';
import type { PromptExtras } from '@/features/deeptutor/chat/liveTurns';
import { useDtChoice } from '@/features/deeptutor/chat/useDtChoice';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { useDtSuggestions } from '@/features/deeptutor/queries';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

/** Our own greeting for the time of day. */
function greetingFor(name: string, now: Date): string {
  const hour = now.getHours();
  const part = hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 18 ? 'afternoon' : 'evening';
  return `Good ${part}, ${name}`;
}

/**
 * DeepTutor's home, laid out like Open WebUI's new-chat screen: a greeting, the input in the
 * middle, then DeepTutor's ideas for you and the modes to start with. The first message
 * creates the chat, which then takes over.
 */
export default function DeepTutorHome() {
  const palette = usePalette();
  const toast = useToast();
  const { client, session } = useDtAuthed();
  const queryClient = useQueryClient();
  const live = useDtLive();
  const choice = useDtChoice(null);
  const ideas = useDtSuggestions();
  // `?mode=deep_question` (Practice's "Make a Quiz") opens with that mode picked.
  const asked = useLocalSearchParams<{ mode?: string }>().mode;
  const { setMode } = choice;
  useEffect(() => {
    if (typeof asked === 'string' && isNativeCapability(asked)) setMode(asked);
  }, [asked, setMode]);
  const composer = useRef<DtComposerHandle>(null);
  const [pending, setPending] = useState<{ text: string; extras?: PromptExtras } | null>(null);
  const [greeting] = useState(() => greetingFor(session.account.username, new Date()));
  const [rerolling, setRerolling] = useState(false);

  const send = async (text: string, extras: DtExtras) => {
    const shown = promptExtras(extras, choice.selectedKnowledgeBases);
    setPending({ text, extras: shown });
    try {
      const sessionId = await live.send({ content: text, ...choice.request, ...extrasRequest(extras) });
      live.turns.setPrompt(sessionId, text, shown);
      router.replace({ pathname: '/learn/[id]', params: { id: sessionId } });
      return true;
    } catch (error) {
      setPending(null);
      toast(`Couldn't send: ${describeError(error)}`, 'error');
      return false;
    }
  };

  const startWith = (mode: string) => {
    choice.setMode(mode);
    composer.current?.focus();
  };

  // As on DeepTutor's home, an idea fills the input; you send it.
  const takeIdea = (prompt: string) => {
    updateDraft(DT_NEW_CHAT, (draft) => ({ ...draft, text: prompt }));
    composer.current?.focus();
  };

  const reroll = async () => {
    setRerolling(true);
    try {
      queryClient.setQueryData([DT_QUERY_ROOT, session.baseUrl, 'suggestions'], await refreshSuggestions(client));
    } catch (error) {
      toast(`Couldn't get new ideas: ${describeError(error)}`, 'error');
    } finally {
      setRerolling(false);
    }
  };
  const suggestions = ideas.data?.suggestions ?? [];

  const input = (
    <DtComposer
      ref={composer}
      draftKey={DT_NEW_CHAT}
      floating={!pending}
      running={pending !== null}
      onSend={send}
      onStop={() => undefined}
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
      knowledgeBases={choice.knowledgeBases}
      selectedKnowledgeBases={choice.selectedKnowledgeBases}
      onKnowledgeBasesChange={choice.setSelectedKnowledgeBases}
    />
  );

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader />
      <KeyboardAvoidingView behavior="padding" style={styles.screen}>
        {pending ? (
          <>
            <ScrollView contentContainerStyle={styles.pending}>
              <DtUserBubble
                text={pending.text}
                attachments={pending.extras?.attachments}
                references={pending.extras?.references.map((reference) => ({
                  key: reference.key,
                  icon: reference.kind === 'notebook' ? 'book-open' : reference.kind === 'chat' ? 'chat-bubble-left' : 'archive-box',
                  label: reference.label,
                }))}
              />
              <ActivityIndicator style={styles.spinner} color={palette.textMuted} />
            </ScrollView>
            {input}
          </>
        ) : (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.greeting}>
              <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
                {greeting}
              </Text>
              <Text style={[styles.description, { color: palette.textMuted }]}>What shall we learn today?</Text>
            </View>
            {input}
            {suggestions.length > 0 ? (
              <View style={styles.starters}>
                <View style={styles.startersHeader}>
                  <Icon name="sparkles" size={14} color={palette.textFaint} />
                  <Text style={[styles.startersLabel, styles.grow, { color: palette.textFaint }]}>Ideas for you</Text>
                  {rerolling ? (
                    <ActivityIndicator size="small" color={palette.textFaint} />
                  ) : (
                    <IconButton icon="arrow-path" label="Suggest something else" size={15} color={palette.textFaint} onPress={() => void reroll()} />
                  )}
                </View>
                {suggestions.map((idea) => (
                  <Pressable
                    key={idea.label}
                    accessibilityRole="button"
                    accessibilityHint="Puts this idea in the message box"
                    onPress={() => takeIdea(idea.prompt)}
                    style={({ pressed }) => [styles.starter, pressed && { backgroundColor: palette.surface }]}>
                    <Text style={[styles.starterTitle, styles.grow, { color: palette.text }]} numberOfLines={2}>
                      {idea.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <View style={styles.starters}>
              <View style={styles.startersHeader}>
                <Icon name="bolt" size={14} color={palette.textFaint} />
                <Text style={[styles.startersLabel, { color: palette.textFaint }]}>Start with</Text>
              </View>
              {choice.modes
                .filter((mode) => mode !== 'chat')
                .map((mode) => {
                  const info = modeInfo(mode);
                  const selected = mode === choice.mode;
                  return (
                    <Pressable
                      key={mode}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityHint="Picks this mode for your message"
                      onPress={() => startWith(selected ? 'chat' : mode)}
                      style={({ pressed }) => [styles.starter, (pressed || selected) && { backgroundColor: palette.surface }]}>
                      <Icon name={info.icon} size={18} color={palette.textMuted} />
                      <View style={styles.starterText}>
                        <Text style={[styles.starterTitle, { color: palette.text }]}>{info.name}</Text>
                        <Text style={[styles.starterHint, { color: palette.textMuted }]} numberOfLines={1}>
                          {info.hint}
                        </Text>
                      </View>
                      {selected ? <Icon name="check" size={16} color={palette.text} strokeWidth={2} /> : null}
                    </Pressable>
                  );
                })}
            </View>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', paddingBottom: 48, gap: 20 },
  greeting: { paddingHorizontal: 24, gap: 8, alignItems: 'center' },
  title: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 24 },
  description: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  starters: { paddingHorizontal: 18 },
  startersHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 20, paddingHorizontal: 2, marginBottom: 2 },
  startersLabel: { fontFamily: fonts.regular, fontSize: 13 },
  starter: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.md },
  starterText: { flex: 1 },
  grow: { flex: 1 },
  starterTitle: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 20 },
  starterHint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  pending: { paddingHorizontal: 16, paddingBottom: 24 },
  spinner: { alignSelf: 'flex-start', marginTop: 24 },
});
