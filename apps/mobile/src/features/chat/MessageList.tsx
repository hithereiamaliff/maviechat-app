import {
  groupPosition,
  groupsDone,
  mergedResponse,
  modelName,
  newestLeaf,
  replyGroups,
  switchGroupVersion,
  type ChatHistory,
  type HistoryMessage,
  type ModelAction,
  type ModelItem,
  type ReplyAnnotation,
  type ReplyGroup,
} from '@maviechat/owui-protocol';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { usePalette } from '@/theme';
import { AssistantMessage } from './AssistantMessage';
import { MultiReplies } from './MultiReplies';
import { ReplyEditor } from './ReplyEditor';
import { UserMessage } from './UserMessage';

/** What you can do to a message; undefined actions are hidden. */
export interface MessageActions {
  saveEdit?: (message: HistoryMessage, content: string) => Promise<boolean>;
  sendEdit?: (message: HistoryMessage, content: string) => Promise<boolean>;
  regenerate?: (reply: HistoryMessage, prompt?: string) => void;
  /** Edits a reply in place, or as a new version (`asCopy`). */
  editReply?: (reply: HistoryMessage, texts: string[], asCopy: boolean) => Promise<boolean>;
  rate?: (reply: HistoryMessage, change: { rating?: 1 | -1; details?: Partial<ReplyAnnotation> }) => Promise<boolean>;
  /** "Continue Response" on the last reply. */
  continueReply?: (reply: HistoryMessage) => void;
  /** The action buttons of the reply's model, and running one. */
  actionsFor?: (reply: HistoryMessage) => ModelAction[];
  runAction?: (reply: HistoryMessage, action: ModelAction) => void;
  remove?: (message: HistoryMessage) => void;
  /** Allow or deny a tool call a reply is waiting on. */
  resolveApproval?: (reply: HistoryMessage, callId: string, approve: boolean) => Promise<void>;
  canDeleteMessage: boolean;
  canDeleteReply: boolean;
}

export interface MessageListHandle {
  /** Brings a message into view (Overview). */
  scrollToMessage(id: string): void;
}

interface MessageListProps {
  ref?: Ref<MessageListHandle>;
  messages: HistoryMessage[];
  actions: MessageActions;
  models: ModelItem[] | undefined;
  position: (messageId: string) => { index: number; count: number };
  onStep: (messageId: string, step: -1 | 1) => void;
  onFollowUp?: (text: string) => void;
  /** Changes when a new turn starts; the list then scrolls to the bottom. */
  pinToBottomKey?: string;
  baseUrl: string;
  token: string;
  /** The whole tree, so a message sent to several models (Compare) shows every model's answer. */
  history?: ChatHistory;
  /** Shows a leaf and saves the choice: a column's version arrows, "Continue with this answer". */
  onShow?: (leafId: string) => void;
  /** Answers from several models as tabs rather than cards (the web's interface setting). */
  multiAsTabs?: boolean;
  /** Keeps a reply being written in view while you're at the bottom (the web's "auto-scroll"). */
  followReplies?: boolean;
  /** After you switch a message's version, scrolls its top into view. */
  scrollOnBranchChange?: boolean;
  /** "Merge Responses" for the turn whose shown reply this is. */
  onMerge?: (replyId: string, groups: ReplyGroup[]) => void;
  mergingId?: string | null;
}

/** A reply to a message sent to several models is drawn with its siblings, under one key per turn. */
function isMultiReply(history: ChatHistory | undefined, message: HistoryMessage): boolean {
  const parent = message.role === 'assistant' && message.parentId ? history?.messages[message.parentId] : undefined;
  return (parent?.models?.length ?? 0) > 1;
}

const NEAR_BOTTOM = 120;

