import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { fonts, radius, usePalette } from '@/theme';
import { setThemePreference, THEME_CHOICES, useThemePreference } from '@/theme/preference';

/** General: the theme, as in the web's General settings. Other settings come in M2. */
export function GeneralSettings() {
  const palette = usePalette();
  const preference = useThemePreference();

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={[styles.section, { color: palette.textMuted }]}>Theme</Text>
      <View style={[styles.group, { borderColor: palette.border }]}>
        {THEME_CHOICES.map((choice, index) => {
          const selected = choice.value === preference;
          return (
            <Pressable
              key={choice.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => setThemePreference(choice.value)}
              style={({ pressed }) => [
                styles.row,
                index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border },
                pressed && { backgroundColor: palette.surface },
              ]}>
              <Text style={[styles.label, { color: palette.text }]}>{choice.label}</Text>
              {selected ? <Icon name="check" size={18} color={palette.text} strokeWidth={2} /> : null}
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.note, { color: palette.textFaint }]}>
        Saved on this iPhone, as the web app saves it per browser. Language, system prompt and the other settings come in a later update.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 8 },
  section: { fontFamily: fonts.medium, fontSize: 13, marginLeft: 4 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 46, paddingHorizontal: 14 },
  label: { flex: 1, fontFamily: fonts.regular, fontSize: 15 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, marginHorizontal: 4, marginTop: 4 },
});
