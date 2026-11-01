import { modelName, type HistoryMessage, type ModelItem } from '@maviechat/owui-protocol';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useRef } from 'react';
import { StyleSheet } from 'react-native';
import { AssistantMessage } from './AssistantMessage';
import { UserMessage } from './UserMessage';

interface MessageListProps {
  messages: HistoryMessage[];
  models: ModelItem[] | undefined;
  position: (messageId: string) => { index: number; count: number };
  onStep: (messageId: string, step: -1 | 1) => void;
  baseUrl: string;
  token: string;
}

/** The shown branch of a chat, opened at the newest message like the web app. */
export function MessageList({ messages, models, position, onStep, baseUrl, token }: MessageListProps) {
  const list = useRef<FlashListRef<HistoryMessage>>(null);
  const lastId = messages[messages.length - 1]?.id;

  return (
    <FlashList
      ref={list}
      data={messages}
      keyExtractor={(message) => message.id}
      getItemType={(message) => message.role}
      contentContainerStyle={styles.content}
      keyboardDismissMode="interactive"
      maintainVisibleContentPosition={{ startRenderingFromBottom: true, autoscrollToBottomThreshold: 0.2 }}
      onLoad={() => list.current?.scrollToEnd({ animated: false })}
      renderItem={({ item }) =>
        item.role === 'user' ? (
          <UserMessage
            message={item}
            branch={position(item.id)}
            onStep={(step) => onStep(item.id, step)}
            baseUrl={baseUrl}
            token={token}
          />
        ) : (
          <AssistantMessage
            message={item}
            modelLabel={typeof item.modelName === 'string' && item.modelName ? item.modelName : modelName(models, item.model)}
            branch={position(item.id)}
            onStep={(step) => onStep(item.id, step)}
            isLast={item.id === lastId}
            baseUrl={baseUrl}
            token={token}
          />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 24 },
});