/** The shown branch of a chat, opened at the newest message; follows a streaming reply while you're at the bottom. */
export function MessageList({
  ref,
  messages,
  actions,
  models,
  position,
  onStep,
  onFollowUp,
  pinToBottomKey,
  baseUrl,
  token,
  history,
  onShow,
  multiAsTabs = false,
  followReplies = true,
  scrollOnBranchChange = true,
  onMerge,
  mergingId = null,
}: MessageListProps) {
  const palette = usePalette();
  const list = useRef<FlashListRef<HistoryMessage>>(null);
  const following = useRef(true);

  useImperativeHandle(
    ref,
    () => ({
      scrollToMessage: (id) => {
        const index = messages.findIndex((message) => message.id === id);
        if (index < 0) return;
        following.current = false;
        list.current?.scrollToIndex({ index, animated: true, viewPosition: 0 });
      },
    }),
    [messages],
  );
  const [atBottom, setAtBottom] = useState(true);
  const [editing, setEditing] = useState<HistoryMessage | null>(null);
  const lastId = messages[messages.length - 1]?.id;

  // The other version takes the same place in the list; its top is brought into view, as on the web.
  const switchVersion = (messageId: string, direction: -1 | 1) => {
    const index = messages.findIndex((message) => message.id === messageId);
    onStep(messageId, direction);
    if (!scrollOnBranchChange || index < 0) return;
    following.current = false;
    setTimeout(() => list.current?.scrollToIndex({ index, animated: true, viewPosition: 0 }), 120);
  };

  useEffect(() => {
    if (!pinToBottomKey) return;
    following.current = true;
    requestAnimationFrame(() => list.current?.scrollToEnd({ animated: true }));
  }, [pinToBottomKey]);

  return (
    <View style={styles.wrap}>
      <FlashList
        ref={list}
        data={messages}
        // A turn's answers keep their row (and the cards their place) as you choose between them.
        keyExtractor={(message) => (isMultiReply(history, message) ? `turn:${message.parentId}` : message.id)}
        getItemType={(message) => (isMultiReply(history, message) ? 'multi' : message.role)}
        contentContainerStyle={styles.content}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        maintainVisibleContentPosition={{ startRenderingFromBottom: true, autoscrollToBottomThreshold: followReplies ? 0.2 : undefined }}
        onLoad={() => list.current?.scrollToEnd({ animated: false })}
        scrollEventThrottle={64}
        onScroll={(event) => {
          const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
          const near = contentOffset.y + layoutMeasurement.height >= contentSize.height - NEAR_BOTTOM;
          following.current = near;
          if (near !== atBottom) setAtBottom(near);
        }}
        onContentSizeChange={() => {
          if (following.current && followReplies) list.current?.scrollToEnd({ animated: false });
        }}
        renderItem={({ item }) => {
          const branch = position(item.id);
          const { saveEdit, sendEdit, regenerate, remove, editReply, rate, continueReply, actionsFor, runAction } = actions;
          const reply = (message: HistoryMessage, place: { index: number; count: number }, step: (direction: -1 | 1) => void) => (
            <AssistantMessage
              message={message}
              modelLabel={typeof message.modelName === 'string' && message.modelName ? message.modelName : modelName(models, message.model)}
              branch={place}
              onStep={step}
              isLast={item.id === lastId}
              baseUrl={baseUrl}
              token={token}
              onFollowUp={onFollowUp}
              onRegenerate={regenerate ? (prompt) => regenerate(message, prompt) : undefined}
              // A reply can be deleted only while another version of it remains, as on the web.
              onDelete={remove && actions.canDeleteReply && place.count > 1 ? () => remove(message) : undefined}
              onEdit={editReply ? () => setEditing(message) : undefined}
              onRate={rate ? (change) => rate(message, change) : undefined}
              onContinue={continueReply ? () => continueReply(message) : undefined}
              actions={actionsFor?.(message)}
              onAction={runAction ? (action) => runAction(message, action) : undefined}
              onApprove={actions.resolveApproval ? (callId, approve) => actions.resolveApproval!(message, callId, approve) : undefined}
            />
          );
          const groups = item.role === 'assistant' && history ? replyGroups(history, item.id) : null;
          if (groups && history) {
            const last = item.id === lastId;
            return (
              <MultiReplies
                groups={groups}
                replyId={item.id}
                messages={history.messages}
                labelOf={(message) => (typeof message.modelName === 'string' && message.modelName ? message.modelName : modelName(models, message.model))}
                tabs={multiAsTabs}
                renderReply={(message, group) =>
                  reply(message, groupPosition(group), (direction) => {
                    const leaf = switchGroupVersion(history, group, direction);
                    if (leaf) onShow?.(leaf);
                  })
                }
                onSelect={(group) => onShow?.(newestLeaf(history, group.shownId))}
                merged={mergedResponse(history.messages[item.id])}
                onMerge={onMerge && last && groupsDone(history, groups) ? () => onMerge(item.id, groups) : undefined}
                merging={mergingId === item.id}
                baseUrl={baseUrl}
                token={token}
              />
            );
          }
          return item.role === 'user' ? (
            <UserMessage
              message={item}
              branch={branch}
              onStep={(step) => switchVersion(item.id, step)}
              baseUrl={baseUrl}
              token={token}
              onSaveEdit={saveEdit ? (content) => saveEdit(item, content) : undefined}
              onSendEdit={sendEdit ? (content) => sendEdit(item, content) : undefined}
              // As on the web, the very first message can go only while another version of it remains.
              onDelete={remove && actions.canDeleteMessage && (item.parentId !== null || branch.count > 1) ? () => remove(item) : undefined}
            />
          ) : (
            reply(item, branch, (step) => switchVersion(item.id, step))
          );
        }}
      />
      <ReplyEditor
        message={editing}
        onClose={() => setEditing(null)}
        onSave={(texts, asCopy) => (editing && actions.editReply ? actions.editReply(editing, texts, asCopy) : Promise.resolve(false))}
      />
      {!atBottom ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scroll to the newest message"
          onPress={() => {
            following.current = true;
            list.current?.scrollToEnd({ animated: true });
          }}
          style={[styles.jump, { backgroundColor: palette.menu, borderColor: palette.border, shadowColor: '#000' }]}>
          <Icon name="arrow-down" size={18} color={palette.text} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 24 },
  jump: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
});
