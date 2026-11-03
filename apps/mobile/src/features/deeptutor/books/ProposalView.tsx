import { confirmProposal, DtBookActionError, DT_PROPOSAL_CHAPTERS, proposalForConfirm, type DtBookDetail, type DtBookLive, type DtBookProposal } from '@maviechat/deeptutor-protocol';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/IconButton';
import { useToast } from '@/components/Toast';
import { fonts, radius, usePalette } from '@/theme';
import { bookErrorText } from './labels';
import { useBookRefresh, useBookSocket } from './useBooks';

/** The outline being made, in words: what DeepTutor is doing, and what it found. */
function OutlineProgress({ live, hasSources }: { live: DtBookLive; hasSources: boolean }) {
  const palette = usePalette();
  const outline = live.outline;
  const phase =
    outline?.phase === 'checking'
      ? `Checking the outline${outline.rounds > 1 ? ` (round ${outline.rounds})` : ''}…`
      : outline?.phase === 'drafting'
        ? 'Drafting the chapters…'
        : hasSources
          ? 'Reading your sources…'
          : 'Planning the chapters…';
  return (
    <View style={styles.progress}>
      <ActivityIndicator color={palette.textMuted} />
      <Text style={[styles.heading, styles.center, { color: palette.text }]}>Making the outline</Text>
      <Text style={[styles.note, styles.center, { color: palette.text }]}>{phase}</Text>
      {outline?.passages ? <Text style={[styles.note, styles.center, { color: palette.textMuted }]}>{`Found ${outline.passages} passages in your sources.`}</Text> : null}
      {outline?.sourcesFailed ? (
        <Text style={[styles.note, styles.center, { color: palette.textMuted }]}>Your sources couldn&apos;t be read, so the outline comes from the proposal alone.</Text>
      ) : null}
      <Text style={[styles.note, styles.center, { color: palette.textMuted }]}>
        This can take a few minutes. You can leave: DeepTutor carries on, and the outline is here when you come back.
      </Text>
    </View>
  );
}

/**
 * A book's proposal to review: title, description, scope, level and how many chapters. Confirming
 * sends DeepTutor to read the sources and draft the outline (minutes, followed live).
 */
export function ProposalView({ detail, live }: { detail: DtBookDetail; live: DtBookLive }) {
  const palette = usePalette();
  const toast = useToast();
  const socket = useBookSocket();
  const refresh = useBookRefresh();
  const { book } = detail;
  const [edits, setEdits] = useState<DtBookProposal>(() => book.proposal ?? { title: book.title, description: book.description, scope: '', targetLevel: '', estimatedChapters: 4, rationale: '' });
  const [confirming, setConfirming] = useState(false);
  const set = (patch: Partial<DtBookProposal>) => setEdits((current) => ({ ...current, ...patch }));
  const chapters = edits.estimatedChapters || DT_PROPOSAL_CHAPTERS.min;
  const hasSources = book.knowledgeBases.length > 0;

  if (confirming || live.outline) return <OutlineProgress live={live} hasSources={hasSources} />;

  const confirm = async () => {
    setConfirming(true);
    try {
      // Progress comes from the book's own events (followed by the screen), not this action's.
      await confirmProposal(socket, book, proposalForConfirm(book, edits));
      refresh(book.id);
    } catch (error) {
      // A dropped socket doesn't stop DeepTutor: keep following the book's events.
      if (error instanceof DtBookActionError && (error.code === 'disconnected' || error.code === 'timeout')) return;
      setConfirming(false);
      toast(`Couldn't make the outline: ${bookErrorText(error)}`, 'error');
      refresh(book.id);
    }
  };

  const field = (label: string, value: string, onChange: (text: string) => void, multiline = false) => (
    <View style={styles.field}>
      <Text style={[styles.label, { color: palette.textMuted }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[styles.input, multiline && styles.multiline, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
        accessibilityLabel={label}
      />
    </View>
  );

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.heading, { color: palette.text }]}>Review the proposal</Text>
        <Text style={[styles.note, { color: palette.textMuted }]}>Change anything you like. Then DeepTutor reads your sources and drafts the chapters for you to check.</Text>
        {field('Title', edits.title, (title) => set({ title }))}
        {field('Description', edits.description, (description) => set({ description }), true)}
        {field('Scope', edits.scope, (scope) => set({ scope }), true)}
        {field('Level', edits.targetLevel, (targetLevel) => set({ targetLevel }))}
        <View style={styles.field}>
          <Text style={[styles.label, { color: palette.textMuted }]}>About how many chapters</Text>
          <View style={styles.stepper}>
            <IconButton icon="minus" label="Fewer chapters" onPress={() => set({ estimatedChapters: Math.max(DT_PROPOSAL_CHAPTERS.min, chapters - 1) })} disabled={chapters <= DT_PROPOSAL_CHAPTERS.min} />
            <Text style={[styles.count, { color: palette.text }]} accessibilityLabel={`${chapters} chapters`}>
              {chapters}
            </Text>
            <IconButton icon="plus" label="More chapters" onPress={() => set({ estimatedChapters: Math.min(DT_PROPOSAL_CHAPTERS.max, chapters + 1) })} disabled={chapters >= DT_PROPOSAL_CHAPTERS.max} />
          </View>
        </View>
        <View style={styles.field}>
          <Text style={[styles.label, { color: palette.textMuted }]}>Knowledge bases</Text>
          <Text style={[styles.note, { color: palette.text }]}>
            {hasSources ? book.knowledgeBases.join(', ') : 'None: the book draws on the model’s general knowledge and anything else you picked.'}
          </Text>
        </View>
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: palette.border }]}>
        <Button label="Make the Outline" onPress={() => void confirm()} disabled={!edits.title.trim()} />
        <Text style={[styles.hint, { color: palette.textFaint }]}>Takes a few minutes; more with large sources.</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 24 },
  heading: { fontFamily: fonts.semibold, fontSize: 20 },
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  center: { textAlign: 'center' },
  hint: { fontFamily: fonts.regular, fontSize: 12, textAlign: 'center' },
  field: { gap: 6 },
  label: { fontFamily: fonts.medium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 15 },
  multiline: { minHeight: 80 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  count: { fontFamily: fonts.semibold, fontSize: 18, minWidth: 28, textAlign: 'center' },
  progress: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  footer: { padding: 16, gap: 6, borderTopWidth: StyleSheet.hairlineWidth },
});
