import { overridePoint, type DtKnowledgePoint } from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { showPrompt } from '@/components/dialogs';
import { sessionDate, useDtPointReport } from '@/features/deeptutor/queries';
import { describeError } from '@/lib/errors';
import { Markdown } from '@/markdown/Markdown';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, usePalette } from '@/theme';

export const POINT_TYPES: Record<string, string> = { concept: 'Concept', memory: 'Memory', procedure: 'Procedure', design: 'Design' };

export function pointStatusLabel(point: Pick<DtKnowledgePoint, 'status' | 'masterySource'>): string {
  if (point.status === 'mastered') return point.masterySource === 'learner' ? 'Marked as known' : 'Mastered';
  return point.status === 'learning' ? 'In progress' : 'Not started';
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/**
 * A knowledge point up close: where it stands, the bar to pass, what you've answered, its next
 * review. If the tutor hasn't judged it mastered, you can say you already know it (and undo that).
 */
export function PointSheet({ pathId, point, onClose, onStudy }: { pathId: string; point: DtKnowledgePoint | null; onClose: () => void; onStudy?: (point: DtKnowledgePoint) => void }) {
  return (
    <Modal visible={point !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {point ? <PointBody pathId={pathId} point={point} onClose={onClose} onStudy={onStudy} /> : null}
    </Modal>
  );
}

function PointBody({ pathId, point, onClose, onStudy }: { pathId: string; point: DtKnowledgePoint; onClose: () => void; onStudy?: (point: DtKnowledgePoint) => void }) {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, session } = useDtAuthed();
  const report = useDtPointReport(pathId, point.id);
  const [busy, setBusy] = useState(false);
  const data = report.data;
  const qualitative = data?.gate === 'qualitative';

  const override = async (mastered: boolean, note = '') => {
    setBusy(true);
    try {
      await overridePoint(client, pathId, point.id, mastered, note);
      await queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'mastery'] });
      toast(mastered ? 'Marked as known' : "Back to the tutor's assessment", 'success');
    } catch (error) {
      toast(`Couldn't change it: ${describeError(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  const markKnown = () =>
    showPrompt(
      'I already know this',
      'The point counts as mastered and the path moves on. A note is optional.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Mark as Known', onPress: (note?: string) => void override(true, note?.trim() ?? '') },
      ],
      'plain-text',
    );

  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: palette.text }]} numberOfLines={2} accessibilityRole="header">
          {point.name}
        </Text>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
          <Text style={[styles.done, { color: palette.link }]}>Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.meta, { color: palette.textMuted }]}>{[POINT_TYPES[point.type] ?? point.type, pointStatusLabel(point)].join(' · ')}</Text>
        {report.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
        {report.isError ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn't load the details: ${describeError(report.error)}`}</Text> : null}
        {data ? (
          <>
            <View style={styles.block}>
              <Text style={[styles.label, { color: palette.textMuted }]}>{qualitative ? 'To pass: explain it in your own words' : `To pass: ${percent(data.threshold)}`}</Text>
              <View style={[styles.track, { backgroundColor: palette.surfaceStrong }]}>
                <View style={[styles.fill, { width: percent(qualitative ? (data.mastered ? 1 : 0) : Math.min(1, data.mastery)), backgroundColor: data.mastered ? palette.success : palette.link }]} />
              </View>
              {!qualitative ? <Text style={[styles.note, { color: palette.textMuted }]}>{`Now ${percent(data.mastery)}`}</Text> : null}
              {data.masterySource === 'learner' ? (
                <Text style={[styles.note, { color: palette.textMuted }]}>{`You marked this as known${data.overrideNote ? `: "${data.overrideNote}"` : '.'} Your answers still count as before.`}</Text>
              ) : null}
            </View>

            {data.review ? (
              <View style={styles.block}>
                <Text style={[styles.label, { color: palette.textMuted }]}>Next review</Text>
                <Text style={[styles.value, { color: palette.text }]}>{data.review.dueAt ? sessionDate(data.review.dueAt) : 'Not scheduled'}</Text>
                <Text style={[styles.note, { color: palette.textMuted }]}>
                  {[`Memory ${percent(data.review.retrievability)}`, `risk of forgetting ${percent(data.review.risk)}`, data.review.lapses ? `${data.review.lapses} lapses` : ''].filter(Boolean).join(' · ')}
                </Text>
                {data.review.reason ? <Text style={[styles.note, { color: palette.textMuted }]}>{data.review.reason}</Text> : null}
              </View>
            ) : null}

            {data.explanation ? (
              <View style={styles.block}>
                <Text style={[styles.label, { color: palette.textMuted }]}>Your explanation</Text>
                <Markdown text={data.explanation} />
              </View>
            ) : null}

            <View style={styles.block}>
              <Text style={[styles.label, { color: palette.textMuted }]}>
                {data.attempts.length ? `Answers · ${data.attempts.filter((attempt) => attempt.correct).length} of ${data.attempts.length} right` : 'Answers'}
              </Text>
              {data.attempts.length === 0 ? <Text style={[styles.note, { color: palette.textMuted }]}>None yet.</Text> : null}
              {data.attempts.slice(0, 20).map((attempt, index) => (
                <View key={`${attempt.at}-${index}`} style={[styles.attempt, { borderColor: palette.border }]}>
                  <Icon name={attempt.correct ? 'check' : 'x-mark'} size={16} color={attempt.correct ? palette.success : palette.danger} strokeWidth={2} />
                  <View style={styles.attemptText}>
                    {attempt.prompt ? (
                      <Text style={[styles.value, { color: palette.text }]} numberOfLines={3}>
                        {attempt.prompt}
                      </Text>
                    ) : null}
                    {attempt.answer ? <Text style={[styles.note, { color: palette.textMuted }]}>{`You said: ${attempt.answer}`}</Text> : null}
                    {attempt.at ? <Text style={[styles.meta, { color: palette.textFaint }]}>{sessionDate(attempt.at)}</Text> : null}
                  </View>
                </View>
              ))}
            </View>

            {!data.assessedMastered ? (
              <View style={styles.block}>
                {data.masterySource === 'learner' ? (
                  <Button label="Back to the Tutor's Assessment" variant="secondary" loading={busy} onPress={() => void override(false)} />
                ) : (
                  <Button label="I Already Know This" variant="secondary" loading={busy} onPress={markKnown} />
                )}
              </View>
            ) : null}
            {onStudy && point.status !== 'mastered' ? <Button label="Study This With the Tutor" onPress={() => onStudy(point)} /> : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8 },
  title: { flex: 1, fontFamily: fonts.semibold, fontSize: 18 },
  done: { fontFamily: fonts.semibold, fontSize: 16 },
  content: { paddingHorizontal: 20, paddingBottom: 40, gap: 16 },
  meta: { fontFamily: fonts.regular, fontSize: 13 },
  block: { gap: 6 },
  label: { fontFamily: fonts.medium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  value: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  attempt: { flexDirection: 'row', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  attemptText: { flex: 1, gap: 2 },
});
