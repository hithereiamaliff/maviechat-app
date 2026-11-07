import { matchesLearningFilter, type DtLearningActivity, type DtLearningKind } from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { SideScroll } from '@/components/SideScroll';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { KIND_ICONS, KIND_LABELS, LEARNING_WAYS, openActivity, startWay, waysFor } from '@/features/deeptutor/learning/ways';
import { sessionDate, useDtAuthStatus, useDtLearningIndex, useDtModules } from '@/features/deeptutor/queries';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

const PAGE = 24;
const FILTERS: { key: DtLearningKind | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  ...LEARNING_WAYS.map((way) => ({ key: way.kind, label: way.label })),
];

/**
 * All Learning, as DeepTutor's hub: what needs your attention (reviews due, books paused or still
 * being written), then every learning activity, newest first, to filter by kind or search.
 * Mastery paths, books, reading collections and practice open here; videos saved before
 * DeepTutor moved them into Reading open its own page, which moves them.
 */
export default function AllLearning() {
  const palette = usePalette();
  const queryClient = useQueryClient();
  const { session } = useDtAuthed();
  const index = useDtLearningIndex();
  const modules = useDtModules();
  const status = useDtAuthStatus();
  const [filter, setFilter] = useState<DtLearningKind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const data = index.data;
  const ways = waysFor(modules.data, status.data);
  const shownFilters = FILTERS.filter((item) => item.key === 'all' || ways.some((way) => way.kind === item.key));
  const activities = (data?.activities ?? []).filter((item) => matchesLearningFilter(item, filter, query));
  const refresh = () => void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'learning-index'] });
  const attention = (data?.reviewsDue.length ?? 0) + (data?.booksInProgress.length ?? 0);

  const row = (activity: DtLearningActivity) => (
    <Pressable
      key={activity.key}
      accessibilityRole="button"
      onPress={() => openActivity(activity)}
      style={({ pressed }) => [styles.row, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
      <View style={[styles.tile, { backgroundColor: palette.surface }]}>
        <Icon name={KIND_ICONS[activity.kind]} size={18} color={palette.text} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.title, { color: palette.text }]} numberOfLines={2}>
          {activity.title || 'Untitled'}
        </Text>
        <Text style={[styles.meta, { color: palette.textFaint }]}>{[KIND_LABELS[activity.kind], sessionDate(activity.updatedAt)].filter(Boolean).join(' · ')}</Text>
        {activity.progress !== undefined ? (
          <View style={[styles.track, { backgroundColor: palette.surfaceStrong }]} accessibilityLabel={`${Math.round(activity.progress * 100)}% done`}>
            <View style={[styles.fill, { backgroundColor: palette.success, width: `${Math.round(activity.progress * 100)}%` }]} />
          </View>
        ) : null}
      </View>
      <Icon name="chevron-right" size={16} color={palette.textFaint} />
    </Pressable>
  );

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="All Learning" accessory={ways.length ? <IconButton icon="plus" label="New Learning Activity" onPress={() => router.push('/learn/learning/new')} /> : undefined} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}>
        <SideScroll showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
          {shownFilters.map((item) => {
            const on = item.key === filter;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  setFilter(item.key);
                  setLimit(PAGE);
                }}
                style={[styles.chip, { borderColor: palette.border }, on && { backgroundColor: palette.active, borderColor: palette.active }]}>
                <Text style={[styles.chipText, { color: on ? palette.onActive : palette.textMuted }]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </SideScroll>
        <View style={[styles.search, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Icon name="magnifying-glass" size={16} color={palette.textMuted} />
          <TextInput
            value={query}
            onChangeText={(value) => {
              setQuery(value);
              setLimit(PAGE);
            }}
            placeholder="Search learning"
            placeholderTextColor={palette.textFaint}
            autoCorrect={false}
            style={[styles.searchInput, { color: palette.text }]}
            accessibilityLabel="Search learning"
          />
        </View>

        {filter === 'mastery' || filter === 'books' || filter === 'reading' ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(filter === 'books' ? '/learn/books' : filter === 'reading' ? '/learn/reading' : '/learn/mastery')}
            style={styles.open}
            hitSlop={4}>
            <Text style={[styles.link, { color: palette.link }]}>{filter === 'books' ? 'Open Books' : filter === 'reading' ? 'Open Reading' : 'Open Mastery Path'}</Text>
            <Icon name="chevron-right" size={14} color={palette.link} />
          </Pressable>
        ) : null}

        {data && data.failed.length > 0 ? (
          <Pressable accessibilityRole="button" onPress={refresh} style={[styles.banner, { borderColor: palette.border }]}>
            <Text style={[styles.note, { color: palette.danger }]}>
              {`Some of your learning couldn't be loaded (${data.failed.map((kind) => KIND_LABELS[kind]).join(', ')}). Tap to try again.`}
            </Text>
          </Pressable>
        ) : null}

        {index.isLoading ? (
          <ActivityIndicator style={styles.loading} color={palette.textMuted} />
        ) : index.isError ? (
          <Pressable accessibilityRole="button" onPress={refresh}>
            <Text style={[styles.note, { color: palette.danger }]}>{`Couldn't load your learning: ${describeError(index.error)}. Tap to try again.`}</Text>
          </Pressable>
        ) : (
          <>
            {attention > 0 && filter === 'all' && !query ? (
              <View style={styles.section}>
                <Text style={[styles.heading, { color: palette.textMuted }]}>Needs your attention</Text>
                {data?.reviewsDue.map((item) => (
                  <Pressable
                    key={`review-${item.pathId}`}
                    accessibilityRole="button"
                    onPress={() => router.push({ pathname: '/learn/mastery/[id]', params: { id: item.pathId } })}
                    style={({ pressed }) => [styles.row, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
                    <View style={[styles.tile, { backgroundColor: palette.surface }]}>
                      <Icon name="map" size={18} color={palette.text} />
                    </View>
                    <View style={styles.rowText}>
                      <Text style={[styles.title, { color: palette.text }]} numberOfLines={2}>
                        {item.title || 'Mastery Path'}
                      </Text>
                      <Text style={[styles.meta, { color: palette.textMuted }]}>{`${item.points.length || 1} ${item.points.length === 1 ? 'review' : 'reviews'} due`}</Text>
                    </View>
                    <Icon name="chevron-right" size={16} color={palette.textFaint} />
                  </Pressable>
                ))}
                {data?.booksInProgress.map((book) => (
                  <Pressable
                    key={`book-${book.id}`}
                    accessibilityRole="button"
                    onPress={() => router.push({ pathname: '/learn/books/[id]', params: { id: book.id } })}
                    style={({ pressed }) => [styles.row, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
                    <View style={[styles.tile, { backgroundColor: palette.surface }]}>
                      <Icon name="book-open" size={18} color={palette.text} />
                    </View>
                    <View style={styles.rowText}>
                      <Text style={[styles.title, { color: palette.text }]} numberOfLines={2}>
                        {book.title || 'Book'}
                      </Text>
                      <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={2}>
                        {book.status === 'paused' ? `Paused${book.reason ? ` · ${book.reason}` : ''}` : 'Still being written'}
                      </Text>
                    </View>
                    <Icon name="chevron-right" size={16} color={palette.textFaint} />
                  </Pressable>
                ))}
              </View>
            ) : null}

            {activities.length > 0 ? (
              <View style={styles.section}>
                <Text style={[styles.heading, { color: palette.textMuted }]}>{filter === 'all' && !query ? 'Your learning' : 'Found'}</Text>
                {activities.slice(0, limit).map(row)}
                {activities.length > limit ? (
                  <Pressable accessibilityRole="button" onPress={() => setLimit((value) => value + PAGE)} style={styles.more}>
                    <Text style={[styles.link, { color: palette.link }]}>Show more</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (data?.activities.length ?? 0) > 0 ? (
              <Text style={[styles.empty, { color: palette.textMuted }]}>Nothing matches.</Text>
            ) : (
              <View style={styles.section}>
                <Text style={[styles.emptyTitle, { color: palette.text }]}>Your learning starts here</Text>
                <Text style={[styles.sectionNote, { color: palette.textMuted }]}>Pick a way to learn. Everything you start shows up on this page.</Text>
                {ways.map((way) => (
                  <Pressable
                    key={way.kind}
                    accessibilityRole="button"
                    onPress={() => startWay(way)}
                    style={({ pressed }) => [styles.row, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
                    <View style={[styles.tile, { backgroundColor: palette.surface }]}>
                      <Icon name={way.icon} size={18} color={palette.text} />
                    </View>
                    <View style={styles.rowText}>
                      <Text style={[styles.title, { color: palette.text }]}>{way.label}</Text>
                      <Text style={[styles.meta, { color: palette.textMuted }]}>{way.summary}</Text>
                    </View>
                    <Icon name="chevron-right" size={16} color={palette.textFaint} />
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: 40 },
  chips: { gap: 6, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  chip: { height: 32, justifyContent: 'center', paddingHorizontal: 13, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  chipText: { fontFamily: fonts.medium, fontSize: 13 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 0 },
  banner: { marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  loading: { marginTop: 40 },
  section: { paddingHorizontal: 16, paddingTop: 18, gap: 8 },
  heading: { fontFamily: fonts.medium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  tile: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 3 },
  title: { fontFamily: fonts.medium, fontSize: 15 },
  meta: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 4 },
  fill: { height: 4, borderRadius: 2 },
  more: { alignSelf: 'center', paddingVertical: 10 },
  open: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginHorizontal: 16, marginTop: 12 },
  link: { fontFamily: fonts.medium, fontSize: 15 },
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, paddingHorizontal: 16, paddingTop: 12 },
  sectionNote: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, marginBottom: 4 },
  empty: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: 32 },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 18 },
});
