import {
  combineQueued,
  isTemporaryChatId,
  mergeInput,
  mergeResponses,
  modelActions,
  newestLeaf,
  OwuiHttpError,
  saveMessage,
  selectBranch,
  updateChatControls,
  uuidv4,
  type ChatRecord,
  type FileItem,
  type HistoryMessage,
  type MergedResponse,
  type ReplyGroup,
} from '@maviechat/owui-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/IconButton';
import type { MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { ChatHeader } from '@/features/chat/ChatHeader';
import { useFolderPicker } from '@/features/chats/FolderPicker';
import { Composer, type OutgoingMessage } from '@/features/chat/Composer';
import { ControlsSheet, type ControlChanges } from '@/features/chat/controls/ControlsSheet';
import { getDraft, updateDraft, useQueue } from '@/features/chat/drafts';
import { MessageList, type MessageActions, type MessageListHandle } from '@/features/chat/MessageList';
import { ModelPicker } from '@/features/chat/ModelPicker';
import { useChatView } from '@/features/chat/useChatView';
import { useMessageActions } from '@/features/chat/useMessageActions';
import { useModelChoice } from '@/features/chat/useModelChoice';
import { useSendMessage } from '@/features/chat/useSendMessage';
import { useChatActions } from '@/features/chats/useChatActions';
import { sendChatToDeepTutor } from '@/features/deeptutor/crossReference';
import { useLive } from '@/features/live/LiveProvider';
import { describeError } from '@/lib/errors';
import { useAuthed, useModels, useUserSettings } from '@/lib/server';
import { useDeepTutor } from '@/session/DeepTutorProvider';
import { fonts, usePalette } from '@/theme';

export default function ChatScreen() {
  const palette = usePalette();
  const params = useLocalSearchParams<{ id: string }>();
  const chatId = Array.isArray(params.id) ? (params.id[0] ?? '') : (params.id ?? '');
  const temporary = isTemporaryChatId(chatId);
  const { client, session } = useAuthed();
  const queryClient = useQueryClient();
  const models = useModels();
  const settings = useUserSettings();
  const actions = useChatActions();
  const picker = useFolderPicker();
  const live = useLive();
  const toast = useToast();
  const deepTutor = useDeepTutor();
  const messageActions = useMessageActions(chatId);
  const { query, messages, position, step, select, show } = useChatView(chatId);
  const choice = useModelChoice(query.data);
  const { send, regenerate, continueReply, stop } = useSendMessage();
  const queue = useQueue(chatId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const list = useRef<MessageListHandle>(null);
  const busy = useRef(false);
  // After a failed send the queue waits for the next reply or your next message, instead of retrying in a loop.
  const stalled = useRef(false);

  const chat = query.data;
  const ref = { id: chatId, title: chat?.title ?? 'this chat' };
  const pinned = chat?.pinned === true;
  const toNewChat = () => router.replace('/');
  // Open WebUI → DeepTutor: a copy of the shown branch goes into DeepTutor's "From MavieChat" notebook.
  const sendToDeepTutor = async () => {
    const dtClient = deepTutor.client;
    if (!chat || !dtClient) return;
    toast('Sending to DeepTutor…');
    try {
      await sendChatToDeepTutor(dtClient, chat, models.data, session.baseUrl);
      toast('Sent to DeepTutor\'s "From MavieChat" notebook.', 'success');
    } catch (error) {
      toast(`Couldn't send to DeepTutor: ${describeError(error)}`, 'error');
    }
  };
  const menu: MenuItem[] =
    chat && !temporary
      ? [
          { key: 'rename', label: 'Rename', icon: 'pencil', onPress: () => actions.rename(ref) },
          { key: 'pin', label: pinned ? 'Unpin' : 'Pin', icon: pinned ? 'bookmark-slash' : 'bookmark', onPress: () => actions.togglePin(ref, pinned) },
          ...(actions.canMove ? [{ key: 'move', label: 'Move', icon: 'folder' as const, onPress: () => picker.open(ref) }] : []),
          ...(deepTutor.client
            ? [{ key: 'deeptutor', label: 'Send to DeepTutor', icon: 'academic-cap' as const, onPress: () => void sendToDeepTutor() }]
            : []),
          chat.archived
            ? { key: 'unarchive', label: 'Unarchive', icon: 'archive-box-arrow-down', onPress: () => void actions.unarchive(ref) }
            : { key: 'archive', label: 'Archive', icon: 'archive-box', onPress: () => void actions.archive(ref, toNewChat) },
          ...(actions.canDelete
            ? [{ key: 'delete', label: 'Delete', icon: 'trash' as const, destructive: true, onPress: () => actions.remove(ref, toNewChat) }]
            : []),
        ]
      : [];

  // Controls: the cached chat changes at once; a saved chat is saved too (the server patches only these keys).
  const saveControls = (changes: ControlChanges) => {
    queryClient.setQueryData<ChatRecord>(['chat', chatId], (current) => (current ? { ...current, chat: { ...current.chat, ...changes } } : current));
    if (!temporary) void updateChatControls(client, chatId, changes).catch((error: unknown) => toast(`Couldn't save the controls: ${describeError(error)}`, 'error'));
  };
  // Overview: show the tapped message's branch (down to its newest reply), as the web does, then bring it into view.
  const showMessage = (messageId: string) => {
    const history = chat?.chat?.history;
    if (!history?.messages[messageId]) return;
    const leaf = newestLeaf(history, messageId);
    select(leaf);
    if (!temporary) void selectBranch(client, chatId, leaf).catch(() => toast("Couldn't save which version is shown", 'error'));
    setControlsOpen(false);
    setTimeout(() => list.current?.scrollToMessage(messageId), 400);
  };

  const status = query.error instanceof OwuiHttpError ? query.error.status : null;
  const notFound = status === 404 || (temporary && !chat);
  const noAccess = status === 401 || status === 403;
  const history = chat?.chat?.history;
  // With Compare, the other models' answers to the last message aren't on the shown branch, but count too.
  const lastAsked = [...messages].reverse().find((message) => message.role === 'user');
  const streaming =
    messages.some((message) => message.role === 'assistant' && message.done === false) ||
    (lastAsked?.childrenIds ?? []).some((id) => history?.messages[id]?.done === false);
  const lastId = messages[messages.length - 1]?.id ?? null;
  const queueEnabled = (settings.data?.ui as { enableMessageQueue?: boolean } | null | undefined)?.enableMessageQueue ?? true;
  const model = choice.model;
  const selected = choice.selected;
  const multiAsTabs = (settings.data?.ui as { displayMultiModelResponsesInTabs?: boolean } | null | undefined)?.displayMultiModelResponsesInTabs ?? false;

  // Like the web: the chat counts as read when you open it, when you leave it, and when a reply lands while you watch.
  const loaded = Boolean(chat);
  const { markRead } = live;
  useEffect(() => {
    if (!loaded) return;
    markRead(chatId);
    return () => markRead(chatId);
  }, [loaded, chatId, markRead]);
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !streaming) markRead(chatId);
    wasStreaming.current = streaming;
  }, [streaming, chatId, markRead]);

  const deliver = async ({ text, files, toggles, toolIds }: OutgoingMessage, parentId: string | null) => {
    if (!model) return false;
    const result = await send({ chatId, parentId, content: text, files, model, models: selected, toggles, toolIds });
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
    void send({ chatId, parentId: lastId, content: prompt, files, model, models: selected, toggles, toolIds })
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
  }, [streaming, queue, model, selected, chat, chatId, lastId, send, select]);

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
        const result = await send({ chatId, parentId: message.parentId, content, files, model, models: selected, ...extras() });
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
      editReply: messageActions.canEdit && !streaming ? messageActions.editReply : undefined,
      rate: messageActions.canRate ? messageActions.rate : undefined,
      continueReply:
        messageActions.canContinue && !streaming
          ? (reply) => {
              const replyModel = modelOf(reply);
              if (!replyModel) return;
              void continueReply({ chatId, messageId: reply.id, model: replyModel, ...extras() });
            }
          : undefined,
      actionsFor: (reply) => modelActions(models.data?.find((item) => item.id === reply.model)),
      runAction: (reply, action) => void messageActions.runAction(reply, action),
      remove: messageActions.remove,
      canDeleteMessage: messageActions.canDeleteMessage,
      canDeleteReply: messageActions.canDeleteReply,
    };
  }, [chatId, models.data, model, selected, messageActions, send, regenerate, continueReply, select, streaming, messages]);

  // "Merge Responses": a model combines the shown answers; the result streams in and is kept on the shown reply.
  const [mergingId, setMergingId] = useState<string | null>(null);
  const merge = async (replyId: string, groups: ReplyGroup[]) => {
    if (!history || mergingId) return;
    const input = mergeInput(history, groups, replyId, chatId);
    if (!input.model) return;
    const write = (merged: MergedResponse | undefined) =>
      queryClient.setQueryData<ChatRecord>(['chat', chatId], (current) => {
        const tree = current?.chat?.history;
        const reply = tree?.messages[replyId];
        if (!current || !tree || !reply) return current;
        const { merged: _old, ...rest } = reply;
        const next = merged ? { ...rest, merged } : rest;
        return { ...current, chat: { ...current.chat, history: { ...tree, messages: { ...tree.messages, [replyId]: next } } } };
      });
    setMergingId(replyId);
    write({ status: true, content: '' });
    let shownAt = 0;
    let content: string;
    try {
      content = await mergeResponses(client, input, (text) => {
        // A redraw at most every tenth of a second while it streams.
        if (Date.now() - shownAt < 100) return;
        shownAt = Date.now();
        write({ status: true, content: text });
      });
    } catch (error) {
      write(undefined);
      toast(`Couldn't merge the answers: ${describeError(error)}`, 'error');
      return;
    } finally {
      setMergingId(null);
    }
    write({ status: true, content });
    const saved = queryClient.getQueryData<ChatRecord>(['chat', chatId])?.chat?.history;
    const reply = saved?.messages[replyId];
    if (temporary || !saved || !reply) return;
    await saveMessage(client, chatId, reply, lastId ?? saved.currentId).catch((error: unknown) =>
      toast(`Merged, but couldn't save it to the chat: ${describeError(error)}`, 'error'),
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ChatHeader
        title={temporary ? 'Temporary Chat' : chat?.title}
        menu={menu}
        accessory={chat ? <IconButton icon="adjustments-horizontal" label="Controls" onPress={() => setControlsOpen(true)} /> : null}
      />
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
            ref={list}
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
            history={history}
            onShow={show}
            multiAsTabs={multiAsTabs}
            onMerge={streaming ? undefined : (replyId, groups) => void merge(replyId, groups)}
            mergingId={mergingId}
          />
        )}
        {query.isError || notFound ? null : (
          <Composer
            draftKey={chatId}
            model={model}
            models={selected}
            modelLabel={choice.label}
            onPickModel={() => setPickerOpen(true)}
            onSend={onSend}
            onStop={() => void stop(chatId)}
            onSendQueued={(id) => void sendQueuedNow(id)}
            streaming={streaming}
            temporary={temporary}
          />
        )}
      </KeyboardAvoidingView>
      {picker.element}
      <ControlsSheet
        visible={controlsOpen}
        onClose={() => setControlsOpen(false)}
        params={(chat?.chat?.params ?? {}) as Record<string, unknown>}
        files={(chat?.chat?.files ?? []) as unknown[]}
        onChange={saveControls}
        overview={chat?.chat?.history ? { history: chat.chat.history, leafId: lastId, models: models.data, onShow: showMessage } : undefined}
      />
      <ModelPicker
        visible={pickerOpen}
        models={choice.models}
        selectedIds={selected.map((item) => item.id)}
        defaultIds={choice.defaultIds}
        onChange={choice.pick}
        compareAllowed={choice.compareAllowed}
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
