import { coverColor, noteTitle, type DtNoteSummary } from '@maviechat/deeptutor-protocol';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { MenuButton, type MenuItem } from '@/components/Menu';
import { shortWhen } from '@/features/deeptutor/partners/labels';
import { fonts, radius, usePalette } from '@/theme';

/** A page in a list: its cover's colour, icon, title, first words, when it changed, its subpages. */
export function NoteRow({ page, subpages = 0, parent, menu, onPress }: { page: DtNoteSummary; subpages?: number; parent?: string; menu?: MenuItem[]; onPress: () => void }) {
  const palette = usePalette();
  const tint = coverColor(page.cover);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[noteTitle(page), page.pinned ? 'pinned' : '', page.preview].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { borderColor: palette.border, backgroundColor: pressed ? palette.surface : 'transparent' }]}>
      <View style={[styles.mark, { backgroundColor: tint || palette.surfaceStrong }]}>{page.icon ? <Text style={styles.emoji}>{page.icon}</Text> : <Icon name="document-text" size={18} color={palette.textMuted} />}</View>
      <View style={styles.text}>
        <View style={styles.titleLine}>
          <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
            {noteTitle(page)}
          </Text>
          {page.pinned ? <Icon name="bookmark" size={12} color={palette.textMuted} /> : null}
        </View>
        {parent ? <Text style={[styles.meta, { color: palette.textFaint }]} numberOfLines={1}>{`In ${parent}`}</Text> : null}
        <Text style={[styles.preview, { color: page.preview ? palette.textMuted : palette.textFaint }]} numberOfLines={2}>
          {page.preview || 'Empty page'}
        </Text>
        <Text style={[styles.meta, { color: palette.textFaint }]}>{[shortWhen(page.updatedAt), subpages ? `${subpages} ${subpages === 1 ? 'subpage' : 'subpages'}` : ''].filter(Boolean).join(' · ')}</Text>
      </View>
      {menu?.length ? <MenuButton label={`Options for ${noteTitle(page)}`} size={18} color={palette.textMuted} items={menu} /> : <Icon name="chevron-right" size={14} color={palette.textFaint} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  mark: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 20 },
  text: { flex: 1, gap: 2 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 15 },
  preview: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  meta: { fontFamily: fonts.regular, fontSize: 11 },
});
