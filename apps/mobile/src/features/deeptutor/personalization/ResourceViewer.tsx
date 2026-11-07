import { splitFrontMatter } from '@maviechat/deeptutor-protocol';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Modal } from '@/components/Modal';
import { describeError } from '@/lib/errors';
import { Markdown } from '@/markdown/Markdown';
import { fonts, usePalette } from '@/theme';

/** A persona or skill to read: its description and its Markdown, without the file's header. */
export function ResourceViewer({
  visible,
  name,
  badge,
  description,
  file,
  error,
  onEdit,
  onClose,
  onDismiss,
}: {
  visible: boolean;
  /** Kept while it slides away. */
  name: string;
  badge?: string;
  description: string;
  /** The whole file, or undefined while it loads. */
  file: string | undefined;
  error: unknown;
  /** Only for your own. */
  onEdit?: () => void;
  onClose: () => void;
  /** After it has gone (iOS shows one sheet at a time, so the editor opens from here). */
  onDismiss?: () => void;
}) {
  const palette = usePalette();
  const body = file === undefined ? '' : splitFrontMatter(file).body.trim();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} onDismiss={onDismiss}>
      <View style={[styles.sheet, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
            <Text style={[styles.action, { color: palette.link }]}>Done</Text>
          </Pressable>
          <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header" numberOfLines={1}>
            {name}
          </Text>
          {onEdit ? (
            <Pressable accessibilityRole="button" onPress={onEdit} hitSlop={10}>
              <Text style={[styles.action, styles.strong, { color: palette.link }]}>Edit</Text>
            </Pressable>
          ) : (
            <View style={styles.placeholder} />
          )}
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {badge ? <Text style={[styles.badge, { color: palette.textMuted }]}>{badge}</Text> : null}
          <Text style={[styles.description, { color: description ? palette.text : palette.textFaint }]}>{description || 'No description'}</Text>
          {error ? (
            <Text style={[styles.description, { color: palette.danger }]}>{`Couldn’t open it: ${describeError(error)}`}</Text>
          ) : file === undefined ? (
            <ActivityIndicator color={palette.textMuted} />
          ) : body ? (
            <Markdown text={body} />
          ) : (
            <Text style={[styles.description, { color: palette.textFaint }]}>It has nothing written yet.</Text>
          )}
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
  placeholder: { width: 36 },
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  badge: { fontFamily: fonts.medium, fontSize: 12 },
  description: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
});
