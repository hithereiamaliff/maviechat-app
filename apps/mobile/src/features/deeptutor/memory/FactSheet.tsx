import { deleteMemoryFact, describeMemoryRef, editMemoryFact, MEMORY_FACT_MAX, type DtMemoryEntry, type DtMemoryLayer } from '@maviechat/deeptutor-protocol';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { showPrompt } from '@/components/dialogs';
import { useDtSessions } from '@/features/deeptutor/queries';
import { describeError } from '@/lib/errors';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';
import { useMemoryItems, useMemoryRefresh } from './queries';
import { sourceRow, type SourceTarget } from './sources';

/**
 * One fact: what it says, where it came from (tap a source to go there), and rewording or
 * deleting it. Preferences are written by chats, so they can only be deleted here.
 */
export function FactSheet({
  visible,
  layer,
  sheetKey,
  entry,
  onClose,
  onDismiss,
  onPick,
}: {
  visible: boolean;
  layer: DtMemoryLayer;
  sheetKey: string;
  /** Kept while it slides away. */
  entry: DtMemoryEntry | null;
  onClose: () => void;
  onDismiss: () => void;
  /** A source was tapped: the screen closes this and goes there once it has gone. */
  onPick: (target: SourceTarget) => void;
}) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useDtAuthed();
  const refresh = useMemoryRefresh();
  const sessions = useDtSessions('');
  const refs = entry?.refs ?? [];
  const surfaces = refs.flatMap((ref) => {
    const source = describeMemoryRef(ref);
    return source.kind === 'item' ? [source.surface] : [];
  });
  const item = useMemoryItems(surfaces, visible);
  const chatTitle = (id: string) => sessions.data?.find((session) => (session.session_id ?? session.id) === id)?.title?.trim() || undefined;
  const rows = refs.map((ref) => ({ ref, ...sourceRow(ref, { chatTitle, item }) }));
  const editable = Boolean(entry?.id) && !(layer === 'L3' && sheetKey === 'preferences');

  const reword = () => {
    if (!entry) return;
    showPrompt(
      'Reword the fact',
      `Its sources stay the same. ${MEMORY_FACT_MAX} characters at most.`,
      (value) => {
        const next = (value ?? '').trim();
        if (!next || next === entry.text) return;
        if (next.length > MEMORY_FACT_MAX) return toast(`That’s ${next.length} characters: ${MEMORY_FACT_MAX} at most.`, 'error');
        void editMemoryFact(client, layer, sheetKey, entry, next).then(
          () => {
            refresh();
            onClose();
            toast('Fact reworded');
          },
          (error: unknown) => toast(`Couldn’t change it: ${describeError(error)}`, 'error'),
        );
      },
      'plain-text',
      entry.text,
    );
  };
  const remove = () => {
    if (!entry) return;
    Alert.alert('Delete this fact?', 'DeepTutor forgets it. A later update may learn it again from the same source.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deleteMemoryFact(client, layer, sheetKey, entry.id).then(
            () => {
              refresh();
              onClose();
              toast('Fact deleted');
            },
            (error: unknown) => toast(`Couldn’t delete it: ${describeError(error)}`, 'error'),
          ),
      },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} onDismiss={onDismiss}>
      <View style={[styles.sheet, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          <View style={styles.placeholder} />
          <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
            Fact
          </Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
            <Text style={[styles.action, styles.strong, { color: palette.link }]}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.fact, { color: palette.text }]} selectable>
            {entry?.text ?? ''}
          </Text>
          <Text style={[styles.section, { color: palette.textMuted }]}>{rows.length ? (rows.length === 1 ? 'Its source' : `Its ${rows.length} sources`) : 'No source recorded'}</Text>
          {rows.length ? (
            <View style={[styles.group, { borderColor: palette.border }]}>
              {rows.map((row, index) => (
                <Pressable
                  key={row.ref}
                  accessibilityRole={row.target ? 'button' : undefined}
                  disabled={!row.target}
                  onPress={() => onPick(row.target)}
                  style={({ pressed }) => [styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
                  <Icon name={row.icon} size={16} color={palette.textMuted} />
                  <View style={styles.rowText}>
                    <Text style={[styles.rowTitle, { color: palette.text }]} numberOfLines={2}>
                      {row.title}
                    </Text>
                    {row.detail ? <Text style={[styles.rowDetail, { color: palette.textMuted }]}>{row.detail}</Text> : null}
                  </View>
                  {row.target ? <Icon name={'web' in row.target ? 'arrow-top-right-on-square' : 'chevron-right'} size={14} color={palette.textFaint} /> : null}
                </Pressable>
              ))}
            </View>
          ) : null}
          {entry?.id ? (
            <View style={styles.actions}>
              {editable ? <Button label="Reword" variant="secondary" onPress={reword} /> : null}
              <Button label="Delete" variant="secondary" onPress={remove} />
            </View>
          ) : null}
          {layer === 'L3' && sheetKey === 'preferences' ? <Text style={[styles.note, { color: palette.textMuted }]}>Chats save a preference when you state one; they can’t be reworded here.</Text> : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  action: { fontFamily: fonts.regular, fontSize: 16 },
  strong: { fontFamily: fonts.semibold },
  placeholder: { width: 40 },
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  fact: { fontFamily: fonts.regular, fontSize: 17, lineHeight: 24 },
  section: { fontFamily: fonts.medium, fontSize: 13, marginTop: 8 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: fonts.regular, fontSize: 15 },
  rowDetail: { fontFamily: fonts.regular, fontSize: 12 },
  actions: { gap: 10, marginTop: 8 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
});
