import { isArchived, learningPath, listSessions, masteryOfPreferences, searchSessions, searchSnippet, sessionTitle, type DtSessionSummary } from '@maviechat/deeptutor-protocol';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { MenuButton } from '@/components/Menu';
import { capabilityName } from '@/features/deeptutor/chat/capabilities';
import { startChatWith } from '@/features/deeptutor/chat/extras';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { filterHistory, isTutorThread, type HistoryKind, type HistoryStatus } from '@/features/deeptutor/history';
import { sessionDate } from '@/features/deeptutor/queries';
import { useDtChatActions } from '@/features/deeptutor/useDtChatActions';
import { describeError } from '@/lib/errors';
import { useDebounced } from '@/lib/useDebounced';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, usePalette } from '@/theme';

const PAGE_SIZE = 100;

const STATUSES: { key: HistoryStatus; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'archived', label: 'Archived' },
  { key: 'all', label: 'Active and Archived' },
];
const KINDS: { key: HistoryKind; label: string }[] = [
  { key: 'all', label: 'All Chats' },
  { key: 'main', label: 'Main Chats' },
  { key: 'threads', label: 'Tutor Threads' },
];

/**
 * Chat History: every DeepTutor chat, learning and side chats included, searched by title and
 * message text (with the words that matched), and filtered as on DeepTutor's own page.
 */
export default function ChatHistory() {
  const palette = usePalette();
  const queryClient = useQueryClient();
  const { client, session } = useDtAuthed();
  const actions = useDtChatActions();
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim(), 300);
  const [status, setStatus] = useState<HistoryStatus>('active');
  const [kind, setKind] = useState<HistoryKind>('all');

  const all = useInfiniteQuery({
    queryKey: [DT_QUERY_ROOT, session.baseUrl, 'sessions', 'history'],
    queryFn: ({ pageParam }) => listSessions(client, { limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length >= PAGE_SIZE ? pages.length * PAGE_SIZE : undefined),
    enabled: !query,
  });
  const found = useQuery({
    queryKey: [DT_QUERY_ROOT, session.baseUrl, 'sessions', 'history-search', query],
    queryFn: async () => (await searchSessions(client, query, { limit: 100 })).sessions,
    enabled: Boolean(query),
  });
  const source = query ? (found.data ?? []) : (all.data?.pages.flat() ?? []);
  const shown = filterHistory(source, status, kind);
  const loading = query ? found.isLoading : all.isLoading;
  const failure = query ? found.error : all.error;

  const open = (item: DtSessionSummary) => {
    const path = masteryOfPreferences(item.preferences as Record<string, unknown> | undefined) ? null : learningPath(item);
    if (path) router.replace({ pathname: '/learn/web', params: { path, title: sessionTitle(item) } });
    else router.replace({ pathname: '/learn/[id]', params: { id: item.id } });
  };

  const chip = (selected: boolean, label: string, onPress: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, { borderColor: palette.border, backgroundColor: selected ? palette.surfaceStrong : palette.background }]}>
      <Text style={[styles.chipText, { color: palette.text }]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="Chat History" />
      <View style={styles.bar}>
        <View style={[styles.search, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Icon name="magnifying-glass" size={16} color={palette.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search titles and messages"
            placeholderTextColor={palette.textFaint}
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.searchInput, { color: palette.text }]}
          />
          {search ? <IconButton icon="x-mark" label="Clear search" size={16} color={palette.textMuted} onPress={() => setSearch('')} /> : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
          {STATUSES.map((item) => chip(item.key === status, item.label, () => setStatus(item.key)))}
          <View style={[styles.divider, { backgroundColor: palette.border }]} />
          {KINDS.map((item) => chip(item.key === kind, item.label, () => setKind(item.key)))}
        </ScrollView>
      </View>
      <FlashList
        data={shown}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        refreshing={false}
        onRefresh={() => void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'sessions'] })}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (!query && all.hasNextPage && !all.isFetchingNextPage) void all.fetchNextPage();
        }}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={styles.loading} color={palette.textMuted} />
          ) : (
            <Text style={[styles.empty, { color: palette.textMuted }]}>
              {failure ? `Couldn't load your chats: ${describeError(failure)}` : query ? 'No chats match.' : 'No chats here.'}
            </Text>
          )
        }
        ListFooterComponent={all.isFetchingNextPage ? <ActivityIndicator style={styles.loading} color={palette.textMuted} /> : null}
        renderItem={({ item }) => {
          const title = sessionTitle(item);
          const archived = isArchived(item);
          const preview = query ? searchSnippet(item, query) : typeof item.last_message === 'string' ? item.last_message.replace(/\s+/g, ' ').trim() : '';
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityHint="Opens the chat"
              onPress={() => open(item)}
              style={({ pressed }) => [styles.row, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
              <View style={styles.rowText}>
                <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
                  {title}
                </Text>
                {preview ? (
                  <Text style={[styles.preview, { color: palette.textMuted }]} numberOfLines={2}>
                    {preview}
                  </Text>
                ) : null}
                <Text style={[styles.meta, { color: palette.textFaint }]} numberOfLines={1}>
                  {[
                    item.capability && item.capability !== 'chat' ? capabilityName(item.capability) : null,
                    isTutorThread(item) ? 'Tutor thread' : null,
                    learningPath(item) ? 'Learning' : null,
                    archived ? 'Archived' : null,
                    sessionDate(item.updated_at ?? item.created_at),
                    typeof item.message_count === 'number' ? `${item.message_count} messages` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <MenuButton
                label={`Options for ${title}`}
                size={18}
                color={palette.textMuted}
                items={[
                  {
                    key: 'refer',
                    label: 'Use in a New Chat',
                    icon: 'chat-bubble-left',
                    onPress: () => {
                      startChatWith({ chat: { id: item.id, title } });
                      router.replace('/learn');
                    },
                  },
                  archived
                    ? { key: 'restore', label: 'Restore', icon: 'archive-box-arrow-down', onPress: () => actions.setArchived(item.id, false) }
                    : { key: 'archive', label: 'Archive', icon: 'archive-box', onPress: () => actions.setArchived(item.id, true) },
                  { key: 'delete', label: 'Delete', icon: 'trash', destructive: true, onPress: () => actions.remove(item.id) },
                ]}
              />
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 6, gap: 8 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingLeft: 10, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 0 },
  chips: { gap: 8, alignItems: 'center' },
  chip: { height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  chipText: { fontFamily: fonts.medium, fontSize: 13 },
  divider: { width: StyleSheet.hairlineWidth, height: 20, marginHorizontal: 2 },
  loading: { marginVertical: 24 },
  empty: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 32, paddingHorizontal: 32 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 16, paddingRight: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, gap: 3 },
  title: { fontFamily: fonts.medium, fontSize: 15 },
  preview: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  meta: { fontFamily: fonts.regular, fontSize: 12 },
});
