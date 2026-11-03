import { modelName, overviewRows, type ChatHistory, type ModelItem } from '@maviechat/owui-protocol';
import { FlashList } from '@shopify/flash-list';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { fonts, usePalette } from '@/theme';

const INDENT = 16;

/**
 * Overview: every message and every version in the chat, as a tree. The web draws it as a graph;
 * here each fork steps in. Tapping a message shows its branch.
 */
export function OverviewList({ history, leafId, models, onShow }: { history: ChatHistory; leafId: string | null; models: ModelItem[] | undefined; onShow: (messageId: string) => void }) {
  const palette = usePalette();
  const rows = useMemo(() => overviewRows(history, leafId), [history, leafId]);
  return (
    <FlashList
      data={rows}
      keyExtractor={(row) => row.id}
      ListHeaderComponent={<Text style={[styles.intro, { color: palette.textMuted }]}>Every message and version in this chat. Tap one to show its branch.</Text>}
      renderItem={({ item }) => {
        const who = item.role === 'user' ? 'You' : modelName(models, item.model);
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${who}${item.version ? `, version ${item.version.index + 1} of ${item.version.count}` : ''}${item.shown ? ', shown' : ''}: ${item.text || 'no text'}`}
            accessibilityHint="Shows this message's branch"
            onPress={() => onShow(item.id)}
            style={({ pressed }) => [styles.row, { paddingLeft: 16 + item.indent * INDENT }, pressed && { backgroundColor: palette.surface }]}>
            <View style={[styles.bar, { backgroundColor: item.shown ? palette.text : 'transparent' }]} />
            <Icon name={item.role === 'user' ? 'user-circle' : 'sparkles'} size={18} color={item.shown ? palette.text : palette.textFaint} />
            <View style={styles.text}>
              <View style={styles.titleRow}>
                <Text style={[styles.who, { color: item.shown ? palette.text : palette.textMuted }]} numberOfLines={1}>
                  {who}
                </Text>
                {item.version ? <Text style={[styles.version, { color: palette.textFaint, borderColor: palette.border }]}>{`${item.version.index + 1}/${item.version.count}`}</Text> : null}
              </View>
              <Text style={[styles.preview, { color: item.shown ? palette.text : palette.textMuted }]} numberOfLines={2}>
                {item.text || '…'}
              </Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  intro: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, paddingHorizontal: 16, paddingVertical: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingRight: 16, paddingVertical: 9 },
  bar: { position: 'absolute', left: 0, top: 6, bottom: 6, width: 3, borderRadius: 2 },
  text: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  who: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 13 },
  version: { fontFamily: fonts.medium, fontSize: 11, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 5, overflow: 'hidden' },
  preview: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 19 },
});
