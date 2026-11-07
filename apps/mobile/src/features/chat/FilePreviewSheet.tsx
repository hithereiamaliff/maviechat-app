import { fileSizeLabel, type FileItem } from '@maviechat/owui-protocol';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { fonts, radius, usePalette } from '@/theme';

const KINDS: Record<string, { label: string; icon: IconName }> = {
  file: { label: 'Document', icon: 'document-text' },
  text: { label: 'Text', icon: 'document-text' },
  collection: { label: 'Knowledge base', icon: 'circle-stack' },
  folder: { label: 'Folder', icon: 'folder' },
  chat: { label: 'Chat', icon: 'chat-bubble-left-right' },
  note: { label: 'Note', icon: 'document-text' },
};

/**
 * An attachment waiting in the input bar, as the web's file preview shows it: what it is, and
 * for a document or web page whether the model gets all of it ("Entire Document") or the parts
 * that match the message ("Focused Retrieval", the default).
 */
export function FilePreviewSheet({ file, onClose, onChange }: { file: FileItem | null; onClose: () => void; onChange: (change: Partial<FileItem>) => void }) {
  const palette = usePalette();
  const kind = file ? (KINDS[file.type] ?? KINDS.file) : KINDS.file;
  const web = file?.type === 'text' && typeof file.url === 'string' && /^https?:/i.test(file.url);
  const choosable = file ? (file.type === 'file' || file.type === 'text') && file.status !== 'uploading' : false;
  const whole = file?.context === 'full';
  return (
    <Modal visible={file !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          <View style={styles.side} />
          <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
            Attachment
          </Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10} style={styles.side}>
            <Text style={[styles.done, { color: palette.link }]}>Done</Text>
          </Pressable>
        </View>
        {file ? (
          <View style={styles.content}>
            <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.surface }]}>
              <Icon name={web ? 'globe-alt' : (kind?.icon ?? 'document-text')} size={22} color={palette.textMuted} />
              <View style={styles.flex}>
                <Text style={[styles.name, { color: palette.text }]} numberOfLines={3}>
                  {file.name || 'Attachment'}
                </Text>
                <Text style={[styles.meta, { color: palette.textMuted }]}>{[web ? 'Web page' : kind?.label, fileSizeLabel(file.size ?? null)].filter(Boolean).join(' · ')}</Text>
              </View>
            </View>
            {choosable ? (
              <View style={[styles.card, styles.switchRow, { borderColor: palette.border }]}>
                <View style={styles.flex}>
                  <Text style={[styles.name, { color: palette.text }]}>{whole ? 'Entire Document' : 'Focused Retrieval'}</Text>
                  <Text style={[styles.meta, { color: palette.textMuted }]}>
                    {whole ? 'The model reads all of it.' : 'The model gets the parts that match your message.'}
                  </Text>
                </View>
                <Switch accessibilityLabel="Entire Document" value={whole} onValueChange={(on) => onChange({ context: on ? 'full' : undefined })} />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  side: { width: 60 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  done: { textAlign: 'right', fontFamily: fonts.semibold, fontSize: 16 },
  content: { padding: 16, gap: 12 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  switchRow: { paddingVertical: 12 },
  flex: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.medium, fontSize: 15 },
  meta: { fontFamily: fonts.regular, fontSize: 13 },
});
