import type { FileDiff, SessionChanges } from '@maviechat/opencode-protocol';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { SideScroll } from '@/components/SideScroll';
import { fonts, radius, usePalette } from '@/theme';
import { parsePatch, splitPath, type PatchLine } from './patch';

/** Lines shown per file before "Show all". */
const FIRST_LINES = 400;

const noun = (count: number) => (count === 1 ? 'file' : 'files');

/** A line above the composer once the session has changed files: how many and how much. Opens the changes. */
export function ChangesBar({ changes, onPress }: { changes: SessionChanges; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${changes.files} ${noun(changes.files)} changed, ${changes.additions} lines added, ${changes.deletions} removed. Show the changes`}
      onPress={onPress}
      style={({ pressed }) => [styles.bar, { borderColor: palette.border, backgroundColor: pressed ? palette.surface : palette.background }]}>
      <Icon name="document-text" size={16} color={palette.textMuted} />
      <Text style={[styles.barText, { color: palette.text }]}>
        {changes.files} {noun(changes.files)} changed
      </Text>
      <Text style={[styles.count, { color: palette.success }]}>+{changes.additions}</Text>
      <Text style={[styles.count, { color: palette.danger }]}>−{changes.deletions}</Text>
      <View style={styles.flex} />
      <Icon name="chevron-right" size={14} color={palette.textFaint} />
    </Pressable>
  );
}

/**
 * Every file the session changed, under the message that asked for it (newest first), each
 * opening to its lines: added in green, removed in red.
 */
export function ChangesSheet({ visible, changes, onClose }: { visible: boolean; changes: SessionChanges; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <ChangesList changes={changes} onClose={onClose} /> : null}
    </Modal>
  );
}

const keyOf = (messageID: string, file: FileDiff, index: number) => `${messageID}:${file.file ?? index}`;

function ChangesList({ changes, onClose }: { changes: SessionChanges; onClose: () => void }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  // A single changed file opens straight away.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => {
    const only = changes.turns.length === 1 && changes.turns[0]?.files.length === 1 ? changes.turns[0] : null;
    return new Set(only?.files[0] ? [keyOf(only.messageID, only.files[0], 0)] : []);
  });
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: palette.text }]}>Changes</Text>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.done, { color: palette.link }]}>Done</Text>
        </Pressable>
      </View>
      <Text style={[styles.summary, { color: palette.textMuted }]}>
        {changes.files} {noun(changes.files)} · <Text style={{ color: palette.success }}>+{changes.additions}</Text> <Text style={{ color: palette.danger }}>−{changes.deletions}</Text>
      </Text>
      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 16 }]}>
        {changes.turns.map((turn) => (
          <View key={turn.messageID} style={styles.turn}>
            <Text style={[styles.turnTitle, { color: palette.textMuted }]} numberOfLines={2}>
              {turn.prompt ? `After “${turn.prompt}”` : 'After your message'}
            </Text>
            {turn.files.map((file, index) => {
              const key = keyOf(turn.messageID, file, index);
              return <FileChanges key={key} file={file} open={open.has(key)} onToggle={() => toggle(key)} />;
            })}
          </View>
        ))}
        {changes.turns.length === 0 ? <Text style={[styles.empty, { color: palette.textMuted }]}>This session hasn’t changed any files.</Text> : null}
      </ScrollView>
    </View>
  );
}

function FileChanges({ file, open, onToggle }: { file: FileDiff; open: boolean; onToggle: () => void }) {
  const palette = usePalette();
  const [all, setAll] = useState(false);
  const path = splitPath(file.file ?? '');
  const lines = useMemo(() => (open && file.patch ? parsePatch(file.patch) : []), [open, file.patch]);
  const shown = all ? lines : lines.slice(0, FIRST_LINES);
  const status = file.status === 'added' ? 'Added' : file.status === 'deleted' ? 'Deleted' : null;
  return (
    <View style={[styles.file, { borderColor: palette.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${file.file ?? 'A file'}${status ? `, ${status.toLowerCase()}` : ''}, ${file.additions} lines added, ${file.deletions} removed`}
        onPress={onToggle}
        style={({ pressed }) => [styles.fileRow, pressed && { backgroundColor: palette.surface }]}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} color={palette.textFaint} />
        <View style={styles.fileText}>
          <Text style={[styles.fileName, { color: palette.text }]} numberOfLines={1}>
            {path.name}
          </Text>
          {path.folder ? (
            <Text style={[styles.folder, { color: palette.textFaint }]} numberOfLines={1} ellipsizeMode="head">
              {path.folder}
            </Text>
          ) : null}
        </View>
        {status ? <Text style={[styles.status, { color: status === 'Added' ? palette.success : palette.danger }]}>{status}</Text> : null}
        <Text style={[styles.count, { color: palette.success }]}>+{file.additions}</Text>
        <Text style={[styles.count, { color: palette.danger }]}>−{file.deletions}</Text>
      </Pressable>
      {open && !file.patch ? <Text style={[styles.note, { color: palette.textMuted }]}>This change is too large to show line by line.</Text> : null}
      {open && file.patch ? (
        <>
          <SideScroll showsHorizontalScrollIndicator={false} contentContainerStyle={styles.patchScroll}>
            <View style={styles.patch}>
              {shown.map((line, index) => (
                <PatchRow key={index} line={line} />
              ))}
            </View>
          </SideScroll>
          {lines.length > shown.length ? (
            <Pressable accessibilityRole="button" onPress={() => setAll(true)} style={({ pressed }) => [styles.more, pressed && { backgroundColor: palette.surface }]}>
              <Text style={[styles.moreText, { color: palette.link }]}>Show all {lines.length} lines</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function PatchRow({ line }: { line: PatchLine }) {
  const palette = usePalette();
  if (line.kind === 'hunk' || line.kind === 'note') {
    return <Text style={[styles.hunk, { color: palette.textFaint, backgroundColor: line.kind === 'hunk' ? palette.surface : 'transparent' }]}>{line.text}</Text>;
  }
  const color = line.kind === 'add' ? palette.success : line.kind === 'del' ? palette.danger : palette.textFaint;
  return (
    <View style={[styles.line, line.kind !== 'ctx' && { backgroundColor: `${color}22` }]}>
      <Text style={[styles.number, { color: palette.textFaint }]}>{line.number ?? ''}</Text>
      <Text style={[styles.sign, { color }]}>{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}</Text>
      <Text style={[styles.code, { color: palette.text }]}>{line.text || ' '}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 38, paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  barText: { fontFamily: fonts.medium, fontSize: 14 },
  count: { fontFamily: fonts.medium, fontSize: 13 },
  sheet: { flex: 1, paddingTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 8 },
  title: { fontFamily: fonts.semibold, fontSize: 18 },
  done: { fontFamily: fonts.semibold, fontSize: 16 },
  summary: { fontFamily: fonts.regular, fontSize: 14, marginHorizontal: 20, marginBottom: 8 },
  list: { paddingHorizontal: 12, gap: 16 },
  turn: { gap: 8 },
  turnTitle: { fontFamily: fonts.medium, fontSize: 13, marginHorizontal: 4 },
  empty: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: 24 },
  file: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: 'hidden' },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  fileText: { flex: 1, gap: 1 },
  fileName: { fontFamily: fonts.medium, fontSize: 14 },
  folder: { fontFamily: fonts.regular, fontSize: 12 },
  status: { fontFamily: fonts.medium, fontSize: 12 },
  note: { fontFamily: fonts.regular, fontSize: 13, paddingHorizontal: 12, paddingBottom: 12 },
  patchScroll: { minWidth: '100%' },
  patch: { flexGrow: 1, paddingBottom: 6 },
  hunk: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, paddingHorizontal: 10, paddingVertical: 2 },
  line: { flexDirection: 'row', paddingRight: 12 },
  number: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, width: 40, textAlign: 'right' },
  sign: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, width: 18, textAlign: 'center' },
  code: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18 },
  more: { paddingVertical: 10, alignItems: 'center' },
  moreText: { fontFamily: fonts.medium, fontSize: 13 },
});
