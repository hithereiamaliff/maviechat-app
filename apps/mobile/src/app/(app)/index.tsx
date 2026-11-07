import { filesPending, modelAuthor, promptSuggestions } from '@maviechat/owui-protocol';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { useToast } from '@/components/Toast';
import { Banners } from '@/features/chat/Banners';
import { ChatHeader } from '@/features/chat/ChatHeader';
import { chatLinkFrom, type ChatLink } from '@/features/chat/chatLink';
import { Composer, type ComposerHandle, type OutgoingMessage } from '@/features/chat/Composer';
import { ControlsSheet } from '@/features/chat/controls/ControlsSheet';
import { carryOver, getDraft, NEW_CHAT, updateDraft, useDraft, useDraftText } from '@/features/chat/drafts';
import { ModelAvatar } from '@/features/chat/ModelAvatar';
import { ModelPicker } from '@/features/chat/ModelPicker';
import { Suggestions } from '@/features/chat/Suggestions';
import { useModelChoice } from '@/features/chat/useModelChoice';
import { useSendMessage } from '@/features/chat/useSendMessage';
import { openLink } from '@/lib/links';
import { useCapabilities, useServerConfig, useSessionUser } from '@/lib/server';
import { useInterface } from '@/lib/uiSettings';
import { fonts, usePalette } from '@/theme';

/** A new chat starts over for each link that opens it (`chatLinkFrom`). */
export default function NewChatRoute() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const link = chatLinkFrom(params);
  return <NewChat key={link.key} link={link} />;
}

/**
 * New chat: the web app's default landing layout. The admin's banners; the model's picture and
 * name (or "Hello"), its description and author, the centred input, then suggestions. With the
 * "chat" landing mode the input waits at the bottom instead, as in a chat.
 */
function NewChat({ link }: { link: ChatLink }) {
  const palette = usePalette();
  const toast = useToast();
  const config = useServerConfig();
  const user = useSessionUser();
  const capabilities = useCapabilities();
  // A link's models (Workspace's "Try in Chat", a pinned model, `?models=`) come first.
  const choice = useModelChoice(undefined, link.models);
  const { send } = useSendMessage();
  const typed = useDraftText(NEW_CHAT);
  const draft = useDraft(NEW_CHAT);
  const composer = useRef<ComposerHandle>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const ui = useInterface();
  const chatLanding = ui('landingPageMode');
  // Until you switch it yourself, a new chat is temporary when your settings (or the link) say so.
  const [temporaryChoice, setTemporaryOn] = useState<boolean | null>(link.temporary ? true : null);
  const temporaryOn = temporaryChoice ?? ui('temporaryChatByDefault');
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

  // A link's message goes in the box at once. Its switches and tools wait until the model's own
  // defaults are in (the input bar sets those first), so they aren't replaced. Nothing is sent.
  const linkText = useRef(false);
  const linkSwitches = useRef(false);
  useEffect(() => {
    if (linkText.current || link.text === null) return;
    linkText.current = true;
    updateDraft(NEW_CHAT, (current) => ({ ...current, text: link.text ?? current.text }));
  }, [link]);
  useEffect(() => {
    if (linkSwitches.current || (!Object.keys(link.toggles).length && !link.toolIds.length) || !model || draft.defaultsFor !== model.id) return;
    linkSwitches.current = true;
    updateDraft(NEW_CHAT, (current) => ({ ...current, toggles: { ...current.toggles, ...link.toggles }, toolIds: link.toolIds.length ? link.toolIds : current.toolIds }));
  }, [link, model, draft.defaultsFor]);

  // With Compare, the web shows one model's details at a time (the last, until you tap another's picture).
  const [infoIdx, setInfoIdx] = useState<number | null>(null);
  const infoModel = (infoIdx !== null ? choice.selected[infoIdx] : undefined) ?? choice.selected[choice.selected.length - 1] ?? model;
  const description = infoModel?.info?.meta?.description?.trim();
  const author = modelAuthor(infoModel);
  const suggestions = useMemo(() => promptSuggestions(infoModel, config.data), [infoModel, config.data]);
  const insertSuggestion = ui('insertSuggestionPrompt');

  const start = async ({ text, files, toggles, toolIds, skillIds, filterIds, atModelId }: OutgoingMessage) => {
    // A model picked with `@` answers alone (as on the web).
    const at = atModelId ? choice.models.find((item) => item.id === atModelId) : undefined;
    if (!model) {
      toast(choice.loading ? 'Loading models…' : 'No model is available to this account.', 'error');
      return false;
    }
    const result = await send({
      chatId: null,
      parentId: null,
      content: text,
      files,
      model: at ?? model,
      models: at ? [at] : choice.selected,
      toggles,
      toolIds,
      skillIds,
      filterIds,
      temporary,
      params: chatParams,
    });
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
    const { files, toggles, toolIds, skillIds, filterIds } = getDraft(NEW_CHAT);
    if (filesPending(files)) {
      toast('Wait for the attachments to finish uploading.', 'error');
      return;
    }
    void start({ text, files, toggles, toolIds, skillIds, filterIds });
  };

  // In the middle of the page (the default), or at the bottom as in a chat (the "chat" landing mode).
  const composerAt = (floating: boolean) => (
    <Composer
      ref={composer}
      floating={floating}
      draftKey={NEW_CHAT}
      placeholder="How can I help you today?"
      model={model}
      models={choice.selected}
      modelLabel={choice.label}
      onPickModel={() => setPickerOpen(true)}
      onSend={start}
      onStop={() => {}}
      streaming={false}
      temporary={temporary}
      onTemporary={allowed && !enforced ? () => setTemporaryOn(!temporaryOn) : undefined}
    />
  );

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
                setTemporaryOn(!temporaryOn);
              }}
            />
            ) : null}
          </>
        }
      />
      <Banners />
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
              {choice.selected.length > 1 ? (
                <View style={styles.avatars}>
                  {choice.selected.map((item, index) => (
                    <Pressable
                      key={`${item.id}-${index}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Show ${item.name}'s details`}
                      accessibilityState={{ selected: item === infoModel }}
                      onPress={() => setInfoIdx(index)}
                      style={[styles.stacked, index > 0 && styles.overlap, { borderColor: palette.background }]}>
                      <ModelAvatar modelId={item.id} size={40} rounded={14} />
                    </Pressable>
                  ))}
                </View>
              ) : model ? (
                <ModelAvatar modelId={model.id} size={40} rounded={14} />
              ) : null}
              <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
                {infoModel?.name ?? (user.data?.name ? `Hello, ${user.data.name}` : 'Hello')}
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

          {chatLanding ? null : composerAt(true)}

          <Suggestions suggestions={suggestions} input={typed} inserts={insertSuggestion} onSelect={suggest} />
        </ScrollView>
        {chatLanding ? composerAt(false) : null}
      </KeyboardAvoidingView>
      <ModelPicker
        visible={pickerOpen}
        models={choice.models}
        selectedIds={choice.selected.map((item) => item.id)}
        defaultIds={choice.defaultIds}
        onChange={(ids) => {
          choice.pick(ids);
          setInfoIdx(null);
        }}
        compareAllowed={choice.compareAllowed}
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
  avatars: { flexDirection: 'row' },
  stacked: { borderWidth: 2, borderRadius: 16 },
  overlap: { marginLeft: -16 },
  title: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 24 },
  description: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  author: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center' },
});
