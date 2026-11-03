import { modelName, type HistoryMessage, type ModelAction, type ModelItem, type ReplyAnnotation } from '@maviechat/owui-protocol';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { usePalette } from '@/theme';
import { AssistantMessage } from './AssistantMessage';
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
  canDeleteMessage: boolean;
  canDeleteReply: boolean;
}

interface MessageListProps {
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
}

const NEAR_BOTTOM = 120;

/** The shown branch of a chat, opened at the newest message; follows a streaming reply while you're at the bottom. */
export function MessageList({ messages, actions, models, position, onStep, onFollowUp, pinToBottomKey, baseUrl, token }: MessageListProps) {
  const palette = usePalette();
  const list = useRef<FlashListRef<HistoryMessage>>(null);
  const following = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [editing, setEditing] = useState<HistoryMessage | null>(null);
  const lastId = messages[messages.length - 1]?.id;

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
        keyExtractor={(message) => message.id}
        getItemType={(message) => message.role}
        contentContainerStyle={styles.content}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        maintainVisibleContentPosition={{ startRenderingFromBottom: true, autoscrollToBottomThreshold: 0.2 }}
        onLoad={() => list.current?.scrollToEnd({ animated: false })}
        scrollEventThrottle={64}
        onScroll={(event) => {
          const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
          const near = contentOffset.y + layoutMeasurement.height >= contentSize.height - NEAR_BOTTOM;
          following.current = near;
          if (near !== atBottom) setAtBottom(near);
        }}
        onContentSizeChange={() => {
          if (following.current) list.current?.scrollToEnd({ animated: false });
        }}
        renderItem={({ item }) => {
          const branch = position(item.id);
          const { saveEdit, sendEdit, regenerate, remove, editReply, rate, continueReply, actionsFor, runAction } = actions;
          return item.role === 'user' ? (
            <UserMessage
              message={item}
              branch={branch}
              onStep={(step) => onStep(item.id, step)}
              baseUrl={baseUrl}
              token={token}
              onSaveEdit={saveEdit ? (content) => saveEdit(item, content) : undefined}
              onSendEdit={sendEdit ? (content) => sendEdit(item, content) : undefined}
              // As on the web, the very first message can go only while another version of it remains.
              onDelete={remove && actions.canDeleteMessage && (item.parentId !== null || branch.count > 1) ? () => remove(item) : undefined}
            />
          ) : (
            <AssistantMessage
              message={item}
              modelLabel={typeof item.modelName === 'string' && item.modelName ? item.modelName : modelName(models, item.model)}
              branch={branch}
              onStep={(step) => onStep(item.id, step)}
              isLast={item.id === lastId}
              baseUrl={baseUrl}
              token={token}
              onFollowUp={onFollowUp}
              onRegenerate={regenerate ? (prompt) => regenerate(item, prompt) : undefined}
              // A reply can be deleted only while another version of it remains, as on the web.
              onDelete={remove && actions.canDeleteReply && branch.count > 1 ? () => remove(item) : undefined}
              onEdit={editReply ? () => setEditing(item) : undefined}
              onRate={rate ? (change) => rate(item, change) : undefined}
              onContinue={continueReply ? () => continueReply(item) : undefined}
              actions={actionsFor?.(item)}
              onAction={runAction ? (action) => runAction(item, action) : undefined}
            />
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
