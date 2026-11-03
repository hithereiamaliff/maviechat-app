import { masteryTitle, openingMessage } from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { useStartPathChat } from '@/features/deeptutor/learning/pathChat';
import { sessionDate, useDtMasteryTopics } from '@/features/deeptutor/queries';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

/** Your mastery paths, the newest first, with any reviews that are due. */
export default function MasteryPaths() {
  const palette = usePalette();
  const queryClient = useQueryClient();
  const { session } = useDtAuthed();
  const topics = useDtMasteryTopics();
  const startChat = useStartPathChat();
  const list = topics.data ?? [];
  const withDue = list.filter((topic) => topic.reviews.some((review) => review.due));
  const dueCount = withDue.reduce((sum, topic) => sum + topic.reviews.filter((review) => review.due).length, 0);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'mastery'] });
  const first = withDue[0];

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="Mastery Path" accessory={<IconButton icon="plus" label="New Path" onPress={() => router.push('/learn/mastery/new')} />} />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}>
        {first ? (
          <View style={[styles.banner, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <Text style={[styles.bannerText, { color: palette.text }]}>{`${dueCount} ${dueCount === 1 ? 'review is' : 'reviews are'} due across ${withDue.length} ${withDue.length === 1 ? 'path' : 'paths'}.`}</Text>
            <Button
              label={`Start Review: ${masteryTitle(first)}`}
              variant="secondary"
              onPress={() =>
                void startChat(
                  first.pathId,
                  'review',
                  openingMessage(
                    'review',
                    first.reviews.filter((review) => review.due).map((review) => review.pointName),
                  ),
                )
              }
            />
          </View>
        ) : null}
        {topics.isLoading ? <ActivityIndicator style={styles.loading} color={palette.textMuted} /> : null}
        {topics.isError ? (
          <Pressable accessibilityRole="button" onPress={refresh}>
            <Text style={[styles.note, { color: palette.danger }]}>{`Couldn't load your paths: ${describeError(topics.error)}. Tap to try again.`}</Text>
          </Pressable>
        ) : null}
        {!topics.isLoading && !topics.isError && list.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: palette.text }]}>No paths yet</Text>
            <Text style={[styles.note, { color: palette.textMuted }]}>Say what you want to master. You and the tutor agree an outline, and it becomes a map to work through.</Text>
            <Button label="New Path" onPress={() => router.push('/learn/mastery/new')} />
          </View>
        ) : null}
        {list.map((topic) => (
          <Pressable
            key={topic.pathId}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/learn/mastery/[id]', params: { id: topic.pathId } })}
            style={({ pressed }) => [styles.card, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
            <View style={styles.cardTop}>
              <Text style={styles.emoji}>{topic.emoji}</Text>
              <View style={styles.cardText}>
                <Text style={[styles.title, { color: palette.text }]} numberOfLines={2}>
                  {masteryTitle(topic)}
                </Text>
                {topic.description || topic.goal ? (
                  <Text style={[styles.subtitle, { color: palette.textMuted }]} numberOfLines={2}>
                    {topic.description || topic.goal}
                  </Text>
                ) : null}
              </View>
              {topic.complete ? <Icon name="check" size={18} color={palette.success} strokeWidth={2} /> : null}
            </View>
            {topic.counts.total ? (
              <View style={[styles.track, { backgroundColor: palette.surfaceStrong }]}>
                <View style={[styles.fill, { width: `${Math.round((topic.counts.mastered / topic.counts.total) * 100)}%`, backgroundColor: palette.success }]} />
              </View>
            ) : null}
            <Text style={[styles.meta, { color: palette.textFaint }]}>
              {[
                topic.counts.total ? `${topic.counts.mastered}/${topic.counts.total} points` : 'No outline yet',
                topic.modules.length ? `${topic.modules.length} ${topic.modules.length === 1 ? 'module' : 'modules'}` : '',
                `${topic.sessionCount} ${topic.sessionCount === 1 ? 'chat' : 'chats'}`,
                sessionDate(topic.updatedAt),
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  loading: { marginTop: 32 },
  banner: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: 14, gap: 10 },
  bannerText: { fontFamily: fonts.medium, fontSize: 15 },
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  empty: { gap: 10, marginTop: 24 },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 18 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: 14, gap: 8 },
  cardTop: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  emoji: { fontSize: 24 },
  cardText: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.semibold, fontSize: 16 },
  subtitle: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  track: { height: 5, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 5, borderRadius: 3 },
  meta: { fontFamily: fonts.regular, fontSize: 12 },
});
