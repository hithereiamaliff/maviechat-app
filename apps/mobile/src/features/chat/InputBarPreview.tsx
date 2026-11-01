import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { fonts, usePalette } from '@/theme';

/**
 * The input bar's layout, not yet active: sending arrives in the next slice of
 * milestone 1 (over the air, no new install).
 */
export function InputBarPreview({ modelLabel, floating = false }: { modelLabel?: string; floating?: boolean }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrap, !floating && { paddingBottom: insets.bottom + 8 }]}>
      <View style={[styles.box, { borderColor: palette.border, backgroundColor: palette.background }]}>
        <Text style={[styles.placeholder, { color: palette.textFaint }]}>Send a message</Text>
        <View style={styles.row}>
          <View style={[styles.round, { borderColor: palette.border }]}>
            <Icon name="plus" size={18} color={palette.textFaint} />
          </View>
          <View style={styles.spacer} />
          {modelLabel ? (
            <Text style={[styles.model, { color: palette.textMuted }]} numberOfLines={1}>
              {modelLabel}
            </Text>
          ) : null}
          <View style={[styles.send, { backgroundColor: palette.surfaceStrong }]}>
            <Icon name="arrow-up" size={18} color={palette.textFaint} strokeWidth={2} />
          </View>
        </View>
      </View>
      <Text style={[styles.note, { color: palette.textFaint }]}>Sending arrives in the next update.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 6, gap: 6 },
  box: { borderWidth: 1, borderRadius: 26, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8, gap: 10 },
  placeholder: { fontFamily: fonts.regular, fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  round: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  spacer: { flex: 1 },
  model: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 13 },
  send: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  note: { fontFamily: fonts.regular, fontSize: 12, textAlign: 'center' },
});
