import { fileSizeLabel, getFileText, type NoteFile } from '@maviechat/owui-protocol';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { showActionSheet } from '@/components/dialogs';
import { Icon, type IconName } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { SideScroll } from '@/components/SideScroll';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { openServerFile } from '@/lib/openServerFile';
import { useAuthed } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';

const iconOf = (file: NoteFile): IconName =>
  file.contentType.startsWith('audio/') || /\.(m4a|mp3|wav|aac|ogg|webm|caf)$/i.test(file.name)
    ? 'musical-note'
    : file.contentType.startsWith('video/')
      ? 'film'
      : file.contentType.startsWith('image/')
        ? 'photo'
        : 'document-text';

/**
 * A note's attached files, as the web lists them above the text: each opens (iOS shows it),
 * shows the text the server read from it (a recording's words, written out), and, in a note you
 * may change, puts that text into the note or comes off the note.
 */
export function NoteAttachments({ files, uploading, writable, onRemove, onInsert }: { files: NoteFile[]; uploading: number; writable: boolean; onRemove: (file: NoteFile) => void; onInsert: (text: string) => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client, session } = useAuthed();
  const [reading, setReading] = useState<{ file: NoteFile; text: string | null; error: string } | null>(null);
  if (!files.length && !uploading) return null;

  const showText = (file: NoteFile) => {
    setReading({ file, text: null, error: '' });
    void getFileText(client, file.id).then(
      (read) =>
        setReading((current) =>
          current?.file.id !== file.id
            ? current
            : read.content.trim()
              ? { file, text: read.content, error: '' }
              : { file, text: '', error: read.status === 'failed' ? `The server couldn’t read it${read.error ? `: ${read.error}` : '.'}` : read.status === 'pending' ? 'The server is still reading it. Try again in a moment.' : 'The server found no text in it.' },
        ),
      (error: unknown) => setReading((current) => (current?.file.id === file.id ? { file, text: '', error: describeError(error) } : current)),
    );
  };
  const choose = (file: NoteFile) => {
    const options = ['Open', 'Show Its Text', ...(writable ? ['Remove From Note'] : []), 'Cancel'];
    showActionSheet({ title: file.name, options, cancelButtonIndex: options.length - 1, ...(writable ? { destructiveButtonIndex: 2 } : {}) }, (index) => {
      if (index === 0) void openServerFile(session, file.id, file.name).catch((error: unknown) => toast(`Couldn’t open it: ${describeError(error)}`, 'error'));
      else if (index === 1) showText(file);
      else if (index === 2 && writable) onRemove(file);
    });
  };

  return (
    <>
      <SideScroll showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={styles.stripContent}>
        {files.map((file) => (
          <Pressable
            key={file.id}
            accessibilityRole="button"
            accessibilityLabel={`${file.name}, attached`}
            accessibilityHint="Opens, shows its text or removes it"
            onPress={() => choose(file)}
            style={({ pressed }) => [styles.chip, { borderColor: palette.border, backgroundColor: pressed ? palette.surface : palette.background }]}>
            <Icon name={iconOf(file)} size={16} color={palette.textMuted} />
            <View style={styles.chipText}>
              <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                {file.name}
              </Text>
              {file.size ? <Text style={[styles.size, { color: palette.textFaint }]}>{fileSizeLabel(file.size)}</Text> : null}
            </View>
          </Pressable>
        ))}
        {uploading ? (
          <View style={[styles.chip, { borderColor: palette.border }]}>
            <ActivityIndicator size="small" color={palette.textMuted} />
            <Text style={[styles.name, { color: palette.textMuted }]}>{uploading === 1 ? 'Adding a file…' : `Adding ${uploading} files…`}</Text>
          </View>
        ) : null}
      </SideScroll>
      <Modal visible={reading !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setReading(null)}>
        <View style={[styles.sheet, { backgroundColor: palette.background }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: palette.text }]} numberOfLines={1} accessibilityRole="header">
              {reading?.file.name ?? ''}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => setReading(null)} hitSlop={10}>
              <Text style={[styles.action, { color: palette.link }]}>Done</Text>
            </Pressable>
          </View>
          {reading?.text === null ? (
            <ActivityIndicator style={styles.wait} color={palette.textMuted} />
          ) : reading?.error ? (
            <Text style={[styles.body, styles.textPad, { color: palette.textMuted }]}>{reading.error}</Text>
          ) : (
            <>
              <ScrollView style={styles.flex} contentContainerStyle={styles.textPad}>
                <Text selectable style={[styles.body, { color: palette.text }]}>
                  {reading?.text ?? ''}
                </Text>
              </ScrollView>
              <View style={[styles.buttons, { borderTopColor: palette.border }]}>
                <Pressable accessibilityRole="button" onPress={() => void Clipboard.setStringAsync(reading?.text ?? '').then(() => toast('Copied'))} hitSlop={8}>
                  <Text style={[styles.action, { color: palette.link }]}>Copy</Text>
                </Pressable>
                {writable ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      onInsert(reading?.text ?? '');
                      setReading(null);
                    }}
                    hitSlop={8}>
                    <Text style={[styles.action, { color: palette.link }]}>Insert Into Note</Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  strip: { flexGrow: 0 },
  stripContent: { paddingHorizontal: 16, gap: 8, paddingBottom: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6, maxWidth: 240 },
  chipText: { flexShrink: 1 },
  name: { fontFamily: fonts.medium, fontSize: 13 },
  size: { fontFamily: fonts.regular, fontSize: 11 },
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  title: { flex: 1, fontFamily: fonts.semibold, fontSize: 16 },
  action: { fontFamily: fonts.semibold, fontSize: 15 },
  wait: { marginTop: 32 },
  flex: { flex: 1 },
  textPad: { paddingHorizontal: 16, paddingBottom: 32 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  buttons: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth },
});
