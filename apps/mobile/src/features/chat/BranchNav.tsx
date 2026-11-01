import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { fonts, usePalette } from '@/theme';

/** The "‹ 2/3 ›" control for messages with sibling branches. */
export function BranchNav({
  index,
  count,
  onStep,
}: {
  index: number;
  count: number;
  onStep: (step: -1 | 1) => void;
}) {
  const palette = usePalette();
  if (count < 2) return null;
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Previous version"
        disabled={index === 0}
        hitSlop={8}
        onPress={() => onStep(-1)}
        style={{ opacity: index === 0 ? 0.35 : 1 }}>
        <Icon name="chevron-left" size={16} color={palette.textMuted} strokeWidth={2} />
      </Pressable>
      <Text style={[styles.label, { color: palette.textMuted }]}>
        {index + 1}/{count}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next version"
        disabled={index === count - 1}
        hitSlop={8}
        onPress={() => onStep(1)}
        style={{ opacity: index === count - 1 ? 0.35 : 1 }}>
        <Icon name="chevron-right" size={16} color={palette.textMuted} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  label: { fontFamily: fonts.medium, fontSize: 13, minWidth: 28, textAlign: 'center' },
});
