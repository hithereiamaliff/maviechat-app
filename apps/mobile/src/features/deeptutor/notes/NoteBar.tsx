import { noteTitle } from '@maviechat/deeptutor-protocol';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { fonts, usePalette } from '@/theme';
import { useNotePage } from './queries';

/** Above a conversation with Dito: the Co-Writer page it's about, which it can read and suggest edits to. */
export function NoteBar({ pageId }: { pageId: string }) {
  const palette = usePalette();
  const page = useNotePage(pageId);
  const missing = page.isError;
  return (
    <View style={[styles.wrap, { borderBottomColor: palette.border }]}>
      <Pressable accessibilityRole="button" accessibilityHint="Opens the page" disabled={missing} onPress={() => router.push({ pathname: '/learn/notes/[id]', params: { id: pageId } })} style={styles.row} hitSlop={4}>
        {page.data?.icon ? <Text style={styles.emoji}>{page.data.icon}</Text> : <Icon name="pencil-square" size={16} color={palette.textMuted} />}
        <View style={styles.text}>
          <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
            {missing ? 'A page that is no longer here' : page.data ? noteTitle(page.data) : 'Co-Writer page'}
          </Text>
          <Text style={[styles.sub, { color: palette.textMuted }]}>Dito reads this page and suggests edits; nothing changes until you accept one.</Text>
        </View>
        {missing ? null : <Icon name="chevron-right" size={14} color={palette.textFaint} />}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  emoji: { fontSize: 16 },
  text: { flex: 1, gap: 1 },
  title: { fontFamily: fonts.medium, fontSize: 14 },
  sub: { fontFamily: fonts.regular, fontSize: 11 },
});
