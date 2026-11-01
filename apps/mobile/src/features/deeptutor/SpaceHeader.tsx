import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, usePalette } from '@/theme';

/** The DeepTutor space's slim native bar: a leading button, a title, trailing buttons. */
export function SpaceHeader({ leading, title, subtitle, trailing }: { leading: ReactNode; title: string; subtitle?: string; trailing?: ReactNode }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 4, borderBottomColor: palette.border }]}>
      {leading}
      <View style={styles.titles}>
        <Text style={[styles.title, { color: palette.text }]} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: palette.textFaint }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  titles: { flex: 1, marginHorizontal: 4 },
  title: { fontFamily: fonts.semibold, fontSize: 16 },
  subtitle: { fontFamily: fonts.regular, fontSize: 12 },
});
