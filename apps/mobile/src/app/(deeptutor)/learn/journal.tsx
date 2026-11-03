import { journalIsEmpty } from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { sessionDate, useDtLearningJournal } from '@/features/deeptutor/queries';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

/**
 * The Learning Journal: what DeepTutor keeps about your learning between chats (your goal,
 * where the last session left off, what you've learned). DeepTutor writes it; here you read it.
 */
export default function LearningJournal() {
  const palette = usePalette();
  const queryClient = useQueryClient();
  const { session } = useDtAuthed();
  const journal = useDtLearningJournal();
  const data = journal.data;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'learning-journal'] });

  const field = (label: string, value: string) =>
    value ? (
      <View style={styles.field}>
        <Text style={[styles.label, { color: palette.textMuted }]}>{label}</Text>
        <Text style={[styles.value, { color: palette.text }]}>{value}</Text>
      </View>
    ) : null;

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="Learning Journal" />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}>
        {journal.isLoading ? (
          <ActivityIndicator style={styles.loading} color={palette.textMuted} />
        ) : journal.isError ? (
          <Text style={[styles.note, { color: palette.danger }]}>{`Couldn't load the journal: ${describeError(journal.error)}`}</Text>
        ) : !data || journalIsEmpty(data) ? (
          <View style={[styles.card, { borderColor: palette.border }]}>
            <Text style={[styles.cardTitle, { color: palette.text }]}>Nothing here yet</Text>
            <Text style={[styles.note, { color: palette.textMuted }]}>
              DeepTutor writes here as you learn with it: your goal and why, where you left off, and what you have learned. Tell it in a chat what you are working towards, and it starts the journal.
            </Text>
          </View>
        ) : (
          <>
            {data.mission.topic || data.mission.why || data.mission.level ? (
              <View style={[styles.card, { borderColor: palette.border }]}>
                <Text style={[styles.cardTitle, { color: palette.text }]}>Your goal</Text>
                {field('Topic', data.mission.topic)}
                {field('Why', data.mission.why)}
                {field('Level', data.mission.level)}
              </View>
            ) : null}
            {data.last_session.summary || data.last_session.next_focus ? (
              <View style={[styles.card, { borderColor: palette.border }]}>
                <Text style={[styles.cardTitle, { color: palette.text }]}>Last time</Text>
                {field('Where you left off', data.last_session.summary)}
                {field('Next', data.last_session.next_focus)}
                {data.last_session.updated_at ? <Text style={[styles.meta, { color: palette.textFaint }]}>{sessionDate(data.last_session.updated_at)}</Text> : null}
              </View>
            ) : null}
            {data.records.length > 0 ? (
              <View style={styles.records}>
                <Text style={[styles.section, { color: palette.textMuted }]}>What you have learned</Text>
                {data.records.map((record, index) => (
                  <View key={record.id || index} style={[styles.record, { backgroundColor: palette.surface }]}>
                    <Text style={[styles.recordTitle, { color: palette.text }]}>{record.title}</Text>
                    {record.insight ? <Text style={[styles.value, { color: palette.text }]}>{record.insight}</Text> : null}
                    {record.created_at ? <Text style={[styles.meta, { color: palette.textFaint }]}>{sessionDate(record.created_at)}</Text> : null}
                  </View>
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 48 },
  loading: { marginTop: 24 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: 14, gap: 10 },
  cardTitle: { fontFamily: fonts.semibold, fontSize: 16 },
  field: { gap: 2 },
  label: { fontFamily: fonts.medium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  value: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  records: { gap: 8 },
  section: { fontFamily: fonts.medium, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 4 },
  record: { borderRadius: radius.md, padding: 12, gap: 4 },
  recordTitle: { fontFamily: fonts.semibold, fontSize: 15 },
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  meta: { fontFamily: fonts.regular, fontSize: 12 },
});
