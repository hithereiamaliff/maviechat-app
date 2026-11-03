import { filesPending, modelAuthor, promptSuggestions } from '@maviechat/owui-protocol';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { useToast } from '@/components/Toast';
import { ChatHeader } from '@/features/chat/ChatHeader';
import { Composer, type ComposerHandle, type OutgoingMessage } from '@/features/chat/Composer';
import { ControlsSheet } from '@/features/chat/controls/ControlsSheet';
import { carryOver, getDraft, NEW_CHAT, updateDraft, useDraftText } from '@/features/chat/drafts';
import { ModelAvatar } from '@/features/chat/ModelAvatar';
import { ModelPicker } from '@/features/chat/ModelPicker';
import { Suggestions } from '@/features/chat/Suggestions';
import { useModelChoice } from '@/features/chat/useModelChoice';
import { useSendMessage } from '@/features/chat/useSendMessage';
import { openLink } from '@/lib/links';
import { useCapabilities, useServerConfig, useSessionUser, useUserSettings } from '@/lib/server';
import { fonts, usePalette } from '@/theme';

/**
 * New chat: the web app's default landing layout. The model's picture and name (or "Hello"),
 * its description and author, the centred input, then suggestions.
 */
export default function NewChat() {
  const palette = usePalette();
  const toast = useToast();
  const config = useServerConfig();
  const user = useSessionUser();
  const capabilities = useCapabilities();
  const settings = useUserSettings();
  const choice = useModelChoice(undefined);
  const { send } = useSendMessage();
  const typed = useDraftText(NEW_CHAT);
  const composer = useRef<ComposerHandle>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [temporaryOn, setTemporaryOn] = useState(false);
  const [fullDescription, setFullDescription] = useState(false);
  // The new chat's own system prompt and parameters (Controls), saved with it once it exists.
  const [chatParams, setChatParams] = useState<Record<string, unknown>>({});
  const [controlsOpen, setControlsOpen] = useState(false);
  const controlsAllowed = capabilities?.can('chat.controls', true) ?? false;

  // As on the web: admins and permitted users may start temporary chats; some accounts only get temporary chats.
  const enforced = capabilities ? !capabilities.isAdmin && capabilities.can('chat.temporary_enforced') : false;
  const allowed = capabilities?.can('chat.temporary', true) ?? false;
  const temporary = enforced || (allowed && temporaryOn);

  const model = choice.model;
  const description = model?.info?.meta?.description?.trim();
  const author = modelAuthor(model);
  const suggestions = useMemo(() => promptSuggestions(model, config.data), [model, config.data]);
  const insertSuggestion = (settings.data?.ui as { insertSuggestionPrompt?: boolean } | null | undefined)?.insertSuggestionPrompt ?? false;

  const start = async ({ text, files, toggles, toolIds }: OutgoingMessage) => {
    if (!model) {
      toast(choice.loading ? 'Loading models…' : 'No model is available to this account.', 'error');
      return false;
    }
    const result = await send({ chatId: null, parentId: null, content: text, files, model, toggles, toolIds, temporary, params: chatParams });
    if (!result) return false;
    carryOver(NEW_CHAT, result.chatId);
    router.replace({ pathname: '/c/[id]', params: { id: result.chatId } });
    return true;
  };

  // As on the web, a suggestion is sent at once, unless the user's settings say to put it in the input.
  const suggest = (text: string) => {
    if (insertSuggestion) {
      updateDraft(NEW_CHAT, (draft) => ({ ...draft, text }));
      composer.current?.focus();
      return;
    }
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
          <>
            {controlsAllowed ? <IconButton icon="adjustments-horizontal" label="Controls" onPress={() => setControlsOpen(true)} /> : null}
            {allowed && !enforced ? (
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
            ) : null}
          </>
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
            <View style={styles.titleRow}>
              {model ? <ModelAvatar modelId={model.id} size={40} rounded={14} /> : null}
              <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
                {model?.name ?? (user.data?.name ? `Hello, ${user.data.name}` : 'Hello')}
              </Text>
            </View>
            {description ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: fullDescription }}
                accessibilityHint={fullDescription ? 'Shows less' : 'Shows the whole description'}
                onPress={() => setFullDescription((value) => !value)}>
                <Text style={[styles.description, { color: palette.textMuted }]} numberOfLines={fullDescription ? undefined : 2}>
                  {description}
                </Text>
              </Pressable>
            ) : null}
            {description && author ? (
              <Text style={[styles.author, { color: palette.textFaint }]}>
                {'By '}
                {author.url ? (
                  <Text accessibilityRole="link" style={{ color: palette.link }} onPress={() => void openLink(author.url as string)}>
                    {author.label}
                  </Text>
                ) : (
                  author.label
                )}
              </Text>
            ) : null}
          </View>

          <Composer
            ref={composer}
            floating
            draftKey={NEW_CHAT}
            placeholder="How can I help you today?"
            model={model}
            modelLabel={model?.name ?? 'Select a model'}
            onPickModel={() => setPickerOpen(true)}
            onSend={start}
            onStop={() => {}}
            streaming={false}
            temporary={temporary}
          />

          <Suggestions suggestions={suggestions} input={typed} inserts={insertSuggestion} onSelect={suggest} />
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
      <ControlsSheet
        visible={controlsOpen}
        onClose={() => setControlsOpen(false)}
        params={chatParams}
        files={[]}
        onChange={(changes) => {
          if (changes.params) setChatParams(changes.params);
        }}
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
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, maxWidth: '100%' },
  title: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 24 },
  description: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  author: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center' },
});
