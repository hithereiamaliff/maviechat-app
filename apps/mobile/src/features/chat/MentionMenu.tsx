import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { fonts, radius, usePalette } from '@/theme';

export interface MenuEntry {
  key: string;
  /** Entries are grouped under their section, in the order sections first appear. */
  section: string;
  icon: IconName;
  /** Shown in place of the icon (an emoji). */
  glyph?: string;
  title: string;
  subtitle?: string;
  onPick: () => void;
}

/**
 * The list above the input while you type `/`, `@`, `#`, `$` or `:`: commands and saved prompts,
 * models, knowledge and web pages to bring in, skills, or emoji. Tapping one picks it; typing on
 * narrows the list.
 */
export function MentionMenu({ entries, loading, empty }: { entries: MenuEntry[]; loading: boolean; empty: string }) {
  const palette = usePalette();
  const sections: string[] = [];
  for (const entry of entries) if (!sections.includes(entry.section)) sections.push(entry.section);
  return (
    <View style={[styles.panel, { borderColor: palette.border, backgroundColor: palette.menu }]}>
      <ScrollView keyboardShouldPersistTaps="always" contentContainerStyle={styles.content}>
        {sections.map((section) => (
          <View key={section}>
            <Text style={[styles.section, { color: palette.textFaint }]}>{section}</Text>
            {entries
              .filter((entry) => entry.section === section)
              .map((entry) => (
                <Pressable
                  key={entry.key}
                  accessibilityRole="button"
                  onPress={entry.onPick}
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: palette.surfaceStrong }]}>
                  {entry.glyph ? <Text style={styles.glyph}>{entry.glyph}</Text> : <Icon name={entry.icon} size={17} color={palette.textMuted} />}
                  <View style={styles.text}>
                    <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
                      {entry.title}
                    </Text>
                    {entry.subtitle ? (
                      <Text style={[styles.subtitle, { color: palette.textMuted }]} numberOfLines={1}>
                        {entry.subtitle}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              ))}
          </View>
        ))}
        {entries.length === 0 ? (
          <View style={styles.empty}>
            {loading ? <ActivityIndicator size="small" color={palette.textMuted} /> : <Text style={[styles.subtitle, { color: palette.textMuted }]}>{empty}</Text>}
          </View>
        ) : loading ? (
          <ActivityIndicator style={styles.more} size="small" color={palette.textFaint} />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { maxHeight: 260, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, marginBottom: 6, overflow: 'hidden' },
  content: { paddingVertical: 6 },
  section: { fontFamily: fonts.medium, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, paddingHorizontal: 14, paddingTop: 6, paddingBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  text: { flex: 1, gap: 1 },
  title: { fontFamily: fonts.medium, fontSize: 15 },
  subtitle: { fontFamily: fonts.regular, fontSize: 12 },
  glyph: { fontSize: 18, width: 22, textAlign: 'center' },
  empty: { paddingHorizontal: 14, paddingVertical: 10 },
  more: { marginVertical: 6 },
});
