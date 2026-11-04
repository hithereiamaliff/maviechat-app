import { getDiff, type FileDiff } from '@maviechat/opencode-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { useOcAuthed } from '@/session/OpenCodeProvider';
import { fonts, radius, usePalette } from '@/theme';
import { RECONNECTED, useOcEvents } from './live';
import { parsePatch, splitPath, type PatchLine } from './patch';
import { ocKey } from './queries';

/** Lines shown per file before "Show all". */
const FIRST_LINES = 400;

const totals = (files: FileDiff[]) => ({
  added: files.reduce((sum, file) => sum + (file.additions || 0), 0),
  removed: files.reduce((sum, file) => sum + (file.deletions || 0), 0),
});

/**
 * What a session changed in its project, file by file, kept current: OpenCode reports a new diff
 * as the session edits, and it's read again when the session stops or the stream comes back.
 */
export function useOcDiff(sessionId: string, directory: string) {
  const { client, accountId } = useOcAuthed();
  const queryClient = useQueryClient();
  const key = ocKey(accountId, 'diff', sessionId);
  const query = useQuery({ queryKey: key, queryFn: () => getDiff(client, directory, sessionId), enabled: Boolean(directory) });
  useOcEvents(directory, (event) => {
    const props = event.properties as { sessionID?: unknown; diff?: unknown; status?: { type?: unknown } };
    if (event.type === RECONNECTED) void queryClient.invalidateQueries({ queryKey: key });
    else if (props.sessionID !== sessionId) return;
    else if (event.type === 'session.diff' && Array.isArray(props.diff)) queryClient.setQueryData(key, props.diff as FileDiff[]);
    else if (event.type === 'session.idle' || (event.type === 'session.status' && props.status?.type === 'idle')) void queryClient.invalidateQueries({ queryKey: key });
  });
  return query;
}

/** A line above the composer once the session has changed files: how many and how much. Opens the changes. */
export function ChangesBar({ files, onPress }: { files: FileDiff[]; onPress: () => void }) {
  const palette = usePalette();
  const { added, removed } = totals(files);
  const noun = files.length === 1 ? 'file' : 'files';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${files.length} ${noun} changed, ${added} lines added, ${removed} removed. Show the changes`}
      onPress={onPress}
      style={({ pressed }) => [styles.bar, { borderColor: palette.border, backgroundColor: pressed ? palette.surface : palette.background }]}>
      <Icon name="document-text" size={16} color={palette.textMuted} />
      <Text style={[styles.barText, { color: palette.text }]}>
        {files.length} {noun} changed
      </Text>
      <Text style={[styles.count, { color: palette.success }]}>+{added}</Text>
      <Text style={[styles.count, { color: palette.danger }]}>−{removed}</Text>
      <View style={styles.flex} />
      <Icon name="chevron-right" size={14} color={palette.textFaint} />
    </Pressable>
  );
}

/** Every file the session changed, each opening to its lines: added in green, removed in red. */
export function ChangesSheet({ visible, files, onClose }: { visible: boolean; files: FileDiff[]; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <ChangesList files={files} onClose={onClose} /> : null}
    </Modal>
  );
}

function ChangesList({ files, onClose }: { files: FileDiff[]; onClose: () => void }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  // A single changed file opens straight away.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(files.length === 1 && files[0]?.file ? [files[0].file] : []));
  const { added, removed } = totals(files);
  const toggle = (file: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(file)) next.add(file);
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
        {files.length} {files.length === 1 ? 'file' : 'files'} · <Text style={{ color: palette.success }}>+{added}</Text> <Text style={{ color: palette.danger }}>−{removed}</Text>
      </Text>
      <FlatList
        data={files}
        keyExtractor={(file, index) => file.file ?? String(index)}
        renderItem={({ item, index }) => {
          const name = item.file ?? String(index);
          return <FileChanges file={item} open={open.has(name)} onToggle={() => toggle(name)} />;
        }}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 16 }]}
        ListEmptyComponent={<Text style={[styles.empty, { color: palette.textMuted }]}>This session hasn’t changed any files.</Text>}
      />
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
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.patchScroll}>
            <View style={styles.patch}>
              {shown.map((line, index) => (
                <PatchRow key={index} line={line} />
              ))}
            </View>
          </ScrollView>
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
  list: { paddingHorizontal: 12, gap: 8 },
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
