import { Children, isValidElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { fonts, radius, usePalette } from '@/theme';

/** A caption over a group of rows, as the settings tabs use them. */
export function SectionTitle({ title }: { title: string }) {
  const palette = usePalette();
  return (
    <Text accessibilityRole="header" style={[styles.section, { color: palette.textMuted }]}>
      {title}
    </Text>
  );
}

/** Rows in a rounded box, with hairlines between them. */
export function Group({ children }: { children: ReactNode }) {
  const palette = usePalette();
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={[styles.group, { borderColor: palette.border }]}>
      {rows.map((row, index) => (
        <View key={row.key ?? index} style={index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border } : undefined}>
          {row}
        </View>
      ))}
    </View>
  );
}

/** A setting that's on or off, with what it does in a line under it. */
export function SwitchRow({ label, hint, value, onChange, disabled = false }: { label: string; hint?: string; value: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  const palette = usePalette();
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={[styles.label, { color: disabled ? palette.textMuted : palette.text }]}>{label}</Text>
        {hint ? <Text style={[styles.hint, { color: palette.textMuted }]}>{hint}</Text> : null}
      </View>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange} disabled={disabled} />
    </View>
  );
}

/** A row that opens something (or does something) when tapped. */
export function ActionRow({ label, hint, value, onPress, destructive = false, disabled = false }: { label: string; hint?: string; value?: string; onPress: () => void; destructive?: boolean; disabled?: boolean }) {
  const palette = usePalette();
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: palette.surface }]}>
      <View style={styles.text}>
        <Text style={[styles.label, { color: disabled ? palette.textFaint : destructive ? palette.danger : palette.text }]}>{label}</Text>
        {hint ? <Text style={[styles.hint, { color: palette.textMuted }]}>{hint}</Text> : null}
      </View>
      {value ? <Text style={[styles.value, { color: palette.textMuted }]}>{value}</Text> : null}
      {!destructive ? <Icon name="chevron-right" size={14} color={palette.textFaint} /> : null}
    </Pressable>
  );
}

/** Small print under a group. */
export function Note({ children }: { children: ReactNode }) {
  const palette = usePalette();
  return <Text style={[styles.note, { color: palette.textFaint }]}>{children}</Text>;
}

export const rowStyles = StyleSheet.create({
  content: { padding: 16, gap: 8, paddingBottom: 48 },
});

const styles = StyleSheet.create({
  section: { fontFamily: fonts.medium, fontSize: 13, marginLeft: 4, marginTop: 12 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46, paddingHorizontal: 14, paddingVertical: 10 },
  text: { flex: 1, gap: 2 },
  label: { fontFamily: fonts.regular, fontSize: 15 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  value: { fontFamily: fonts.regular, fontSize: 14 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, marginHorizontal: 4, marginTop: 4 },
});
