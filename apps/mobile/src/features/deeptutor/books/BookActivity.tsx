import { bookActivity, pauseBook, resumeBook, type DtBookDetail, type DtBookLive } from '@maviechat/deeptutor-protocol';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';
import { BLOCK_TYPE_SINGULAR, bookErrorText, elapsed, FAILURE_CAUSES } from './labels';
import { useBookRefresh, useTicking } from './useBooks';

/** What the writing is doing now, in a line. */
export function writingLabel(detail: DtBookDetail, live: DtBookLive): string {
  const page = live.pages[live.latestPageId];
  const title = page?.title || detail.pages.find((item) => item.id === live.latestPageId)?.title || '';
  if (!page || !title) return 'Writing the chapters';
  if (page.planning) return `Planning “${title}”`;
  if (page.current && page.planned.length) return `Writing “${title}”: ${BLOCK_TYPE_SINGULAR[page.current] ?? page.current.replace(/_/g, ' ')} (${Math.min(page.done + 1, page.planned.length)} of ${page.planned.length})`;
  return `Writing “${title}”`;
}

/**
 * The writing's state above a book: under way (what, for how long, how many chapters are done,
 * Pause), paused (why, Resume) or stopped (Continue). Nothing when it's idle.
 */
export function BookActivity({ detail, live }: { detail: DtBookDetail; live: DtBookLive }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useDtAuthed();
  const refresh = useBookRefresh();
  const [busy, setBusy] = useState(false);
  const { book } = detail;
  const activity = bookActivity(detail, Object.keys(live.pages).length > 0);
  // A "first chapter only" book's run began when its outline was confirmed: no clock for it.
  const clock = activity.kind === 'writing' && activity.startedAt > 0 && !book.lazy;
  const now = useTicking(clock);
  if (activity.kind === 'idle') return null;

  const act = async (resume: boolean) => {
    setBusy(true);
    try {
      await (resume ? resumeBook(client, book) : pauseBook(client, book));
    } catch (error) {
      toast(`Couldn't ${resume ? 'resume' : 'pause'}: ${bookErrorText(error)}`, 'error');
    } finally {
      setBusy(false);
      refresh(book.id);
    }
  };

  const counts = activity.total ? `${activity.ready} of ${activity.total} chapters written` : '';
  const action =
    !book.canEdit ? null : activity.kind === 'writing' ? { label: 'Pause', resume: false } : activity.kind === 'paused' ? { label: 'Resume', resume: true } : { label: 'Continue', resume: true };

  return (
    <View style={[styles.strip, { borderColor: palette.border, backgroundColor: palette.surface }]}>
      <View style={styles.top}>
        {activity.kind === 'writing' ? <ActivityIndicator size="small" color={palette.textMuted} /> : <Icon name={activity.kind === 'paused' ? 'pause-circle' : 'exclamation-triangle'} size={18} color={palette.textMuted} />}
        <View style={styles.text}>
          <Text style={[styles.title, { color: palette.text }]} numberOfLines={2}>
            {activity.kind === 'writing' ? writingLabel(detail, live) : activity.kind === 'paused' ? 'Writing paused' : 'Writing stopped'}
          </Text>
          <Text style={[styles.detail, { color: palette.textMuted }]}>
            {activity.kind === 'writing'
              ? [counts, clock ? elapsed(activity.startedAt, now) : ''].filter(Boolean).join(' · ')
              : activity.kind === 'paused'
                ? book.pauseKind === 'provider'
                  ? `The model kept turning requests away, so DeepTutor paused.${book.pauseReason ? ` ${book.pauseReason}` : ''}`
                  : `Nothing more is written until you resume.${counts ? ` ${counts}.` : ''}`
                : `DeepTutor stopped before it finished, perhaps after a restart.${counts ? ` ${counts}.` : ''}`}
          </Text>
        </View>
        {action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${action.label} writing`}
            onPress={() => void act(action.resume)}
            disabled={busy}
            hitSlop={6}
            style={({ pressed }) => [styles.button, { borderColor: palette.border }, (pressed || busy) && { opacity: 0.6 }]}>
            <Text style={[styles.buttonText, { color: palette.text }]}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** What went wrong in the writing: failed chapters and blocks and why, or sources that couldn't be read. */
export function BookProblems({ detail }: { detail: DtBookDetail }) {
  const palette = usePalette();
  const generation = detail.book.generation;
  const failedPages = generation?.failedPages ?? 0;
  const failedBlocks = generation?.failedBlocks ?? 0;
  const causes = Object.keys(generation?.failureCategories ?? {})
    .map((category) => FAILURE_CAUSES[category])
    .filter((cause): cause is string => Boolean(cause));
  if (!failedPages && !failedBlocks && !detail.book.explorationFailed) return null;
  const counts = [failedPages ? `${failedPages} ${failedPages === 1 ? 'chapter' : 'chapters'}` : '', failedBlocks ? `${failedBlocks} ${failedBlocks === 1 ? 'block' : 'blocks'}` : '']
    .filter(Boolean)
    .join(' and ');
  return (
    <View style={[styles.problems, { borderColor: palette.border }]}>
      {counts ? <Text style={[styles.title, { color: palette.text }]}>{`${counts} failed to write`}</Text> : null}
      {[...new Set(causes)].map((cause) => (
        <Text key={cause} style={[styles.detail, { color: palette.textMuted }]}>{`• ${cause}`}</Text>
      ))}
      {counts ? <Text style={[styles.detail, { color: palette.textMuted }]}>Open a chapter to try its failed parts again.</Text> : null}
      {detail.book.explorationFailed ? (
        <Text style={[styles.detail, { color: palette.textMuted }]}>DeepTutor couldn&apos;t read your sources, so the book was written from the proposal alone.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: 12 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  text: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.medium, fontSize: 14 },
  detail: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  button: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 6 },
  buttonText: { fontFamily: fonts.medium, fontSize: 14 },
  problems: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: 12, gap: 4 },
});
