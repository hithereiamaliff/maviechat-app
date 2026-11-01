import { filesPending, promptSuggestions } from '@maviechat/owui-protocol';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { useToast } from '@/components/Toast';
import { ChatHeader } from '@/features/chat/ChatHeader';
import { Composer, type OutgoingMessage } from '@/features/chat/Composer';
import { carryOver, getDraft, NEW_CHAT, updateDraft } from '@/features/chat/drafts';
import { ModelPicker } from '@/features/chat/ModelPicker';
import { useModelChoice } from '@/features/chat/useModelChoice';
import { useSendMessage } from '@/features/chat/useSendMessage';
import { useCapabilities, useServerConfig, useSessionUser } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';

/** New chat: the web app's default landing layout (model name, description, centred input, suggestions). */
export default function NewChat() {
  const palette = usePalette();
  const toast = useToast();
  const config = useServerConfig();
  const user = useSessionUser();
  const capabilities = useCapabilities();
  const choice = useModelChoice(undefined);
  const { send } = useSendMessage();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [temporaryOn, setTemporaryOn] = useState(false);

  // As on the web: admins and permitted users may start temporary chats; some accounts only get temporary chats.
  const enforced = capabilities ? !capabilities.isAdmin && capabilities.can('chat.temporary_enforced') : false;
  const allowed = capabilities?.can('chat.temporary', true) ?? false;
  const temporary = enforced || (allowed && temporaryOn);

  const model = choice.model;
  const description = model?.info?.meta?.description;
  const suggestions = promptSuggestions(model, config.data).slice(0, 4);
  const firstName = user.data?.name?.split(/\s+/)[0];

  const start = async ({ text, files, toggles, toolIds }: OutgoingMessage) => {
    if (!model) {
      toast(choice.loading ? 'Loading models…' : 'No model is available to this account.', 'error');
      return false;
    }
    const result = await send({ chatId: null, parentId: null, content: text, files, model, toggles, toolIds, temporary });
    if (!result) return false;
    carryOver(NEW_CHAT, result.chatId);
    router.replace({ pathname: '/c/[id]', params: { id: result.chatId } });
    return true;
  };

  const suggest = (text: string) => {
    const { files, toggles, toolIds } = getDraft(NEW_CHAT);
    if (filesPending(files)) {
      toast('Wait for the attachments to finish uploading.', 'error');
      return;
    }
    void start({ text, files, toggles, toolIds });
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ChatHeader
        accessory={
          allowed && !enforced ? (
            <IconButton
              icon="eye-slash"
              label={temporaryOn ? 'Temporary chat on. Turn off' : 'Temporary chat'}
              color={temporaryOn ? palette.onActive : undefined}
              onPress={() => {
                // Uploaded attachments belong to saved chats; a temporary chat keeps its own on the phone.
                if (getDraft(NEW_CHAT).files.length > 0) {
                  updateDraft(NEW_CHAT, (draft) => ({ ...draft, files: [], previews: {} }));
                  toast('Attachments removed. Add them again for this chat.');
                }
                setTemporaryOn((value) => !value);
              }}
            />
          ) : null
        }
      />
      <KeyboardAvoidingView behavior="padding" style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.greeting}>
            {temporary ? (
              <View style={styles.temporary}>
                <View style={[styles.badge, { backgroundColor: palette.active }]}>
                  <Icon name="eye-slash" size={14} color={palette.onActive} strokeWidth={2} />
                  <Text style={[styles.badgeText, { color: palette.onActive }]}>Temporary Chat</Text>
                </View>
                <Text style={[styles.temporaryNote, { color: palette.textMuted }]}>
                  {"This chat won't appear in history and your messages will not be saved."}
                </Text>
              </View>
            ) : null}
            <Text style={[styles.title, { color: palette.text }]} numberOfLines={2}>
              {model?.name ?? (firstName ? `Hello, ${firstName}` : 'Hello')}
            </Text>
            {description ? (
              <Text style={[styles.description, { color: palette.textMuted }]} numberOfLines={3}>
                {description}
              </Text>
            ) : null}
          </View>

          <Composer
            floating
            draftKey={NEW_CHAT}
            model={model}
            modelLabel={model?.name ?? 'Select a model'}
            onPickModel={() => setPickerOpen(true)}
            onSend={start}
            onStop={() => {}}
            streaming={false}
            temporary={temporary}
          />

          {suggestions.length > 0 ? (
            <View style={styles.suggestions}>
              <Text style={[styles.suggestedLabel, { color: palette.textFaint }]}>Suggested</Text>
              {suggestions.map((suggestion, index) => (
                <Pressable
                  key={index}
                  accessibilityRole="button"
                  onPress={() => suggest(suggestion.content)}
                  style={({ pressed }) => [styles.suggestion, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
                  <Text style={[styles.suggestionTitle, { color: palette.text }]} numberOfLines={1}>
                    {suggestion.title?.[0] ?? suggestion.content}
                  </Text>
                  {suggestion.title?.[1] ? (
                    <Text style={[styles.suggestionSub, { color: palette.textMuted }]} numberOfLines={1}>
                      {suggestion.title[1]}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
      <ModelPicker
        visible={pickerOpen}
        models={choice.models}
        selectedId={model?.id ?? null}
        defaultId={choice.defaultId}
        onSelect={choice.pick}
        onClose={() => setPickerOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', paddingBottom: 48, gap: 20 },
  greeting: { paddingHorizontal: 24, gap: 8, alignItems: 'center' },
  temporary: { alignItems: 'center', gap: 6, marginBottom: 6 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeText: { fontFamily: fonts.medium, fontSize: 13 },
  temporaryNote: { fontFamily: fonts.regular, fontSize: 13, textAlign: 'center' },
  title: { fontFamily: fonts.semibold, fontSize: 26, textAlign: 'center' },
  description: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  suggestions: { paddingHorizontal: 16, gap: 6 },
  suggestedLabel: { fontFamily: fonts.medium, fontSize: 13, paddingHorizontal: 4, marginBottom: 2 },
  suggestion: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 10 },
  suggestionTitle: { fontFamily: fonts.medium, fontSize: 15 },
  suggestionSub: { fontFamily: fonts.regular, fontSize: 13, marginTop: 2 },
});
