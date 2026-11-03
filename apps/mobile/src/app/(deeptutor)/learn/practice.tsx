import { getPracticeQuestion, getPracticeQueue } from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { PracticeCard } from '@/features/deeptutor/practice/PracticeCard';
import { afterReview, afterSkip, dueLabel, roundFinished, startRound, type PracticeRound } from '@/features/deeptutor/practice/round';
import { deviceTimeZone, useDtPracticeSummary, useDtQuestionCategories } from '@/features/deeptutor/queries';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

/**
 * Practice, DeepTutor's review of the questions saved from your quizzes: what's due today, then
 * a round of them one by one. `?entry=<id>` practises a single question from the question bank.
 */
export default function Practice() {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, session } = useDtAuthed();
  const params = useLocalSearchParams<{ entry?: string }>();
  const summary = useDtPracticeSummary();
  const categories = useDtQuestionCategories();
  const [categoryId, setCategoryId] = useState<number | undefined>(undefined);
  const [round, setRound] = useState<PracticeRound | null>(null);
  const [starting, setStarting] = useState(false);
  const single = typeof params.entry === 'string' && /^\d+$/.test(params.entry) ? Number(params.entry) : null;

  const refresh = () => void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'practice'] });

  const start = async () => {
    setStarting(true);
    try {
      const items = await getPracticeQueue(client, deviceTimeZone(), { categoryId, limit: 20 });
      if (items.length === 0) toast('Nothing is due right now.');
      else setRound(startRound(items));
    } catch (error) {
      toast(`Couldn't start practice: ${describeError(error)}`, 'error');
    } finally {
      setStarting(false);
    }
  };

  // From the question bank: that one question, due or not.
  useEffect(() => {
    if (single === null) return;
    let active = true;
    getPracticeQuestion(client, single).then(
      (item) => active && setRound(startRound([item])),
      (error: unknown) => active && toast(`Couldn't open the question: ${describeError(error)}`, 'error'),
    );
    return () => {
      active = false;
    };
  }, [client, single, toast]);

  const finish = () => {
    setRound(null);
    refresh();
    if (single !== null) router.setParams({ entry: undefined });
  };

  const current = round && !roundFinished(round) ? round.items[round.index] : null;
  const data = summary.data;
  const next = dueLabel(data?.next_due_at);

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="Practice" />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={round ? undefined : <RefreshControl refreshing={false} onRefresh={refresh} />}>
        {round && current ? (
          <>
            <PracticeCard
              key={`${round.index}-${current.entry.id}`}
              item={current}
              position={`${round.index + 1} of ${round.items.length}`}
              onReviewed={(rating, outcome) => setRound((value) => (value ? afterReview(value, rating, outcome) : value))}
              onSkip={() => setRound((value) => (value ? afterSkip(value) : value))}
            />
            <Pressable accessibilityRole="button" onPress={finish} hitSlop={8} style={styles.center}>
              <Text style={[styles.link, { color: palette.textMuted }]}>End Round</Text>
            </Pressable>
          </>
        ) : round ? (
          <View style={[styles.done, { borderColor: palette.border }]}>
            <Icon name="check" size={28} color={palette.success} strokeWidth={2} />
            <Text style={[styles.doneTitle, { color: palette.text }]}>Round complete</Text>
            <Text style={[styles.note, { color: palette.textMuted }]}>
              {round.reviewed === 1 ? '1 review saved.' : `${round.reviewed} reviews saved.`}
              {round.again > 0 ? ` ${round.again} needed another go; they come back first next time.` : ''}
            </Text>
            <Button label="Done" onPress={finish} />
          </View>
        ) : single !== null ? (
          <ActivityIndicator style={styles.loading} color={palette.textMuted} />
        ) : (
          <>
            <View style={styles.stats}>
              <Stat label="Due now" value={data?.due} accent />
              <Stat label="Mistakes" value={data?.mistakes} />
              <Stat label="In your bank" value={data?.total} />
              <Stat label="Reviewed today" value={data?.reviewed_today} />
            </View>
            {summary.isError ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn't load practice: ${describeError(summary.error)}`}</Text> : null}
            {categories.data && categories.data.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {[{ id: undefined, name: 'All' }, ...categories.data].map((category) => {
                  const selected = category.id === categoryId;
                  return (
                    <Pressable
                      key={category.id ?? 'all'}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => setCategoryId(category.id)}
                      style={[styles.chip, { borderColor: palette.border, backgroundColor: selected ? palette.surfaceStrong : palette.background }]}>
                      <Text style={[styles.chipText, { color: palette.text }]}>{category.name}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}
            {summary.isLoading ? (
              <ActivityIndicator style={styles.loading} color={palette.textMuted} />
            ) : data && data.due > 0 ? (
              <Button label={`Start Review (${data.due})`} onPress={() => void start()} loading={starting} />
            ) : (
              <View style={[styles.empty, { borderColor: palette.border }]}>
                <Text style={[styles.emptyTitle, { color: palette.text }]}>Nothing due</Text>
                <Text style={[styles.note, { color: palette.textMuted }]}>
                  {data && data.total > 0
                    ? `You're up to date.${next ? ` Next review: ${next}.` : ''}`
                    : 'Questions you answer in Quiz mode (Submit Answers) are saved here and come back for review: the ones you got wrong the next day, the rest a few days later.'}
                </Text>
                <Button
                  label="Make a Quiz"
                  variant="secondary"
                  onPress={() => router.replace({ pathname: '/learn', params: { mode: 'deep_question' } })}
                />
              </View>
            )}
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace('/learn/questions')}
              style={({ pressed }) => [styles.bank, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
              <Icon name="question-mark-circle" size={20} color={palette.textMuted} />
              <View style={styles.bankText}>
                <Text style={[styles.bankTitle, { color: palette.text }]}>Question Bank</Text>
                <Text style={[styles.note, { color: palette.textMuted }]}>Every saved question, with your answers</Text>
              </View>
              <Icon name="chevron-right" size={16} color={palette.textFaint} strokeWidth={2} />
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: number | undefined; accent?: boolean }) {
  const palette = usePalette();
  return (
    <View style={[styles.stat, { borderColor: palette.border, backgroundColor: accent ? palette.surface : palette.background }]}>
      <Text style={[styles.statValue, { color: palette.text }]}>{value ?? '–'}</Text>
      <Text style={[styles.statLabel, { color: palette.textMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { flexBasis: '47%', flexGrow: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: 14, gap: 2 },
  statValue: { fontFamily: fonts.semibold, fontSize: 24 },
  statLabel: { fontFamily: fonts.regular, fontSize: 13 },
  chips: { gap: 8 },
  chip: { height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  chipText: { fontFamily: fonts.medium, fontSize: 13 },
  empty: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: 16, gap: 10 },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 16 },
  bank: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: 14 },
  bankText: { flex: 1, gap: 2 },
  bankTitle: { fontFamily: fonts.medium, fontSize: 15 },
  done: { alignItems: 'center', gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.xl, padding: 24 },
  doneTitle: { fontFamily: fonts.semibold, fontSize: 18 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  link: { fontFamily: fonts.medium, fontSize: 15 },
  center: { alignSelf: 'center' },
  loading: { marginTop: 24 },
});
