import {
  artifactIndex,
  awaitingYou,
  branchArtifacts,
  combineQueued,
  compactChat,
  createChat,
  forkChat,
  isTemporaryChatId,
  messageBlocks,
  mergeInput,
  mergeResponses,
  modelActions,
  newestLeaf,
  outputText,
  OwuiHttpError,
  pendingAskUser,
  plainText,
  resolveToolCall,
  savedTemporaryChat,
  saveMessage,
  selectBranch,
  speechRate,
  updateChatControls,
  uuidv4,
  type ChatRecord,
  type FileItem,
  type HistoryMessage,
  type AskUserAnswer,
  type MergedResponse,
  type ReplyGroup,
} from '@maviechat/owui-protocol';
import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/IconButton';
import type { MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { ArtifactsSheet } from '@/features/chat/ArtifactsSheet';
import { AskUserCard } from '@/features/chat/AskUserCard';
import { ChatHeader } from '@/features/chat/ChatHeader';
import { useFolderPicker } from '@/features/chats/FolderPicker';
import { useShareSheet } from '@/features/chats/ShareSheet';
import { useTagsSheet } from '@/features/chats/TagsSheet';
import { Composer, type OutgoingMessage } from '@/features/chat/Composer';
import { EmbedActionsContext, type EmbedActions } from '@/features/chat/EmbedFrame';
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
import { useCodeRunner } from '@/features/python/useCodeRunner';
import { useAutoReadAloud } from '@/lib/autoReadAloud';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities, useModels, useServerConfig, useUserSettings } from '@/lib/server';
import { useInterface } from '@/lib/uiSettings';
import { ArtifactsContext } from '@/markdown/ArtifactsContext';
import { CodeRunContext } from '@/markdown/CodeRunContext';
import { useDeepTutor } from '@/session/DeepTutorProvider';
import { fonts, usePalette } from '@/theme';

/** Why the server didn't compact, as it says. */
const COMPACT_SKIPPED: Record<string, string> = {
  too_short: 'This chat is too short to compact.',
  empty: 'There’s nothing to compact yet.',
  disabled: 'Context compaction is turned off on this server.',
};

