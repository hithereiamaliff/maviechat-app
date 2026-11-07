import { DT_HIGHLIGHT_COLORS, type DtAnnotation, type DtBookmark, type DtMaterialDetail } from '@maviechat/deeptutor-protocol';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { fonts, radius, usePalette } from '@/theme';
import { HIGHLIGHT_LABELS, HIGHLIGHT_TINTS, unitName } from './labels';

type Tab = 'contents' | 'bookmarks' | 'highlights';

function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  const palette = usePalette();
  return (
    <View style={styles.header}>
      <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header" numberOfLines={1}>
        {title}
      </Text>
      <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
        <Text style={[styles.done, { color: palette.link }]}>Done</Text>
      </Pressable>
    </View>
  );
}

/**
 * A material's contents (its own outline, else every page), your bookmarks and the highlights and
 * notes, each one a tap away from its place.
 */
export function ContentsSheet({
  visible,
  detail,
  current,
  bookmarks,
  annotations,
  onClose,
  onGo,
}: {
  visible: boolean;
  detail: DtMaterialDetail | undefined;
  current: number;
  bookmarks: DtBookmark[];
  annotations: DtAnnotation[];
  onClose: () => void;
  onGo: (locator: number) => void;
}) {
  const palette = usePalette();
  const [tab, setTab] = useState<Tab>('contents');
  const unit = unitName(detail?.unit ?? 'section');
  const entries = detail?.outline.length
    ? detail.outline
    : Array.from({ length: Math.min(detail?.unitCount ?? 0, 1000) }, (_, index) => ({
        locator: index + 1,
        title: detail?.unitRefs.find((ref) => ref.locator === index + 1)?.title || `${unit} ${index + 1}`,
        level: 1,
      }));
  const row = (key: string, locator: number, title: string, detailText?: string, depth = 1, tint?: string) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      onPress={() => onGo(locator)}
      style={({ pressed }) => [styles.row, { borderBottomColor: palette.border, paddingLeft: (depth - 1) * 14 }, pressed && { backgroundColor: palette.surface }]}>
      {tint ? <View style={[styles.swatch, { backgroundColor: tint }]} /> : null}
      <View style={styles.grow}>
        <Text style={[styles.rowTitle, { color: locator === current ? palette.link : palette.text }]} numberOfLines={2}>
          {title}
        </Text>
        {detailText ? (
          <Text style={[styles.rowDetail, { color: palette.textMuted }]} numberOfLines={2}>
            {detailText}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.page, { color: palette.textFaint }]}>{locator}</Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: palette.background }]}>
        <SheetHeader title={detail?.title ?? 'Contents'} onClose={onClose} />
        <View style={[styles.tabs, { backgroundColor: palette.surface }]}>
          {(
            [
              ['contents', 'Contents'],
              ['bookmarks', `Bookmarks${bookmarks.length ? ` · ${bookmarks.length}` : ''}`],
              ['highlights', `Highlights${annotations.length ? ` · ${annotations.length}` : ''}`],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === key }}
              onPress={() => setTab(key)}
              style={[styles.tab, tab === key && { backgroundColor: palette.background, borderColor: palette.border }]}>
              <Text style={[styles.tabText, { color: tab === key ? palette.text : palette.textMuted }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {tab === 'contents' ? entries.map((entry) => row(`c-${entry.locator}-${entry.title}`, entry.locator, entry.title, undefined, entry.level)) : null}
          {tab === 'bookmarks' ? (
            bookmarks.length ? (
              bookmarks.map((bookmark) => row(`b-${bookmark.id}`, bookmark.locator, bookmark.label || `${unit} ${bookmark.locator}`))
            ) : (
              <Text style={[styles.empty, { color: palette.textMuted }]}>No bookmarks yet. Bookmark a page from the reader&apos;s menu.</Text>
            )
          ) : null}
          {tab === 'highlights' ? (
            annotations.length ? (
              [...annotations]
                .sort((a, b) => a.locator - b.locator || a.createdAt - b.createdAt)
                .map((annotation) =>
                  row(
                    `h-${annotation.id}`,
                    annotation.locator,
                    annotation.quote || '(no text)',
                    [annotation.author === 'assistant' ? 'From the tutor' : '', annotation.note ? `Note: ${annotation.note}` : ''].filter(Boolean).join(' · ') || undefined,
                    1,
                    HIGHLIGHT_TINTS[annotation.color] ?? HIGHLIGHT_TINTS.yellow,
                  ),
                )
            ) : (
              <Text style={[styles.empty, { color: palette.textMuted }]}>No highlights yet. Long-press a paragraph to highlight it.</Text>
            )
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** One highlight or note: its words, its note (edit it), its colour, and removing it. */
export function MarkSheet({
  annotation,
  onClose,
  onSave,
  onDelete,
  onAsk,
}: {
  annotation: DtAnnotation | null;
  onClose: () => void;
  onSave: (change: { note: string; color: string }) => void;
  onDelete: () => void;
  onAsk: () => void;
}) {
  return (
    <Modal visible={annotation !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {annotation ? <MarkEditor key={annotation.id} annotation={annotation} onClose={onClose} onSave={onSave} onDelete={onDelete} onAsk={onAsk} /> : null}
    </Modal>
  );
}

function MarkEditor({
  annotation,
  onClose,
  onSave,
  onDelete,
  onAsk,
}: {
  annotation: DtAnnotation;
  onClose: () => void;
  onSave: (change: { note: string; color: string }) => void;
  onDelete: () => void;
  onAsk: () => void;
}) {
  const palette = usePalette();
  const [note, setNote] = useState(annotation.note);
  const [color, setColor] = useState(annotation.color);
  const changed = note.trim() !== annotation.note.trim() || color !== annotation.color;
  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <SheetHeader title={annotation.kind === 'note' ? 'Note' : 'Highlight'} onClose={onClose} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {annotation.quote ? (
          <View style={[styles.quote, { borderLeftColor: palette.border, backgroundColor: HIGHLIGHT_TINTS[color] ?? HIGHLIGHT_TINTS.yellow }]}>
            <Text style={[styles.quoteText, { color: palette.text }]}>{annotation.quote}</Text>
          </View>
        ) : null}
        {annotation.author === 'assistant' ? <Text style={[styles.rowDetail, { color: palette.textMuted }]}>Marked by the tutor.</Text> : null}
        <Text style={[styles.label, { color: palette.textMuted }]}>Colour</Text>
        <View style={styles.colors}>
          {DT_HIGHLIGHT_COLORS.map((item) => (
            <Pressable
              key={item}
              accessibilityRole="radio"
              accessibilityLabel={HIGHLIGHT_LABELS[item]}
              accessibilityState={{ checked: color === item }}
              onPress={() => setColor(item)}
              style={[styles.color, { backgroundColor: HIGHLIGHT_TINTS[item], borderColor: color === item ? palette.text : 'transparent' }]}>
              {color === item ? <Icon name="check" size={14} color={palette.text} strokeWidth={2.2} /> : null}
            </Pressable>
          ))}
        </View>
        <Text style={[styles.label, { color: palette.textMuted }]}>Note</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Your note"
          placeholderTextColor={palette.textFaint}
          multiline
          textAlignVertical="top"
          style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
          accessibilityLabel="Note"
        />
        <Button label="Save" onPress={() => onSave({ note: note.trim(), color })} disabled={!changed} />
        <Button label="Ask the Tutor About It" variant="secondary" onPress={onAsk} />
        <Button label="Remove" variant="secondary" onPress={onDelete} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8, gap: 12 },
  title: { flex: 1, fontFamily: fonts.semibold, fontSize: 17 },
  done: { fontFamily: fonts.medium, fontSize: 16 },
  tabs: { flexDirection: 'row', marginHorizontal: 16, borderRadius: radius.md, padding: 3, gap: 3 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent' },
  tabText: { fontFamily: fonts.medium, fontSize: 13 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  grow: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
  rowDetail: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  page: { fontFamily: fonts.regular, fontSize: 13, minWidth: 24, textAlign: 'right' },
  swatch: { width: 6, alignSelf: 'stretch', borderRadius: 3 },
  empty: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, marginTop: 16, textAlign: 'center' },
  quote: { borderLeftWidth: 3, borderRadius: radius.md, padding: 12 },
  quoteText: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  label: { fontFamily: fonts.medium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 6 },
  colors: { flexDirection: 'row', gap: 12 },
  color: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 100, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: 12, fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
});
