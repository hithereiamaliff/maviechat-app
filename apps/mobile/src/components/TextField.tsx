import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { fonts, radius, usePalette } from '@/theme';

interface TextFieldProps extends TextInputProps {
  label: string;
}

export function TextField({ label, style, ...inputProps }: TextFieldProps) {
  const palette = usePalette();

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: palette.textMuted }]}>{label}</Text>
      <TextInput
        placeholderTextColor={palette.textMuted}
        accessibilityLabel={label}
        style={[
          styles.input,
          { backgroundColor: palette.surface, borderColor: palette.border, color: palette.text },
          style,
        ]}
        {...inputProps}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: 6,
  },
  label: {
    fontFamily: fonts.medium,
    fontSize: 13,
  },
  input: {
    minHeight: 46,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    fontFamily: fonts.regular,
    fontSize: 16,
  },
});
