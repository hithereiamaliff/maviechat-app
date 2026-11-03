import { isArchived, listSessions, sessionTitle, type DtSessionSummary } from '@maviechat/deeptutor-protocol';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { sessionDate } from '@/features/deeptutor/queries';
import { useDtChatActions } from '@/features/deeptutor/useDtChatActions';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

const PAGE_SIZE = 200;
/** Enough for any one person's history; DeepTutor has no archived-only list to page through. */
const MAX_PAGES = 10;

/** Archived Chats in DeepTutor's Settings, like Open WebUI's tab: search, open, restore or delete each, or restore all. */
export function DtArchivedChats() {
  const palette = usePalette();
  const { client, session } = useDtAuthed();
  const actions = useDtChatActions();
  const [search, setSearch] = useState('');
  const list = useQuery({
    queryKey: [DT_QUERY_ROOT, session.baseUrl, 'sessions', 'archived'],
    queryFn: async (): Promise<DtSessionSummary[]> => {
      const archived: DtSessionSummary[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const rows = await listSessions(client, { limit: PAGE_SIZE, offset: page * PAGE_SIZE });
        archived.push(...rows.filter(isArchived));
        if (rows.length < PAGE_SIZE) break;
      }
      return archived;
    },
  });
  const query = search.trim().toLowerCase();
  const chats = useMemo(() => (list.data ?? []).filter((chat) => !query || sessionTitle(chat).toLowerCase().includes(query)), [list.data, query]);

  const open = (chat: DtSessionSummary) => {
    router.dismissAll();
    router.replace({ pathname: '/learn/[id]', params: { id: chat.id } });
  };
  const restoreAll = () =>
    Alert.alert('Restore all archived chats?', 'They go back to your chats in the sidebar.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Restore All', onPress: () => (list.data ?? []).forEach((chat) => actions.setArchived(chat.id, false)) },
    ]);

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
        {(list.data?.length ?? 0) > 0 && !query ? (
          <Pressable accessibilityRole="button" onPress={restoreAll} hitSlop={6}>
            <Text style={[styles.all, { color: palette.link }]}>Restore All</Text>
          </Pressable>
        ) : null}
      </View>
      <FlashList
        data={chats}
        keyExtractor={(chat) => chat.id}
        keyboardShouldPersistTaps="handled"
        refreshing={false}
        onRefresh={() => void list.refetch()}
        ListEmptyComponent={
          list.isLoading ? (
            <ActivityIndicator style={styles.loading} color={palette.textMuted} />
          ) : (
            <Text style={[styles.empty, { color: palette.textMuted }]}>
              {list.isError ? "Couldn't load archived chats." : query ? 'No archived chats match.' : 'You have no archived DeepTutor chats. Archive one from its menu to tidy the sidebar.'}
            </Text>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Opens the chat"
            onPress={() => open(item)}
            style={({ pressed }) => [styles.row, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
            <View style={styles.rowText}>
              <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
                {sessionTitle(item)}
              </Text>
              <Text style={[styles.date, { color: palette.textFaint }]}>{sessionDate(item.updated_at ?? item.created_at)}</Text>
            </View>
            <IconButton icon="archive-box-arrow-down" label="Restore Chat" size={19} color={palette.textMuted} onPress={() => actions.setArchived(item.id, false)} />
            <IconButton icon="trash" label="Delete Chat" size={19} color={palette.textMuted} onPress={() => actions.remove(item.id)} />
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
  all: { fontFamily: fonts.medium, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: 16, paddingRight: 8, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.medium, fontSize: 15 },
  date: { fontFamily: fonts.regular, fontSize: 12 },
  loading: { marginVertical: 20 },
  empty: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 32, paddingHorizontal: 24 },
});
