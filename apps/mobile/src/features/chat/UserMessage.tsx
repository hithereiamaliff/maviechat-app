import { attachmentUrl, isImageItem, type FileItem, type HistoryMessage } from '@maviechat/owui-protocol';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { useToast } from '@/components/Toast';
import { useInterface } from '@/lib/uiSettings';
import { Markdown } from '@/markdown/Markdown';
import { fonts, radius, usePalette } from '@/theme';
import { BranchNav } from './BranchNav';

function attachments(files: unknown): FileItem[] {
  if (!Array.isArray(files)) return [];
  return files.filter((file): file is FileItem => Boolean(file) && typeof file === 'object');
}

export const UserMessage = memo(function UserMessage({
  message,
  branch,
  onStep,
  baseUrl,
  token,
  onSaveEdit,
  onSendEdit,
  onDelete,
}: {
  message: HistoryMessage;
  branch: { index: number; count: number };
  onStep: (step: -1 | 1) => void;
  baseUrl: string;
  token: string;
  /** Saves the edited text in place; no new reply. */
  onSaveEdit?: (content: string) => Promise<boolean>;
  /** Sends the edited text as a new version of this message, which gets its own reply. */
  onSendEdit?: (content: string) => Promise<boolean>;
  onDelete?: () => void;
}) {
  const palette = usePalette();
  const toast = useToast();
  const ui = useInterface();
  const [showActions, setShowActions] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const files = attachments(message.files);
  const hasFiles = files.length > 0;

  const finish = async (action: ((content: string) => Promise<boolean>) | undefined) => {
    if (!action || editing === null) return;
    if (!editing.trim() && !hasFiles) {
      toast('Please enter a message or attach a file.', 'error');
      return;
    }
    setBusy(true);
    const done = await action(editing);
    setBusy(false);
    if (done) {
      setEditing(null);
      setShowActions(false);
    }
  };

  const fileViews = hasFiles ? (
    <View style={styles.files}>
      {files.map((file, index) => {
        const url = attachmentUrl(file, baseUrl);
        return isImageItem(file) && url ? (
          <Image
            key={index}
            accessibilityLabel={typeof file.name === 'string' ? file.name : 'Image'}
            source={{ uri: url, headers: url.startsWith(baseUrl) ? { Authorization: `Bearer ${token}` } : undefined }}
            style={[styles.image, { backgroundColor: palette.surface }]}
            contentFit="cover"
          />
        ) : (
          <View key={index} style={[styles.fileChip, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Icon name="document-text" size={16} color={palette.textMuted} />
            <Text style={[styles.fileName, { color: palette.text }]} numberOfLines={1}>
              {typeof file.name === 'string' ? file.name : 'File'}
            </Text>
          </View>
        );
      })}
    </View>
  ) : null;

  if (editing !== null) {
    return (
      <View style={styles.wrap}>
        {fileViews}
        <View style={[styles.editor, { backgroundColor: palette.bubble }]}>
          <TextInput
            value={editing}
            onChangeText={setEditing}
            multiline
            autoFocus
            style={[styles.editInput, { color: palette.text }]}
            accessibilityLabel="Edit message"
          />
          <View style={styles.editActions}>
            {onSaveEdit ? <EditButton label="Save" onPress={() => void finish(onSaveEdit)} disabled={busy} /> : null}
            <View style={styles.spacer} />
            {busy ? <ActivityIndicator size="small" color={palette.textMuted} /> : null}
            <EditButton label="Cancel" onPress={() => setEditing(null)} disabled={busy} />
            {onSendEdit ? <EditButton label="Send" primary onPress={() => void finish(onSendEdit)} disabled={busy} /> : null}
          </View>
        </View>
      </View>
    );
  }

  return (
    <Pressable onPress={() => setShowActions((value) => !value)} style={styles.wrap} accessibilityHint="Shows message actions">
      {fileViews}
      {message.content ? (
        <View style={[styles.bubble, { backgroundColor: palette.bubble }]}>
          {ui('renderMarkdownInUserMessages') ? (
            <Markdown text={message.content} />
          ) : (
            <Text selectable style={[styles.text, { color: palette.text }]}>
              {message.content}
            </Text>
          )}
        </View>
      ) : null}
      <View style={styles.actions}>
        {showActions ? (
          <>
            {onSaveEdit || onSendEdit ? (
              <IconButton icon="pencil" label="Edit" size={18} color={palette.textMuted} onPress={() => setEditing(message.content)} />
            ) : null}
            <IconButton
              icon="clipboard-document"
              label="Copy message"
              size={18}
              color={palette.textMuted}
              onPress={() => {
                void Clipboard.setStringAsync(message.content).then(() => toast('Copied to clipboard'));
              }}
            />
            {onDelete ? <IconButton icon="trash" label="Delete" size={18} color={palette.textMuted} onPress={onDelete} /> : null}
          </>
        ) : null}
        <BranchNav index={branch.index} count={branch.count} onStep={onStep} />
      </View>
    </Pressable>
  );
});

function EditButton({ label, onPress, primary = false, disabled }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      style={({ pressed }) => [
        styles.editButton,
        { backgroundColor: primary ? palette.primary : palette.surfaceStrong, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}>
      <Text style={[styles.editLabel, { color: primary ? palette.onPrimary : palette.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-end', marginTop: 16, gap: 4 },
  files: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6, maxWidth: '90%' },
  image: { width: 140, height: 140, borderRadius: radius.lg },
  fileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 220,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fileName: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 13 },
  bubble: { maxWidth: '88%', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10 },
  text: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 4 },
  editor: { alignSelf: 'stretch', borderRadius: 22, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, gap: 10 },
  editInput: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, maxHeight: 260, padding: 0 },
  editActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  spacer: { flex: 1 },
  editButton: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16 },
  editLabel: { fontFamily: fonts.medium, fontSize: 14 },
});
