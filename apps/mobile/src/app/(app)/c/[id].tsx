import { combineQueued, isTemporaryChatId, OwuiHttpError, uuidv4, type FileItem, type HistoryMessage } from '@maviechat/owui-protocol';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import type { MenuItem } from '@/components/Menu';
import { ChatHeader } from '@/features/chat/ChatHeader';
import { Composer, type OutgoingMessage } from '@/features/chat/Composer';
import { getDraft, updateDraft, useQueue } from '@/features/chat/drafts';
import { MessageList, type MessageActions } from '@/features/chat/MessageList';
import { ModelPicker } from '@/features/chat/ModelPicker';
import { useChatView } from '@/features/chat/useChatView';
import { useMessageActions } from '@/features/chat/useMessageActions';
import { useModelChoice } from '@/features/chat/useModelChoice';
import { useSendMessage } from '@/features/chat/useSendMessage';
import { useChatActions } from '@/features/chats/useChatActions';
import { useAuthed, useModels, useUserSettings } from '@/lib/server';
import { fonts, usePalette } from '@/theme';

export default function ChatScreen() {
  const palette = usePalette();
  const params = useLocalSearchParams<{ id: string }>();
  const chatId = Array.isArray(params.id) ? (params.id[0] ?? '') : (params.id ?? '');
  const temporary = isTemporaryChatId(chatId);
  const { session } = useAuthed();
  const models = useModels();
  const settings = useUserSettings();
  const actions = useChatActions();
  const messageActions = useMessageActions(chatId);
  const { query, messages, position, step, select } = useChatView(chatId);
  const choice = useModelChoice(query.data);
  const { send, regenerate, stop } = useSendMessage();
  const queue = useQueue(chatId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const busy = useRef(false);
  // After a failed send the queue waits for the next reply or your next message, instead of retrying in a loop.
  const stalled = useRef(false);

  const chat = query.data;
  const ref = { id: chatId, title: chat?.title ?? 'this chat' };
  const pinned = chat?.pinned === true;
  const toNewChat = () => router.replace('/');
  const menu: MenuItem[] =
    chat && !temporary
      ? [
          { key: 'rename', label: 'Rename', icon: 'pencil', onPress: () => actions.rename(ref) },
          { key: 'pin', label: pinned ? 'Unpin' : 'Pin', icon: pinned ? 'bookmark-slash' : 'bookmark', onPress: () => actions.togglePin(ref, pinned) },
          { key: 'archive', label: 'Archive', icon: 'archive-box', onPress: () => void actions.archive(ref, toNewChat) },
          ...(actions.canDelete
            ? [{ key: 'delete', label: 'Delete', icon: 'trash' as const, destructive: true, onPress: () => actions.remove(ref, toNewChat) }]
            : []),
        ]
      : [];

  const status = query.error instanceof OwuiHttpError ? query.error.status : null;
  const notFound = status === 404 || (temporary && !chat);
  const noAccess = status === 401 || status === 403;
  const streaming = messages.some((message) => message.role === 'assistant' && message.done === false);
  const lastId = messages[messages.length - 1]?.id ?? null;
  const queueEnabled = (settings.data?.ui as { enableMessageQueue?: boolean } | null | undefined)?.enableMessageQueue ?? true;
  const model = choice.model;

  const deliver = async ({ text, files, toggles, toolIds }: OutgoingMessage, parentId: string | null) => {
    if (!model) return false;
    const result = await send({ chatId, parentId, content: text, files, model, toggles, toolIds });
    if (result) select(result.replyId);
    return Boolean(result);
  };

  const onSend = async (message: OutgoingMessage) => {
    stalled.current = false;
    if (streaming) {
      // As on the web: a message typed during a reply waits for it, unless the queue is turned off in settings.
      if (queueEnabled) {
        updateDraft(chatId, (draft) => ({ ...draft, queue: [...draft.queue, { id: uuidv4(), prompt: message.text, files: message.files }] }));
        return true;
      }
      await stop(chatId);
    }
    return deliver(message, lastId);
  };

  useEffect(() => {
    if (streaming) stalled.current = false;
  }, [streaming]);

  // Once the reply finishes, everything queued goes out as one message.
  useEffect(() => {
    if (streaming || queue.length === 0 || busy.current || stalled.current || !model || !chat) return;
    busy.current = true;
    const items = queue;
    const ids = new Set(items.map((item) => item.id));
    updateDraft(chatId, (draft) => ({ ...draft, queue: draft.queue.filter((item) => !ids.has(item.id)) }));
    const { prompt, files } = combineQueued(items);
    const { toggles, toolIds } = getDraft(chatId);
    void send({ chatId, parentId: lastId, content: prompt, files, model, toggles, toolIds })
      .then((result) => {
        if (result) {
          select(result.replyId);
          return;
        }
        stalled.current = true;
        updateDraft(chatId, (draft) => ({ ...draft, queue: [...items, ...draft.queue] }));
      })
      .finally(() => {
        busy.current = false;
      });
  }, [streaming, queue, model, chat, chatId, lastId, send, select]);

  const sendQueuedNow = async (id: string) => {
    const item = getDraft(chatId).queue.find((entry) => entry.id === id);
    if (!item || !model || busy.current) return;
    busy.current = true;
    updateDraft(chatId, (draft) => ({ ...draft, queue: draft.queue.filter((entry) => entry.id !== id) }));
    stalled.current = false;
    try {
      if (streaming) await stop(chatId);
      const { toggles, toolIds } = getDraft(chatId);
      const sent = await deliver({ text: item.prompt, files: item.files, toggles, toolIds }, lastId);
      if (!sent) {
        stalled.current = true;
        updateDraft(chatId, (draft) => ({ ...draft, queue: [item, ...draft.queue] }));
      }
    } finally {
      busy.current = false;
    }
  };

  const listActions = useMemo<MessageActions>(() => {
    const extras = () => {
      const { toggles, toolIds } = getDraft(chatId);
      return { toggles, toolIds };
    };
    const modelOf = (reply: HistoryMessage) => models.data?.find((item) => item.id === reply.model) ?? model;
    return {
      saveEdit: messageActions.saveEdit,
      sendEdit: async (message, content) => {
        if (!model) return false;
        const files = (Array.isArray(message.files) ? message.files : []) as FileItem[];
        const result = await send({ chatId, parentId: message.parentId, content, files, model, ...extras() });
        if (result) select(result.replyId);
        return Boolean(result);
      },
      regenerate:
        messageActions.canRegenerate && !streaming
          ? (reply, prompt) => {
              const parent = reply.parentId;
              const replyModel = modelOf(reply);
              // Only a reply to one of your messages can be redone.
              if (!parent || !replyModel || messages.find((message) => message.id === parent)?.role !== 'user') return;
              const modelIdx = typeof reply.modelIdx === 'number' ? reply.modelIdx : 0;
              void regenerate({ chatId, userMessageId: parent, model: replyModel, modelIdx, prompt, ...extras() }).then((result) => {
                if (result) select(result.replyId);
              });
            }
          : undefined,
      remove: messageActions.remove,
      canDeleteMessage: messageActions.canDeleteMessage,
      canDeleteReply: messageActions.canDeleteReply,
    };
  }, [chatId, models.data, model, messageActions, send, regenerate, select, streaming, messages]);

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ChatHeader title={temporary ? 'Temporary Chat' : chat?.title} menu={menu} />
      <KeyboardAvoidingView behavior="padding" style={styles.screen}>
        {query.isLoading ? (
          <ActivityIndicator style={styles.center} color={palette.textMuted} />
        ) : query.isError || notFound ? (
          <View style={styles.center}>
            <Text style={[styles.message, { color: palette.textMuted }]}>
              {temporary
                ? 'This temporary chat has ended. Temporary chats are not saved.'
                : notFound
                  ? "This chat doesn't exist anymore."
                  : noAccess
                    ? "You don't have access to this chat."
                    : "Couldn't load this chat. Check your connection."}
            </Text>
            <View style={styles.retry}>
              {notFound || noAccess ? (
                <Button label="New chat" onPress={toNewChat} />
              ) : (
                <Button label="Try again" onPress={() => void query.refetch()} />
              )}
            </View>
          </View>
        ) : (
          <MessageList
            messages={messages}
            actions={listActions}
            models={models.data}
            position={position}
            onStep={step}
            onFollowUp={(text) => {
              const { toggles, toolIds } = getDraft(chatId);
              void onSend({ text, files: [], toggles, toolIds });
            }}
            pinToBottomKey={lastId ?? undefined}
            baseUrl={session.baseUrl}
            token={session.token}
          />
        )}
        {query.isError || notFound ? null : (
          <Composer
            draftKey={chatId}
            model={model}
            modelLabel={model?.name ?? 'Select a model'}
            onPickModel={() => setPickerOpen(true)}
            onSend={onSend}
            onStop={() => void stop(chatId)}
            onSendQueued={(id) => void sendQueuedNow(id)}
            streaming={streaming}
            temporary={temporary}
          />
        )}
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
  message: { fontFamily: fonts.regular, fontSize: 15, textAlign: 'center' },
  retry: { alignSelf: 'stretch' },
});