export default function ChatScreen() {
  const palette = usePalette();
  const params = useLocalSearchParams<{ id: string }>();
  const chatId = Array.isArray(params.id) ? (params.id[0] ?? '') : (params.id ?? '');
  const temporary = isTemporaryChatId(chatId);
  const { client, session } = useAuthed();
  const queryClient = useQueryClient();
  const models = useModels();
  const ui = useInterface();
  const actions = useChatActions();
  const picker = useFolderPicker();
  const shareSheet = useShareSheet();
  const tagsSheet = useTagsSheet();
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
  // The web's artifacts: pages and SVGs from the replies on the shown branch (worked out when a reply is saved, not while it streams).
  const artifacts = useMemo(() => branchArtifacts(messages.filter((message) => message.role !== 'user').map((message) => plainText(messageBlocks(message)))), [messages]);
  const [artifactAt, setArtifactAt] = useState<number | null>(null);
  const openArtifact = useCallback(
    (code: string) => {
      const index = artifactIndex(artifacts, code);
      if (index === -1) return false;
      setArtifactAt(index);
      return true;
    },
    [artifacts],
  );
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
  const clone = async () => {
    const copy = await actions.clone(ref);
    if (copy) router.replace(`/c/${copy}`);
  };
  const menu: MenuItem[] = [
    // As on the web, only when the chat has some; the latest version first.
    ...(artifacts.length ? [{ key: 'artifacts', label: 'Artifacts', icon: 'cube' as const, onPress: () => setArtifactAt(artifacts.length - 1) }] : []),
    ...((chat && !temporary
      ? [
          { key: 'rename', label: 'Rename', icon: 'pencil', onPress: () => actions.rename(ref) },
          { key: 'pin', label: pinned ? 'Unpin' : 'Pin', icon: pinned ? 'bookmark-slash' : 'bookmark', onPress: () => actions.togglePin(ref, pinned) },
          { key: 'tags', label: 'Tags', icon: 'tag', onPress: () => tagsSheet.open(ref) },
          ...(actions.canShare ? [{ key: 'share', label: 'Share', icon: 'link' as const, onPress: () => shareSheet.open(ref) }] : []),
          ...(actions.canExport ? [{ key: 'download', label: 'Download', icon: 'arrow-down' as const, onPress: () => actions.download(ref) }] : []),
          { key: 'copy', label: 'Copy', icon: 'clipboard-document', onPress: () => void actions.copy(ref) },
          ...(actions.canClone ? [{ key: 'clone', label: 'Clone', icon: 'rectangle-stack' as const, onPress: () => void clone() }] : []),
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
      : []) satisfies MenuItem[]),
  ];

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
  // A reply stopped for your approval or answer isn't being written; it waits for you.
  const writing = (message: HistoryMessage | undefined) => message?.role === 'assistant' && message.done === false && !awaitingYou(message);
  const streaming = messages.some(writing) || (lastAsked?.childrenIds ?? []).some((id) => writing(history?.messages[id]));
  const lastReply = messages[messages.length - 1];
  const asking = !temporary && lastReply?.role === 'assistant' ? pendingAskUser(lastReply) : null;
  const lastId = messages[messages.length - 1]?.id ?? null;
  const queueEnabled = ui('enableMessageQueue');
  const model = choice.model;
  const selected = choice.selected;
  const multiAsTabs = ui('displayMultiModelResponsesInTabs');

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

  // "Copy each reply when it's done": the reply's words, as the web copies them.
  const autoCopy = ui('responseAutoCopy');
  const wasWriting = useRef(false);
  useEffect(() => {
    if (wasWriting.current && !streaming && autoCopy && lastReply?.role === 'assistant') {
      const text = plainText(messageBlocks(lastReply));
      if (text.trim()) void Clipboard.setStringAsync(text);
    }
    wasWriting.current = streaming;
  }, [streaming, autoCopy, lastReply]);

  // Audio's "Read replies when they finish", in your voice and speed (Read Aloud allowed). Not a
  // reply you stopped: the web reads only replies that finish.
  const settings = useUserSettings();
  const capabilities = useCapabilities();
  // A temporary chat with messages can become a saved one, as the web's Save Chat makes it (not where temporary chats are enforced).
  const enforcedTemporary = capabilities ? !capabilities.isAdmin && capabilities.can('chat.temporary_enforced') : true;
  const canSaveTemporary = temporary && !enforcedTemporary && Object.keys(chat?.chat?.history?.messages ?? {}).length > 0 && !streaming;
  const saveTemporary = async () => {
    const history = chat?.chat?.history;
    if (!history?.currentId) return;
    try {
      const saved = await createChat(client, savedTemporaryChat(history, { models: selected.map((item) => item.id), params: (chat?.chat?.params ?? {}) as Record<string, unknown> }));
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      router.replace(`/c/${saved.id}`);
      toast('Conversation saved', 'success');
    } catch (error) {
      toast(`Couldn't save the conversation: ${describeError(error)}`, 'error');
    }
  };
  const reply = lastReply?.role === 'assistant' ? lastReply : undefined;
  const stoppedByYou = useRef(false);
  const stopReply = (id: string) => {
    stoppedByYou.current = true;
    return stop(id);
  };
  useEffect(() => {
    if (streaming) stoppedByYou.current = false;
  }, [streaming]);
  const wasStopped = useCallback(() => stoppedByYou.current, []);
  useAutoReadAloud({
    id: reply?.id ?? '',
    writing: streaming,
    finished: Boolean(reply) && reply?.done !== false && !reply?.error,
    markdown: reply ? outputText(reply.output) || reply.content || '' : '',
    enabled: settings.data?.ui?.responseAutoPlayback === true && (capabilities?.can('chat.tts', true) ?? false),
    rate: speechRate(settings.data?.ui),
    skip: wasStopped,
  });

  // A model picked with `@` answers alone, until it's taken off (as on the web).
  const targets = (atModelId?: string | null) => {
    const at = atModelId ? models.data?.find((item) => item.id === atModelId) : undefined;
    return at ? { model: at, models: [at] } : { model, models: selected };
  };
  const deliver = async ({ text, files, toggles, toolIds, skillIds, filterIds, atModelId }: OutgoingMessage, parentId: string | null) => {
    const target = targets(atModelId);
    if (!target.model) return false;
    const result = await send({ chatId, parentId, content: text, files, model: target.model, models: target.models, toggles, toolIds, skillIds, filterIds });
    if (result) select(result.replyId);
    return Boolean(result);
  };

  // `/fork`: carry on in a new chat holding the conversation up to the shown message, as the web does.
  const fork = async () => {
    if (streaming) {
      toast('Wait for the reply to finish before forking.');
      return;
    }
    try {
      const copy = await forkChat(client, chatId, lastId);
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      void queryClient.invalidateQueries({ queryKey: ['folder-chats'] });
      toast('Chat forked');
      router.replace(`/c/${copy.id}`);
    } catch (error) {
      toast(`Couldn't fork the chat: ${describeError(error)}`, 'error');
    }
  };

  // `/compact`, where the admin turned context compaction on: the server summarises the older
  // messages so a long chat fits the model again. As on the web, the model answering does it.
  const serverConfig = useServerConfig();
  const runCode = useCodeRunner();
  const compactionOn = serverConfig.data?.features?.enable_context_compaction === true;
  const compact = async () => {
    if (streaming) {
      toast('Wait for the reply to finish before compacting.');
      return;
    }
    const modelId = getDraft(chatId).atModel ?? model?.id;
    if (!history?.currentId || !modelId) {
      toast('There’s nothing to compact yet.');
      return;
    }
    toast('Compacting…');
    try {
      const result = await compactChat(client, chatId, modelId);
      if (result.compacted) toast('Chat compacted', 'success');
      else toast(COMPACT_SKIPPED[result.reason ?? ''] ?? 'There was nothing to compact.');
      await queryClient.invalidateQueries({ queryKey: ['chat', chatId] });
    } catch (error) {
      toast(`Couldn't compact the chat: ${describeError(error)}`, 'error');
    }
  };

  const onSend = async (message: OutgoingMessage) => {
    stalled.current = false;
    if (streaming) {
      // As on the web: a message typed during a reply waits for it, unless the queue is turned off in settings.
      if (queueEnabled) {
        updateDraft(chatId, (draft) => ({ ...draft, queue: [...draft.queue, { id: uuidv4(), prompt: message.text, files: message.files }] }));
        return true;
      }
      await stopReply(chatId);
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
    const { toggles, toolIds, skillIds, filterIds, atModel } = getDraft(chatId);
    const at = atModel ? models.data?.find((item) => item.id === atModel) : undefined;
    const target = at ? { model: at, models: [at] } : { model, models: selected };
    if (!target.model) return;
    void send({ chatId, parentId: lastId, content: prompt, files, model: target.model, models: target.models, toggles, toolIds, skillIds, filterIds })
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
  }, [streaming, queue, model, selected, models.data, chat, chatId, lastId, send, select]);

  const sendQueuedNow = async (id: string) => {
    const item = getDraft(chatId).queue.find((entry) => entry.id === id);
    if (!item || !model || busy.current) return;
    busy.current = true;
    updateDraft(chatId, (draft) => ({ ...draft, queue: draft.queue.filter((entry) => entry.id !== id) }));
    stalled.current = false;
    try {
      if (streaming) await stopReply(chatId);
      const { toggles, toolIds, skillIds, filterIds, atModel } = getDraft(chatId);
      const sent = await deliver({ text: item.prompt, files: item.files, toggles, toolIds, skillIds, filterIds, atModelId: atModel ?? undefined }, lastId);
      if (!sent) {
        stalled.current = true;
        updateDraft(chatId, (draft) => ({ ...draft, queue: [item, ...draft.queue] }));
      }
    } finally {
      busy.current = false;
    }
  };

  // A reply stopped for you: approving or denying a tool call, or answering the model's questions.
  // The server saves it and carries on with the reply; its events reach this chat as usual.
  const [resolving, setResolving] = useState(false);
  const resolve = async (messageId: string, callId: string, action: 'approve' | 'reject' | 'answer', answers?: Record<string, AskUserAnswer>) => {
    setResolving(true);
    try {
      await resolveToolCall(client, chatId, messageId, callId, action, answers ? { answers } : {});
    } catch (error) {
      toast(`Couldn't send that: ${describeError(error)}`, 'error');
      void query.refetch();
    } finally {
      setResolving(false);
    }
  };
  // The reply list keeps one set of actions; this keeps its approval handler current.
  const resolveRef = useRef(resolve);
  useEffect(() => {
    resolveRef.current = resolve;
  });

  // What a tool's web content may ask of this chat, as on the web: text for the message box, or a
  // message sent once you agree (the web asks too, for content from elsewhere).
  const sendRef = useRef(onSend);
  useEffect(() => {
    sendRef.current = onSend;
  });
  const embedActions = useMemo<EmbedActions>(() => {
    const confirmSend = (text: string, files: FileItem[], afterSend?: () => void) =>
      Alert.alert('Send this message?', `The tool's content asks to send:\n\n${text.length > 600 ? `${text.slice(0, 600)}…` : text}`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: () => {
            const { toggles, toolIds, skillIds, filterIds } = getDraft(chatId);
            void sendRef.current({ text, files, toggles, toolIds, skillIds, filterIds }).then((sent) => {
              if (sent) afterSend?.();
            });
          },
        },
      ]);
    return {
      setPrompt: (text) => updateDraft(chatId, (draft) => ({ ...draft, text })),
      sendPrompt: (text) => confirmSend(text, []),
      sendDraft: () => {
        const draft = getDraft(chatId);
        if (!draft.text.trim() && draft.files.length === 0) return;
        confirmSend(draft.text, draft.files, () => updateDraft(chatId, (current) => ({ ...current, text: '', files: [] })));
      },
    };
  }, [chatId]);

  const listActions = useMemo<MessageActions>(() => {
    const extras = () => {
      const { toggles, toolIds, skillIds, filterIds } = getDraft(chatId);
      return { toggles, toolIds, skillIds, filterIds };
    };
    const modelOf = (reply: HistoryMessage) => models.data?.find((item) => item.id === reply.model) ?? model;
    return {
      saveEdit: messageActions.saveEdit,
      sendEdit: async (message, content, files) => {
        if (!model) return false;
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
      resolveApproval: temporary ? undefined : (reply, callId, approve) => resolveRef.current(reply.id, callId, approve ? 'approve' : 'reject'),
      // As the web's Ask and Explain do: the prompt replaces what's in the message box, for you to send.
      quote: (prompt) => updateDraft(chatId, (draft) => ({ ...draft, text: prompt })),
      canDeleteMessage: messageActions.canDeleteMessage,
      canDeleteReply: messageActions.canDeleteReply,
    };
  }, [chatId, models.data, model, selected, messageActions, send, regenerate, continueReply, select, streaming, messages, temporary]);

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
        accessory={
          chat ? (
            <>
              {canSaveTemporary ? <IconButton icon="archive-box-arrow-down" label="Save Chat" onPress={() => void saveTemporary()} /> : null}
              <IconButton icon="adjustments-horizontal" label="Controls" onPress={() => setControlsOpen(true)} />
            </>
          ) : null
        }
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
          <ArtifactsContext.Provider value={openArtifact}>
          <CodeRunContext.Provider value={runCode}>
          <EmbedActionsContext.Provider value={embedActions}>
          <MessageList
            ref={list}
            messages={messages}
            actions={listActions}
            models={models.data}
            position={position}
            onStep={step}
            onFollowUp={(text) => {
              // Into the message box, or straight off (the web's setting).
              if (ui('insertFollowUpPrompt')) return updateDraft(chatId, (draft) => ({ ...draft, text }));
              const { toggles, toolIds, skillIds, filterIds } = getDraft(chatId);
              void onSend({ text, files: [], toggles, toolIds, skillIds, filterIds });
            }}
            pinToBottomKey={lastId ?? undefined}
            baseUrl={session.baseUrl}
            token={session.token}
            history={history}
            onShow={show}
            multiAsTabs={multiAsTabs}
            followReplies={ui('scrollOnResponseGeneration')}
            scrollOnBranchChange={ui('scrollOnBranchChange')}
            onMerge={streaming ? undefined : (replyId, groups) => void merge(replyId, groups)}
            mergingId={mergingId}
          />
          </EmbedActionsContext.Provider>
          </CodeRunContext.Provider>
          </ArtifactsContext.Provider>
        )}
        {asking && lastReply ? (
          <View style={styles.asking}>
            <AskUserCard
              key={asking.callId}
              questions={asking.questions}
              busy={resolving}
              onSubmit={(answers) => void resolve(lastReply.id, asking.callId, 'answer', answers)}
              onSkip={() => void resolve(lastReply.id, asking.callId, 'reject')}
            />
          </View>
        ) : null}
        {query.isError || notFound ? null : (
          <Composer
            draftKey={chatId}
            model={model}
            models={selected}
            modelLabel={choice.label}
            onPickModel={() => setPickerOpen(true)}
            onSend={onSend}
            onStop={() => void stopReply(chatId)}
            onSendQueued={(id) => void sendQueuedNow(id)}
            streaming={streaming}
            temporary={temporary}
            onFork={chat && !temporary && actions.canClone ? () => void fork() : undefined}
            onCompact={chat && !temporary && compactionOn ? () => void compact() : undefined}
          />
        )}
      </KeyboardAvoidingView>
      {picker.element}
      {shareSheet.element}
      {tagsSheet.element}
      <ArtifactsSheet artifacts={artifacts} start={artifactAt} chatId={chatId} onClose={() => setArtifactAt(null)} />
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
  asking: { paddingHorizontal: 12, paddingTop: 6 },
});
