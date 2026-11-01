import type { HistoryMessage } from '@maviechat/owui-protocol';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { useToast } from '@/components/Toast';
import { fonts, radius, usePalette } from '@/theme';
import { BranchNav } from './BranchNav';

interface Attachment {
  kind: 'image' | 'file';
  url?: string;
  name: string;
}

function attachments(files: unknown): Attachment[] {
  if (!Array.isArray(files)) return [];
  return files.flatMap((file): Attachment[] => {
    if (!file || typeof file !== 'object') return [];
    const { type, url, name } = file as { type?: unknown; url?: unknown; name?: unknown };
    const href = typeof url === 'string' ? url : undefined;
    if (type === 'image' && href) return [{ kind: 'image', url: href, name: typeof name === 'string' ? name : 'Image' }];
    return [{ kind: 'file', url: href, name: typeof name === 'string' ? name : 'File' }];
  });
}

export const UserMessage = memo(function UserMessage({
  message,
  branch,
  onStep,
  baseUrl,
  token,
}: {
  message: HistoryMessage;
  branch: { index: number; count: number };
  onStep: (step: -1 | 1) => void;
  baseUrl: string;
  token: string;
}) {
  const palette = usePalette();
  const toast = useToast();
  const [showActions, setShowActions] = useState(false);
  const files = attachments(message.files);

  const resolve = (url: string) => (/^(https?:|data:)/i.test(url) ? url : new URL(url, `${baseUrl}/`).toString());

  return (
    <Pressable onPress={() => setShowActions((value) => !value)} style={styles.wrap} accessibilityHint="Shows message actions">
      {files.length > 0 ? (
        <View style={styles.files}>
          {files.map((file, index) =>
            file.kind === 'image' && file.url ? (
              <Image
                key={index}
                accessibilityLabel={file.name}
                source={{ uri: resolve(file.url), headers: resolve(file.url).startsWith(baseUrl) ? { Authorization: `Bearer ${token}` } : undefined }}
                style={[styles.image, { backgroundColor: palette.surface }]}
                contentFit="cover"
              />
            ) : (
              <View key={index} style={[styles.fileChip, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <Icon name="document-text" size={16} color={palette.textMuted} />
                <Text style={[styles.fileName, { color: palette.text }]} numberOfLines={1}>
                  {file.name}
                </Text>
              </View>
            ),
          )}
        </View>
      ) : null}
      {message.content ? (
        <View style={[styles.bubble, { backgroundColor: palette.bubble }]}>
          <Text selectable style={[styles.text, { color: palette.text }]}>
            {message.content}
          </Text>
        </View>
      ) : null}
      <View style={styles.actions}>
        {showActions ? (
          <IconButton
            icon="clipboard-document"
            label="Copy message"
            size={18}
            color={palette.textMuted}
            onPress={() => {
              void Clipboard.setStringAsync(message.content).then(() => toast('Copied to clipboard'));
            }}
          />
        ) : null}
        <BranchNav index={branch.index} count={branch.count} onStep={onStep} />
      </View>
    </Pressable>
  );
});

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
});
