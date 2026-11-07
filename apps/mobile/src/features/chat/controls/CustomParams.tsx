import type { CustomParam } from '@maviechat/owui-protocol';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { fonts, radius, usePalette } from '@/theme';

/**
 * Custom parameters by name, as admins add them on the web (a model's, a chat's or their own
 * defaults): each sent as it is, the server reading JSON where it's valid. A row without a name
 * isn't saved.
 */
export function CustomParams({ rows, onChange, readOnly = false }: { rows: CustomParam[]; onChange: (rows: CustomParam[]) => void; readOnly?: boolean }) {
  const palette = usePalette();
  const field = [styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }];
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: palette.text }]}>Custom parameters</Text>
      <Text style={[styles.note, { color: palette.textMuted }]}>Sent to the model as they are; JSON is read where it’s valid.</Text>
      {rows.map((item, index) => (
        <View key={index} style={styles.row}>
          <TextInput value={item.name} onChangeText={(name) => onChange(rows.map((row, i) => (i === index ? { ...row, name } : row)))} editable={!readOnly} placeholder="name" placeholderTextColor={palette.textFaint} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Parameter name" style={field} />
          <TextInput value={item.value} onChangeText={(value) => onChange(rows.map((row, i) => (i === index ? { ...row, value } : row)))} editable={!readOnly} placeholder="value" placeholderTextColor={palette.textFaint} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Parameter value" style={field} />
          {readOnly ? null : (
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.name.trim() || 'this parameter'}`} onPress={() => onChange(rows.filter((_, i) => i !== index))} hitSlop={8}>
              <Icon name="x-mark" size={16} color={palette.textMuted} />
            </Pressable>
          )}
        </View>
      ))}
      {readOnly ? null : (
        <Pressable accessibilityRole="button" onPress={() => onChange([...rows, { name: '', value: '' }])} hitSlop={6} style={styles.add}>
          <Text style={[styles.link, { color: palette.link }]}>Add a Custom Parameter</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  label: { fontFamily: fonts.medium, fontSize: 14 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 8, fontFamily: fonts.mono, fontSize: 13 },
  add: { alignSelf: 'flex-start' },
  link: { fontFamily: fonts.medium, fontSize: 14 },
});
