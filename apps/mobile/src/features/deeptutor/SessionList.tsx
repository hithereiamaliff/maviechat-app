import type { DtSessionSummary } from '@maviechat/deeptutor-protocol';
import { FlashList } from '@shopify/flash-list';
import { useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { useDebounced } from '@/lib/useDebounced';
import { fonts, radius, usePalette } from '@/theme';
import { sessionDate, useDtSessions } from './queries';

interface SessionListProps {
  onOpen: (session: DtSessionSummary) => void;
  /** Read out by VoiceOver for each row. */
  rowHint: string;
  /** Shown when there are no sessions at all. */
  empty: string;
  header?: ReactElement;
}

/** Your DeepTutor sessions with a search field (title and message text). */
export function SessionList({ onOpen, rowHint, empty, header }: SessionListProps) {
  const palette = usePalette();
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim(), 300);
  const sessions = useDtSessions(query);

  return (
    <View style={styles.wrap}>
      {header}
      <View style={[styles.search, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Icon name="magnifying-glass" size={16} color={palette.textMuted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search DeepTutor chats"
          placeholderTextColor={palette.textFaint}
          autoCorrect={false}
          returnKeyType="search"
          style={[styles.searchInput, { color: palette.text }]}
        />
        {search ? <IconButton icon="x-mark" label="Clear search" size={16} color={palette.textMuted} onPress={() => setSearch('')} /> : null}
      </View>
      <FlashList
        data={sessions.data ?? []}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        refreshing={false}
        onRefresh={() => void sessions.refetch()}
        ListEmptyComponent={
          sessions.isLoading ? (
            <ActivityIndicator style={styles.loading} color={palette.textMuted} />
          ) : (
            <Text style={[styles.empty, { color: palette.textMuted }]}>
              {sessions.isError ? "Couldn't load your DeepTutor chats." : query ? 'No DeepTutor chats match.' : empty}
            </Text>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityHint={rowHint}
            onPress={() => onOpen(item)}
            style={({ pressed }) => [styles.row, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
            <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
              {item.title || 'Untitled chat'}
            </Text>
            <Text style={[styles.meta, { color: palette.textFaint }]}>
              {[sessionDate(item.updated_at ?? item.created_at), typeof item.message_count === 'number' ? `${item.message_count} messages` : null]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    marginHorizontal: 16,
    marginVertical: 8,
    paddingLeft: 10,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 0 },
  loading: { marginVertical: 24 },
  empty: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 32, paddingHorizontal: 32 },
  row: { paddingHorizontal: 16, paddingVertical: 11, gap: 3, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontFamily: fonts.medium, fontSize: 15 },
  meta: { fontFamily: fonts.regular, fontSize: 12 },
});
