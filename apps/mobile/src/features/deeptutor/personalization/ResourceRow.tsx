import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { MenuButton, type MenuItem } from '@/components/Menu';
import { fonts, radius, usePalette } from '@/theme';

/** A persona or skill in a list: its name, where it comes from, what it's for, its tags. */
export function ResourceRow({ name, description, badge, tags = [], menu, onPress }: { name: string; description: string; badge?: string; tags?: string[]; menu?: MenuItem[]; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[name, badge, description].filter(Boolean).join(', ')}
      accessibilityHint="Shows it"
      onPress={onPress}
      style={({ pressed }) => [styles.row, { borderColor: palette.border, backgroundColor: pressed ? palette.surface : 'transparent' }]}>
      <View style={styles.text}>
        <View style={styles.titleLine}>
          <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
            {name}
          </Text>
          {badge ? (
            <View style={[styles.badge, { backgroundColor: palette.surfaceStrong }]}>
              <Icon name="lock-closed" size={10} color={palette.textMuted} />
              <Text style={[styles.badgeText, { color: palette.textMuted }]}>{badge}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.description, { color: description ? palette.textMuted : palette.textFaint }]} numberOfLines={2}>
          {description || 'No description'}
        </Text>
        {tags.length ? (
          <View style={styles.tags}>
            {tags.map((tag) => (
              <Text key={tag} style={[styles.tag, { color: palette.textMuted, borderColor: palette.border }]}>
                {tag}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
      {menu?.length ? <MenuButton label={`Options for ${name}`} size={18} color={palette.textMuted} items={menu} /> : <Icon name="chevron-right" size={14} color={palette.textFaint} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  text: { flex: 1, gap: 4 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 15 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  badgeText: { fontFamily: fonts.medium, fontSize: 11 },
  description: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  tag: { fontFamily: fonts.regular, fontSize: 11, paddingHorizontal: 7, paddingVertical: 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: 9, overflow: 'hidden' },
});
