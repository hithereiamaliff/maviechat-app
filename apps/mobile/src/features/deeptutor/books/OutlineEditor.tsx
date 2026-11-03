import {
  bookEstimate,
  chapterDrafts,
  confirmSpine,
  DT_CHAPTER_TYPES,
  initialBlockTypes,
  newChapterDraft,
  spineForConfirm,
  type DtBookDetail,
  type DtChapterDraft,
  type DtChapterType,
  type DtSpine,
} from '@maviechat/deeptutor-protocol';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { useToast } from '@/components/Toast';
import { useDtBlockTypes, useDtEstimateBasis } from '@/features/deeptutor/queries';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';
import { blockLabel, bookErrorText, CHAPTER_TYPE_LABELS } from './labels';
import { useBookRefresh } from './useBooks';

/** One chapter in the outline: its title and kind, and (opened) its summary and objectives. */
function ChapterCard({
  draft,
  number,
  first,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  draft: DtChapterDraft;
  number: number;
  first: boolean;
  last: boolean;
  onChange: (patch: Partial<DtChapterDraft>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const palette = usePalette();
  const [open, setOpen] = useState(false);
  const input = [styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }];
  return (
    <View style={[styles.card, { borderColor: palette.border }]}>
      <View style={styles.cardTop}>
        <Text style={[styles.label, { color: palette.textMuted }]}>{`Chapter ${number}`}</Text>
        <View style={styles.grow} />
        <IconButton icon="arrow-up" label={`Move chapter ${number} up`} size={18} onPress={() => onMove(-1)} disabled={first} />
        <IconButton icon="arrow-down" label={`Move chapter ${number} down`} size={18} onPress={() => onMove(1)} disabled={last} />
        <IconButton icon="trash" label={`Remove chapter ${number}`} size={18} onPress={onRemove} />
      </View>
      <TextInput value={draft.title} onChangeText={(title) => onChange({ title })} placeholder="Chapter title" placeholderTextColor={palette.textFaint} style={input} accessibilityLabel={`Chapter ${number} title`} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
        {DT_CHAPTER_TYPES.map((type) => {
          const on = draft.contentType === type;
          return (
            <Pressable
              key={type}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityHint={CHAPTER_TYPE_LABELS[type].hint}
              onPress={() => onChange({ contentType: type })}
              style={[styles.chip, { borderColor: palette.border }, on && { backgroundColor: palette.active, borderColor: palette.active }]}>
              <Text style={[styles.chipText, { color: on ? palette.onActive : palette.textMuted }]}>{CHAPTER_TYPE_LABELS[type].label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Text style={[styles.hint, { color: palette.textFaint }]}>{CHAPTER_TYPE_LABELS[draft.contentType as DtChapterType]?.hint ?? ''}</Text>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.more} hitSlop={6}>
        <Text style={[styles.moreText, { color: palette.link }]}>{open ? 'Hide summary and objectives' : `Summary and objectives${draft.objectives.filter((line) => line.trim()).length ? ` · ${draft.objectives.filter((line) => line.trim()).length}` : ''}`}</Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} color={palette.link} />
      </Pressable>
      {open ? (
        <>
          <TextInput
            value={draft.summary}
            onChangeText={(summary) => onChange({ summary })}
            placeholder="Summary (optional)"
            placeholderTextColor={palette.textFaint}
            style={input}
            accessibilityLabel={`Chapter ${number} summary`}
          />
          <TextInput
            value={draft.objectives.join('\n')}
            onChangeText={(text) => onChange({ objectives: text.split('\n') })}
            placeholder="What you'll be able to do, one per line"
            placeholderTextColor={palette.textFaint}
            multiline
            textAlignVertical="top"
            style={[input, styles.objectives]}
            accessibilityLabel={`Chapter ${number} objectives, one per line`}
          />
        </>
      ) : null}
    </View>
  );
}

/**
 * The outline DeepTutor drafted, to change before anything is written: chapters renamed,
 * reordered, removed or added; what pages may contain; and whether to write every chapter now
 * or each one when you open it. Starting costs nothing by itself.
 */
export function OutlineEditor({ detail, spine }: { detail: DtBookDetail; spine: DtSpine }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useDtAuthed();
  const refresh = useBookRefresh();
  const { book } = detail;
  const [drafts, setDrafts] = useState<DtChapterDraft[]>(() => chapterDrafts(spine));
  const [picked, setPicked] = useState<string[] | null>(null);
  const [writeAll, setWriteAll] = useState(true);
  const [starting, setStarting] = useState(false);
  const catalog = useDtBlockTypes(true);
  const basis = useDtEstimateBasis(book.depth, true);
  const options = (catalog.data ?? []).filter((option) => option.type !== 'section');
  // Until you change them: the book's own choice, else DeepTutor's defaults. Without the list, nothing is narrowed.
  const types = picked ?? (catalog.data ? initialBlockTypes(catalog.data, book.blockTypes) : null);
  const estimate = bookEstimate(basis.data, drafts);
  const titled = drafts.filter((draft) => draft.title.trim()).length;

  const change = (index: number, patch: Partial<DtChapterDraft>) => setDrafts((list) => list.map((draft, at) => (at === index ? { ...draft, ...patch } : draft)));
  const move = (index: number, by: -1 | 1) =>
    setDrafts((list) => {
      const target = index + by;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target] as DtChapterDraft, next[index] as DtChapterDraft];
      return next;
    });
  const toggleType = (type: string) => setPicked((current) => {
    const now = current ?? types ?? [];
    return now.includes(type) ? now.filter((item) => item !== type) : [...now, type];
  });

  const start = async () => {
    setStarting(true);
    try {
      await confirmSpine(client, { book, spine: spineForConfirm(spine, book.id, drafts), autoCompile: writeAll, blockTypes: types });
      refresh(book.id);
    } catch (error) {
      setStarting(false);
      toast(`Couldn't start the writing: ${bookErrorText(error)}`, 'error');
      refresh(book.id);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.heading, { color: palette.text }]}>Review the outline</Text>
        <Text style={[styles.note, { color: palette.textMuted }]}>Rename, reorder, remove or add chapters. Nothing is written until you start.</Text>
        {book.explorationFailed ? (
          <Text style={[styles.note, { color: palette.textMuted }]}>Your sources couldn&apos;t be read, so this outline comes from the proposal alone.</Text>
        ) : null}
        {drafts.map((draft, index) => (
          <ChapterCard
            key={draft.id}
            draft={draft}
            number={index + 1}
            first={index === 0}
            last={index === drafts.length - 1}
            onChange={(patch) => change(index, patch)}
            onMove={(by) => move(index, by)}
            onRemove={() => setDrafts((list) => list.filter((_, at) => at !== index))}
          />
        ))}
        <Button label="Add Chapter" variant="secondary" onPress={() => setDrafts((list) => [...list, newChapterDraft()])} />

        {types ? (
          <View style={styles.section}>
            <Text style={[styles.label, { color: palette.textMuted }]}>What pages may contain</Text>
            <Text style={[styles.hint, { color: palette.textFaint }]}>Prose is always in. Each other kind is one more model call per chapter.</Text>
            {options.map((option) => {
              const on = types.includes(option.type);
              return (
                <Pressable
                  key={option.type}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => toggleType(option.type)}
                  style={({ pressed }) => [styles.row, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
                  <Text style={[styles.rowText, { color: palette.text }]}>{blockLabel(option.type)}</Text>
                  {on ? <Icon name="check" size={18} color={palette.text} strokeWidth={2} /> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={[styles.label, { color: palette.textMuted }]}>When to write</Text>
          {[
            { all: true, title: 'Write every chapter now', hint: 'One after another in the background; read each as soon as it’s ready.' },
            { all: false, title: 'Write each chapter when I open it', hint: 'Nothing is spent on a chapter until you open it.' },
          ].map((choice) => {
            const on = writeAll === choice.all;
            return (
              <Pressable
                key={choice.title}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() => setWriteAll(choice.all)}
                style={[styles.option, { borderColor: on ? palette.text : palette.border }]}>
                <View style={styles.grow}>
                  <Text style={[styles.rowText, { color: palette.text }]}>{choice.title}</Text>
                  <Text style={[styles.hint, { color: palette.textMuted }]}>{choice.hint}</Text>
                </View>
                {on ? <Icon name="check" size={18} color={palette.text} strokeWidth={2} /> : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: palette.border }]}>
        {estimate ? (
          <Text style={[styles.hint, styles.center, { color: palette.textMuted }]}>
            {`${estimate.chapters} ${estimate.chapters === 1 ? 'chapter' : 'chapters'} · about ${estimate.words.toLocaleString()} words · about ${estimate.minutes} min to write`}
          </Text>
        ) : null}
        <Button label="Start Writing" onPress={() => void start()} loading={starting} disabled={starting || titled === 0} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 24 },
  heading: { fontFamily: fonts.semibold, fontSize: 20 },
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  center: { textAlign: 'center' },
  label: { fontFamily: fonts.medium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: 12, gap: 8 },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 15 },
  objectives: { minHeight: 90 },
  chips: { gap: 6 },
  chip: { height: 30, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth },
  chipText: { fontFamily: fonts.medium, fontSize: 13 },
  more: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  moreText: { fontFamily: fonts.medium, fontSize: 13 },
  section: { gap: 6, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, fontFamily: fonts.medium, fontSize: 15 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: radius.md, padding: 12 },
  footer: { padding: 16, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
});
