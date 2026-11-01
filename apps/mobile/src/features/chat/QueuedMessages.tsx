import type { QueuedMessage } from '@maviechat/owui-protocol';
import { StyleSheet, Text, View } from 'react-native';
import { IconButton } from '@/components/IconButton';
import { fonts, radius, usePalette } from '@/theme';

/** Messages typed while a reply runs; they go out together when it finishes (or one now, stopping the reply). */
export function QueuedMessages({
  queue,
  onSendNow,
  onEdit,
  onDelete,
}: {
  queue: QueuedMessage[];
  onSendNow?: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const palette = usePalette();
  if (queue.length === 0) return null;

  return (
    <View style={styles.list}>
      {queue.map((item) => (
        <View key={item.id} style={[styles.item, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.text}>
            <Text style={[styles.prompt, { color: item.prompt ? palette.text : palette.textFaint }]} numberOfLines={2}>
              {item.prompt || 'Empty message'}
            </Text>
            {item.files.length > 0 ? (
              <Text style={[styles.meta, { color: palette.textFaint }]}>
                {item.files.length === 1 ? '1 attachment' : `${item.files.length} attachments`}
              </Text>
            ) : null}
          </View>
          {onSendNow ? <IconButton icon="arrow-up" label="Send now" size={17} color={palette.textMuted} onPress={() => onSendNow(item.id)} /> : null}
          <IconButton icon="pencil" label="Edit" size={17} color={palette.textMuted} onPress={() => onEdit(item.id)} />
          <IconButton icon="trash" label="Delete" size={17} color={palette.textMuted} onPress={() => onDelete(item.id)} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 6, marginBottom: 6 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingLeft: 12,
    paddingVertical: 4,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1, gap: 2, paddingVertical: 4 },
  prompt: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 19 },
  meta: { fontFamily: fonts.regular, fontSize: 12 },
});
