import { gradeFlashcard, type DtDueCard } from '@maviechat/deeptutor-protocol';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { useNoteActions } from '@/features/deeptutor/notes/actions';
import { useDueCards, useNotesRefresh } from '@/features/deeptutor/notes/queries';
import { describeError } from '@/lib/errors';
import { Markdown } from '@/markdown/Markdown';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

/**
 * Flashcards due from every page, one at a time: the front, Show Answer, then Again (back in ten
 * minutes) or Remembered (the gap roughly doubles). The cards due were read when you came in.
 */
export default function ReviewCards() {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useDtAuthed();
  const due = useDueCards();
  const refresh = useNotesRefresh();
  const actions = useNoteActions();
  // The cards as they were when you came in, and how far you've got.
  const [deck, setDeck] = useState<DtDueCard[] | null>(null);
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const cards = deck ?? due.data ?? [];
  const card = cards[index];

  const grade = async (remembered: boolean) => {
    if (!card) return;
    setBusy(true);
    try {
      await gradeFlashcard(client, card, remembered);
      setDeck(cards);
      setIndex(index + 1);
      setShown(false);
      if (index + 1 >= cards.length) refresh();
    } catch (error) {
      toast(`Couldn’t save that: ${describeError(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="Flashcards" menu={[{ key: 'anki', label: 'Export All for Anki', icon: 'arrow-down', onPress: () => void actions.exportAnki() }]} />
      <ScrollView contentContainerStyle={styles.content}>
        {due.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
        {due.isError ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn’t load your cards: ${describeError(due.error)}`}</Text> : null}
        {due.data && !card ? (
          <View style={styles.done}>
            <Icon name="check" size={32} color={palette.success} />
            <Text style={[styles.doneText, { color: palette.text }]}>All caught up</Text>
            <Button label="Back to the Notebook" variant="secondary" onPress={() => router.back()} />
          </View>
        ) : null}
        {card ? (
          <>
            <Text style={[styles.note, { color: palette.textMuted }]}>{`${index + 1} of ${cards.length} · ${card.pageTitle || 'Untitled'}`}</Text>
            <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.surface }]}>
              <Markdown text={card.front} />
              {shown ? (
                <>
                  <View style={[styles.rule, { backgroundColor: palette.border }]} />
                  <Markdown text={card.back} />
                </>
              ) : null}
            </View>
            {shown ? (
              <View style={styles.buttons}>
                <View style={styles.flex}>
                  <Button label="Again" variant="secondary" disabled={busy} onPress={() => void grade(false)} />
                </View>
                <View style={styles.flex}>
                  <Button label="Remembered" disabled={busy} onPress={() => void grade(true)} />
                </View>
              </View>
            ) : (
              <Button label="Show Answer" onPress={() => setShown(true)} />
            )}
            <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/learn/notes/[id]', params: { id: card.pageId } })} hitSlop={6}>
              <Text style={[styles.link, { color: palette.link }]}>Open its page</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 48 },
  note: { fontFamily: fonts.regular, fontSize: 13 },
  card: { gap: 12, padding: 18, minHeight: 180, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  rule: { height: StyleSheet.hairlineWidth },
  buttons: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  link: { fontFamily: fonts.medium, fontSize: 14, textAlign: 'center' },
  done: { alignItems: 'center', gap: 12, marginTop: 48 },
  doneText: { fontFamily: fonts.semibold, fontSize: 18 },
});
