import type { DtReply } from '@maviechat/deeptutor-protocol';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { usePalette } from '@/theme';
import { DtReplyView, DtUserBubble } from './DtReplyView';

export type DtListItem = { key: string; kind: 'user'; text: string } | { key: string; kind: 'reply'; reply: DtReply; last: boolean };

interface DtMessageListProps {
  items: DtListItem[];
  baseUrl: string;
  onRegenerate?: () => void;
  /** Changes when a new turn starts; the list then scrolls to the bottom. */
  pinToBottomKey?: string;
}

const NEAR_BOTTOM = 120;

/** A DeepTutor chat, opened at the newest message; follows a streaming reply while you're at the bottom. */
export function DtMessageList({ items, baseUrl, onRegenerate, pinToBottomKey }: DtMessageListProps) {
  const palette = usePalette();
  const list = useRef<FlashListRef<DtListItem>>(null);
  const following = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  useEffect(() => {
    if (!pinToBottomKey) return;
    following.current = true;
    requestAnimationFrame(() => list.current?.scrollToEnd({ animated: true }));
  }, [pinToBottomKey]);

  return (
    <View style={styles.wrap}>
      <FlashList
        ref={list}
        data={items}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.kind}
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
        renderItem={({ item }) =>
          item.kind === 'user' ? (
            <DtUserBubble text={item.text} />
          ) : (
            <DtReplyView reply={item.reply} baseUrl={baseUrl} onRegenerate={item.last ? onRegenerate : undefined} />
          )
        }
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
