import { Pressable, StyleSheet, Text } from 'react-native';
import { Icon } from '@/components/Icon';
import { fonts, usePalette } from '@/theme';

/** Under a text field: opens the comparison with a pasted revision. */
export function CompareLink({ onPress }: { onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable accessibilityRole="button" accessibilityHint="Compare this text with a revision you paste" onPress={onPress} hitSlop={6} style={styles.link}>
      <Icon name="arrows-right-left" size={14} color={palette.link} />
      <Text style={[styles.text, { color: palette.link }]}>Compare with a Revision…</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingVertical: 2 },
  text: { fontFamily: fonts.medium, fontSize: 13 },
});
