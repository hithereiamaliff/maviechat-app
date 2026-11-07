import { attachmentUrl, isImageItem, type FileItem } from '@maviechat/owui-protocol';
import { Image } from 'expo-image';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { SideScroll } from '@/components/SideScroll';
import { fonts, radius, usePalette } from '@/theme';

function size(bytes: number | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Attachments waiting in the input bar: photo thumbnails and file chips, each with a remove button. */
export function AttachmentStrip({
  files,
  previews,
  baseUrl,
  token,
  onRemove,
  onOpen,
}: {
  files: FileItem[];
  previews: Record<string, string>;
  baseUrl: string;
  token: string;
  onRemove: (index: number) => void;
  /** A file chip opens its preview (whole document or not). */
  onOpen?: (index: number) => void;
}) {
  const palette = usePalette();
  if (files.length === 0) return null;

  return (
    <SideScroll showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip} keyboardShouldPersistTaps="handled">
      {files.map((file, index) => {
        const uploading = file.status === 'uploading';
        const preview = (file.itemId && previews[file.itemId]) || attachmentUrl(file, baseUrl);
        const remove = (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${file.name ?? 'attachment'}`}
            hitSlop={8}
            onPress={() => onRemove(index)}
            style={[styles.remove, { backgroundColor: palette.primary }]}>
            <Icon name="x-mark" size={11} color={palette.onPrimary} strokeWidth={2.5} />
          </Pressable>
        );
        return isImageItem(file) && preview ? (
          <View key={file.itemId ?? index} style={styles.thumbWrap}>
            <Image
              accessibilityLabel={file.name ?? 'Photo'}
              source={{ uri: preview, headers: preview.startsWith(baseUrl) ? { Authorization: `Bearer ${token}` } : undefined }}
              style={[styles.thumb, { backgroundColor: palette.surface }]}
              contentFit="cover"
            />
            {uploading ? <ActivityIndicator style={StyleSheet.absoluteFill} color="#FFFFFF" /> : null}
            {remove}
          </View>
        ) : (
          <Pressable
            key={file.itemId ?? index}
            accessibilityRole="button"
            accessibilityHint="Shows the attachment"
            disabled={!onOpen}
            onPress={() => onOpen?.(index)}
            style={[styles.chip, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            {uploading ? (
              <ActivityIndicator size="small" color={palette.textMuted} />
            ) : (
              <Icon
                name={file.type === 'chat' ? 'chat-bubble-left-right' : file.type === 'note' ? 'pencil-square' : file.type === 'collection' ? 'circle-stack' : 'document-text'}
                size={18}
                color={palette.textMuted}
              />
            )}
            <View style={styles.chipText}>
              <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                {file.name ?? 'File'}
              </Text>
              <Text style={[styles.meta, { color: palette.textFaint }]} numberOfLines={1}>
                {uploading
                  ? 'Uploading…'
                  : file.context === 'full'
                    ? 'Entire document'
                    : size(file.size) || (file.type === 'chat' ? 'Chat' : file.type === 'note' ? 'Note' : file.type === 'collection' ? 'Knowledge' : 'File')}
              </Text>
            </View>
            {remove}
          </Pressable>
        );
      })}
    </SideScroll>
  );
}

const styles = StyleSheet.create({
  strip: { gap: 8, paddingTop: 6, paddingRight: 6 },
  thumbWrap: { width: 56, height: 56 },
  thumb: { width: 56, height: 56, borderRadius: radius.md },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 56,
    maxWidth: 200,
    paddingLeft: 10,
    paddingRight: 16,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { flexShrink: 1, gap: 1 },
  name: { fontFamily: fonts.medium, fontSize: 13 },
  meta: { fontFamily: fonts.regular, fontSize: 12 },
  remove: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
