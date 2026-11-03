import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from '@/components/IconButton';
import { fonts, radius, usePalette } from '@/theme';

/** A details page pushed from the account menu (Connection in either space): back, a heading, then sections of rows. */
export function DetailScreen({ title, heading, subheading, children }: { title: string; heading: string; subheading: string; children: ReactNode }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} />
        <Text style={[styles.headerTitle, { color: palette.text }]}>{title}</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.titleBlock}>
          <Text style={[styles.title, { color: palette.text }]}>{heading}</Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>{subheading}</Text>
        </View>
        {children}
      </ScrollView>
    </View>
  );
}

export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  const palette = usePalette();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: palette.textMuted }]}>{title}</Text>
      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>{children}</View>
    </View>
  );
}

export function DetailRow({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'warning' }) {
  const palette = usePalette();
  const valueColor = tone === 'success' ? palette.success : tone === 'warning' ? palette.warning : palette.text;
  return (
    <View style={[styles.row, { borderBottomColor: palette.border }]}>
      <Text style={[styles.rowLabel, { color: palette.textMuted }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
  headerTitle: { fontFamily: fonts.medium, fontSize: 16 },
  content: { paddingHorizontal: 20, gap: 24, paddingTop: 8 },
  titleBlock: { gap: 4 },
  title: { fontFamily: fonts.semibold, fontSize: 22 },
  subtitle: { fontFamily: fonts.regular, fontSize: 14 },
  section: { gap: 8 },
  sectionTitle: { fontFamily: fonts.medium, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.4 },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { fontFamily: fonts.regular, fontSize: 15 },
  rowValue: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 15, textAlign: 'right' },
});
