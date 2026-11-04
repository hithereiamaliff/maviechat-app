import { formValue, settingShown, settingValues, type SettingEdits, type SettingField, type SettingOption, type SettingSection } from '@maviechat/owui-protocol';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Group, Note, SectionTitle, SwitchRow } from '@/features/settings/rows';
import { Chip } from '@/features/workspace/ListControls';
import { fonts, radius, usePalette } from '@/theme';

/**
 * A settings page drawn from its sections: each field shows what's stored, or the admin's edit
 * of it. Fields that depend on a switch show only while it's on, as on the web.
 */
export function SettingsForm({ sections, stored, edits, onEdit, options = {} }: { sections: SettingSection[]; stored: Record<string, unknown>; edits: SettingEdits; onEdit: (key: string, value: string | boolean) => void; options?: Record<string, SettingOption[]> }) {
  const fields = sections.flatMap((section) => section.fields);
  const values = settingValues(fields, stored, edits);
  return (
    <>
      {sections.map((section) => {
        const shown = section.fields.filter((field) => settingShown(field, values));
        if (!shown.length) return null;
        return (
          <View key={section.title} style={styles.section}>
            <SectionTitle title={section.title} />
            <Group>
              {shown.map((field) => {
                const value = field.key in edits ? (edits[field.key] as string | boolean) : formValue(field, stored[field.key]);
                return field.kind === 'switch' ? (
                  <SwitchRow key={field.key} label={field.label} hint={field.hint} value={value === true} onChange={(on) => onEdit(field.key, on)} />
                ) : (
                  <FieldRow key={field.key} field={field} value={String(value)} onChange={(next) => onEdit(field.key, next)} options={field.optionsFrom ? (options[field.optionsFrom] ?? []) : (field.options ?? [])} />
                );
              })}
            </Group>
            {section.note ? <Note>{section.note}</Note> : null}
          </View>
        );
      })}
    </>
  );
}

function FieldRow({ field, value, onChange, options }: { field: SettingField; value: string; onChange: (value: string) => void; options: SettingOption[] }) {
  const palette = usePalette();
  const [revealed, setRevealed] = useState(false);
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: palette.text }]}>{field.label}</Text>
      {field.hint ? <Text style={[styles.hint, { color: palette.textMuted }]}>{field.hint}</Text> : null}
      {field.kind === 'select' ? (
        <View style={styles.chips}>
          {options.map((option) => (
            <Chip key={option.value || 'none'} label={option.label} on={value === option.value} onPress={() => onChange(option.value)} />
          ))}
          {options.length && !options.some((option) => option.value === value) && value ? <Text style={[styles.hint, { color: palette.textMuted }]}>{`Now: ${value}`}</Text> : null}
        </View>
      ) : (
        <View style={styles.inputRow}>
          <TextInput
            value={value}
            onChangeText={onChange}
            multiline={field.kind === 'multiline'}
            secureTextEntry={field.kind === 'secret' && !revealed}
            keyboardType={field.kind === 'number' ? 'numbers-and-punctuation' : 'default'}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            placeholder={field.kind === 'number' ? (field.empty ?? '') : ''}
            placeholderTextColor={palette.textFaint}
            accessibilityLabel={field.label}
            style={[styles.input, field.kind === 'multiline' && styles.multiline, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
          />
          {field.kind === 'secret' ? (
            <Pressable accessibilityRole="button" accessibilityLabel={revealed ? 'Hide it' : 'Show it'} onPress={() => setRevealed(!revealed)} hitSlop={8}>
              <Icon name={revealed ? 'eye-slash' : 'eye'} size={18} color={palette.textMuted} />
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 6 },
  row: { gap: 6, paddingHorizontal: 14, paddingVertical: 10 },
  label: { fontFamily: fonts.regular, fontSize: 15 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.regular, fontSize: 15 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
});
