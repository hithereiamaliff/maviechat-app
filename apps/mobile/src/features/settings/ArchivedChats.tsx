import { exportArchivedChats, exportFileNameAt, listArchivedChats, type ChatListItem } from '@maviechat/owui-protocol';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { MenuButton } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { useChatActions } from '@/features/chats/useChatActions';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities } from '@/lib/server';
import { useDebounced } from '@/lib/useDebounced';
import { fonts, radius, usePalette } from '@/theme';
import { shareJsonFile } from './exportFile';

/** The server answers 60 archived chats a page. */
const PAGE_SIZE = 60;

function day(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Archived Chats, as the web's settings tab: search, open, unarchive or delete each; unarchive all, or export them. */
export function ArchivedChats() {
  const palette = usePalette();
  const { client } = useAuthed();
  const toast = useToast();
  const capabilities = useCapabilities();
  const actions = useChatActions();
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim(), 300);
  const list = useInfiniteQuery({
    queryKey: ['archived', query],
    queryFn: ({ pageParam }) => listArchivedChats(client, pageParam, query || undefined),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (last.length >= PAGE_SIZE ? all.length + 1 : undefined),
  });
  const chats = list.data?.pages.flat() ?? [];

  // In the same format as Data Controls' export, so the file can be imported again.
  const exportAll = async () => {
    setExporting(true);
    try {
      const { json } = await exportArchivedChats(client);
      await shareJsonFile(exportFileNameAt('archived', Date.now()), json);
    } catch (error) {
      toast(`Couldn’t export them: ${describeError(error)}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  const open = (chat: ChatListItem) => {
    router.dismissAll();
    router.replace({ pathname: '/c/[id]', params: { id: chat.id } });
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        <View style={[styles.search, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Icon name="magnifying-glass" size={16} color={palette.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search"
            placeholderTextColor={palette.textFaint}
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.searchInput, { color: palette.text }]}
          />
          {search ? <IconButton icon="x-mark" label="Clear search" size={16} color={palette.textMuted} onPress={() => setSearch('')} /> : null}
        </View>
        {exporting ? <ActivityIndicator size="small" color={palette.textMuted} /> : null}
        {chats.length > 0 && !query && !exporting ? (
          <MenuButton
            label="Archived chats actions"
            size={20}
            color={palette.textMuted}
            items={[
              { key: 'unarchive', label: 'Unarchive All', icon: 'archive-box-arrow-down', onPress: actions.unarchiveAll },
              ...((capabilities?.can('chat.export', true) ?? false) ? [{ key: 'export', label: 'Export', icon: 'arrow-up-on-square' as const, onPress: () => void exportAll() }] : []),
            ]}
          />
        ) : null}
      </View>
      <FlashList
        data={chats}
        keyExtractor={(chat) => chat.id}
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        ListEmptyComponent={
          list.isLoading ? (
            <ActivityIndicator style={styles.loading} color={palette.textMuted} />
          ) : (
            <Text style={[styles.empty, { color: palette.textMuted }]}>
              {list.isError ? "Couldn't load archived chats." : query ? 'No archived chats match.' : 'You have no archived conversations.'}
            </Text>
          )
        }
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator style={styles.loading} color={palette.textMuted} /> : null}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Opens the chat"
            onPress={() => open(item)}
            style={({ pressed }) => [styles.row, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
            <View style={styles.rowText}>
              <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
                {item.title || 'New Chat'}
              </Text>
              <Text style={[styles.date, { color: palette.textFaint }]}>{day(item.updated_at)}</Text>
            </View>
            <IconButton icon="archive-box-arrow-down" label="Unarchive Chat" size={19} color={palette.textMuted} onPress={() => void actions.unarchive(item)} />
            {actions.canDelete ? <IconButton icon="trash" label="Delete Chat" size={19} color={palette.textMuted} onPress={() => actions.remove(item)} /> : null}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    paddingLeft: 10,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: 16, paddingRight: 8, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.medium, fontSize: 15 },
  date: { fontFamily: fonts.regular, fontSize: 12 },
  loading: { marginVertical: 20 },
  empty: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: 32, paddingHorizontal: 24 },
});
