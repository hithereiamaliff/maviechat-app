import { listSharedChats, SHARED_PAGE_SIZE, sharedChatUrl, unshareAllChats, unshareChat, type SharedChat, type SharedChatOrder } from '@maviechat/owui-protocol';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { useDebounced } from '@/lib/useDebounced';
import { fonts, radius, usePalette } from '@/theme';

const ORDERS: { label: string; order: SharedChatOrder }[] = [
  { label: 'Updated', order: { by: 'updated_at', direction: 'desc' } },
  { label: 'Title', order: { by: 'title', direction: 'asc' } },
];

const day = (seconds: number) => (seconds ? new Date(seconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** Your shared chats in a sheet, as the web's Manage dialog: search, sort, open, copy each link or delete it, or delete them all. */
export function SharedChatsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  // Opening a chat waits for the sheet to be gone, then closes Settings too.
  const pending = useRef<(() => void) | null>(null);
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onDismiss={() => {
        const run = pending.current;
        pending.current = null;
        run?.();
      }}>
      {visible ? (
        <SharedChats
          onClose={onClose}
          onOpen={(chatId) => {
            pending.current = () => {
              router.dismissAll();
              router.replace({ pathname: '/c/[id]', params: { id: chatId } });
            };
            onClose();
          }}
        />
      ) : null}
    </Modal>
  );
}

function SharedChats({ onClose, onOpen }: { onClose: () => void; onOpen: (chatId: string) => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client, session } = useAuthed();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState(0);
  const query = useDebounced(search.trim(), 500);
  const order = (ORDERS[sort] ?? ORDERS[0])!.order;
  const list = useInfiniteQuery({
    queryKey: ['shared-chats', query, order.by],
    queryFn: ({ pageParam }) => listSharedChats(client, pageParam, query || undefined, order),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (last.length >= SHARED_PAGE_SIZE ? all.length + 1 : undefined),
  });
  const chats = list.data?.pages.flat() ?? [];
  const refresh = (chatId?: string) => {
    void queryClient.invalidateQueries({ queryKey: ['shared-chats'] });
    if (chatId) void queryClient.invalidateQueries({ queryKey: ['chat-share', chatId] });
    void queryClient.invalidateQueries({ queryKey: ['chats'] });
  };

  const remove = (chat: SharedChat) =>
    Alert.alert('Delete this link?', `People with the link to “${chat.title || 'this chat'}” can’t open it any more. The chat stays.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete Link',
        style: 'destructive',
        onPress: () =>
          void unshareChat(client, chat.chatId).then(
            () => {
              refresh(chat.chatId);
              toast('Link deleted');
            },
            (error: unknown) => toast(`Couldn’t delete the link: ${describeError(error)}`, 'error'),
          ),
      },
    ]);
  const removeAll = () =>
    Alert.alert('Delete all share links?', 'Nobody can open your shared chats any more. The chats stay.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete All',
        style: 'destructive',
        onPress: () =>
          void unshareAllChats(client).then(
            () => {
              refresh();
              for (const chat of chats) void queryClient.invalidateQueries({ queryKey: ['chat-share', chat.chatId] });
              toast('All share links deleted');
            },
            (error: unknown) => toast(`Couldn’t delete them: ${describeError(error)}`, 'error'),
          ),
      },
    ]);

  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Text style={[styles.heading, { color: palette.text }]} accessibilityRole="header">
          Shared Chats
        </Text>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.done, { color: palette.link }]}>Done</Text>
        </Pressable>
      </View>
      <View style={styles.bar}>
        <View style={[styles.search, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Icon name="magnifying-glass" size={16} color={palette.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by title"
            placeholderTextColor={palette.textFaint}
            autoCorrect={false}
            clearButtonMode="while-editing"
            accessibilityLabel="Search shared chats"
            style={[styles.searchInput, { color: palette.text }]}
          />
        </View>
        <View style={[styles.segments, { backgroundColor: palette.surfaceStrong }]} accessibilityRole="radiogroup">
          {ORDERS.map((option, index) => (
            <Pressable
              key={option.label}
              accessibilityRole="radio"
              accessibilityState={{ selected: index === sort }}
              accessibilityLabel={`Sort by ${option.label}`}
              onPress={() => setSort(index)}
              style={[styles.segment, index === sort && { backgroundColor: palette.background }]}>
              <Text style={[styles.segmentText, { color: index === sort ? palette.text : palette.textMuted }]}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <FlashList
        data={chats}
        keyExtractor={(chat) => chat.chatId}
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        ListEmptyComponent={
          list.isLoading ? (
            <ActivityIndicator style={styles.loading} color={palette.textMuted} />
          ) : (
            <Text style={[styles.empty, { color: palette.textMuted }]}>{list.isError ? `Couldn’t load them: ${describeError(list.error)}` : query ? 'No shared chats match.' : 'You haven’t shared any chats.'}</Text>
          )
        }
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <ActivityIndicator style={styles.loading} color={palette.textMuted} />
          ) : chats.length && !query ? (
            <Pressable accessibilityRole="button" onPress={removeAll} style={styles.removeAll}>
              <Text style={[styles.removeAllText, { color: palette.danger }]}>Delete All Share Links</Text>
            </Pressable>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Opens the chat"
            onPress={() => onOpen(item.chatId)}
            style={({ pressed }) => [styles.row, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
            <View style={styles.rowText}>
              <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
                {item.title || 'New Chat'}
              </Text>
              <Text style={[styles.date, { color: palette.textFaint }]}>{day(item.updated_at)}</Text>
            </View>
            {item.shareId ? (
              <IconButton
                icon="link"
                label="Copy link"
                size={18}
                color={palette.textMuted}
                onPress={() => void Clipboard.setStringAsync(sharedChatUrl(session.baseUrl, item.shareId as string)).then(() => toast('Link copied'))}
              />
            ) : null}
            <IconButton icon="trash" label="Delete link" size={18} color={palette.textMuted} onPress={() => remove(item)} />
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  heading: { fontFamily: fonts.semibold, fontSize: 17 },
  done: { fontFamily: fonts.semibold, fontSize: 16 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 10, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 0 },
  segments: { flexDirection: 'row', padding: 2, borderRadius: radius.md },
  segment: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.md - 2 },
  segmentText: { fontFamily: fonts.medium, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: 16, paddingRight: 8, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.medium, fontSize: 15 },
  date: { fontFamily: fonts.regular, fontSize: 12 },
  loading: { marginVertical: 20 },
  empty: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: 32, paddingHorizontal: 24 },
  removeAll: { alignSelf: 'center', marginVertical: 24, padding: 8 },
  removeAllText: { fontFamily: fonts.medium, fontSize: 15 },
});
