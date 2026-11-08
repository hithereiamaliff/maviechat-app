import { deleteChat, listUserChats, OwuiHttpError, USER_CHATS_PAGE, type UserChat } from '@maviechat/owui-protocol';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { BackHeader } from '@/components/BackHeader';
import { MenuButton } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { Chip } from '@/features/workspace/ListControls';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { useDebounced } from '@/lib/useDebounced';
import { fonts, radius, usePalette } from '@/theme';

const param = (value: string | string[] | undefined) => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));
const when = (ms: number) => (ms ? new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

/**
 * A user's chats, for admins where the server lets admins see them (the web's "…'s Chats"):
 * found by words, newest first or by title, more as you scroll; each opens read-only on the
 * shared-chat page (Clone Chat copies it to your chats), or goes with Delete.
 */
export default function UserChats() {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client } = useAuthed();
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const userId = param(params.id);
  const name = param(params.name) || 'This user';
  const [query, setQuery] = useState('');
  const words = useDebounced(query.trim(), 400);
  const [byTitle, setByTitle] = useState(false);
  const chats = useInfiniteQuery({
    queryKey: ['admin', 'user-chats', userId, words, byTitle],
    queryFn: ({ pageParam }) => listUserChats(client, userId, { page: pageParam, query: words || undefined, orderBy: byTitle ? 'title' : 'updated_at', direction: byTitle ? 'asc' : 'desc' }),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.length < USER_CHATS_PAGE ? undefined : pages.length + 1),
    enabled: Boolean(userId),
  });
  const seen = new Set<string>();
  const items = (chats.data?.pages.flat() ?? []).filter((chat) => !seen.has(chat.id) && Boolean(seen.add(chat.id)));
  const refused = chats.error instanceof OwuiHttpError && chats.error.status === 401;

  const remove = (chat: UserChat) =>
    Alert.alert(`Delete “${chat.title || 'Untitled'}”?`, `It’s ${name}’s chat: it goes for them, for good.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deleteChat(client, chat.id).then(
            () => {
              void queryClient.invalidateQueries({ queryKey: ['admin', 'user-chats', userId] });
              toast('Chat deleted');
            },
            (error: unknown) => toast(`Couldn’t delete it: ${describeError(error)}`, 'error'),
          ),
      },
    ]);

  const header = (
    <View style={styles.top}>
      <TextInput value={query} onChangeText={setQuery} placeholder="Search chats" placeholderTextColor={palette.textFaint} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" accessibilityLabel="Search chats" style={[styles.search, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
      <View style={styles.chips}>
        <Chip label="Latest" on={!byTitle} onPress={() => setByTitle(false)} />
        <Chip label="By title" on={byTitle} onPress={() => setByTitle(true)} />
      </View>
      {chats.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
      {refused ? <Text style={[styles.note, { color: palette.textMuted }]}>This server doesn’t let admins see users’ chats (its ENABLE_ADMIN_CHAT_ACCESS setting).</Text> : null}
      {chats.isError && !refused ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn’t load the chats: ${describeError(chats.error)}`}</Text> : null}
      {chats.data && !items.length ? <Text style={[styles.note, { color: palette.textMuted }]}>{words ? 'Nothing matches.' : `${name} has no chats.`}</Text> : null}
    </View>
  );

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <BackHeader title={`${name}’s Chats`} fallback="/admin" />
      <FlashList
        data={items}
        keyExtractor={(chat) => chat.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (chats.hasNextPage && !chats.isFetchingNextPage) void chats.fetchNextPage();
        }}
        ListFooterComponent={chats.isFetchingNextPage ? <ActivityIndicator style={styles.more} color={palette.textMuted} /> : null}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Opens it to read"
            onPress={() => router.push({ pathname: '/s/[id]', params: { id: item.id } })}
            style={({ pressed }) => [styles.row, { borderColor: palette.border, backgroundColor: pressed ? palette.surface : 'transparent' }]}>
            <View style={styles.text}>
              <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
                {item.title || 'Untitled'}
              </Text>
              {item.updatedAt ? <Text style={[styles.meta, { color: palette.textFaint }]}>{when(item.updatedAt)}</Text> : null}
            </View>
            <MenuButton label={`Options for ${item.title || 'this chat'}`} size={18} color={palette.textMuted} items={[{ key: 'delete', label: 'Delete…', icon: 'trash', destructive: true, onPress: () => remove(item) }]} />
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { paddingHorizontal: 16, paddingBottom: 48 },
  top: { gap: 10, paddingVertical: 12 },
  search: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.regular, fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 10, marginBottom: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  text: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.semibold, fontSize: 15 },
  meta: { fontFamily: fonts.regular, fontSize: 12 },
  more: { paddingVertical: 16 },
});
