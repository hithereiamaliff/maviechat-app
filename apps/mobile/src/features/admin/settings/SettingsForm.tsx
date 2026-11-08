import { formValue, settingShown, settingValues, type SettingEdits, type SettingField, type SettingOption, type SettingSection } from '@maviechat/owui-protocol';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { Group, Note, SectionTitle, SwitchRow } from '@/features/settings/rows';
import { Chip } from '@/features/workspace/ListControls';
import { fonts, radius, usePalette } from '@/theme';

/**
 * A settings page drawn from its sections: each field shows what's stored, or the admin's edit
 * of it. Fields that depend on a switch show only while it's on, as on the web.
 */
export function SettingsForm({
  sections,
  stored,
  edits,
  onEdit,
  options = {},
  readOnly = false,
}: {
  sections: SettingSection[];
  stored: Record<string, unknown>;
  edits: SettingEdits;
  onEdit: (key: string, value: string | boolean) => void;
  options?: Record<string, SettingOption[]>;
  /** Shown, not changed (the server keeps them elsewhere). */
  readOnly?: boolean;
}) {
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
                  <SwitchRow key={field.key} label={field.label} hint={field.hint} value={value === true} onChange={(on) => onEdit(field.key, on)} disabled={readOnly} />
                ) : (
                  <FieldRow key={field.key} field={field} value={String(value)} onChange={(next) => onEdit(field.key, next)} options={field.optionsFrom ? (options[field.optionsFrom] ?? []) : (field.options ?? [])} readOnly={readOnly} />
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

function FieldRow({ field, value, onChange, options, readOnly }: { field: SettingField; value: string; onChange: (value: string) => void; options: SettingOption[]; readOnly: boolean }) {
  const palette = usePalette();
  const [revealed, setRevealed] = useState(false);
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: palette.text }]}>{field.label}</Text>
      {field.hint ? <Text style={[styles.hint, { color: palette.textMuted }]}>{field.hint}</Text> : null}
      {field.kind === 'select' && options.length > 6 ? (
        <OptionPicker label={field.label} value={value} options={options} onChange={onChange} disabled={readOnly} />
      ) : field.kind === 'select' ? (
        <View style={styles.chips}>
          {options.map((option) => (
            <Chip key={option.value || 'none'} label={option.label} on={value === option.value} onPress={() => (readOnly ? undefined : onChange(option.value))} />
          ))}
          {options.length && !options.some((option) => option.value === value) && value ? <Text style={[styles.hint, { color: palette.textMuted }]}>{`Now: ${value}`}</Text> : null}
        </View>
      ) : (
        <View style={styles.inputRow}>
          <TextInput
            value={value}
            onChangeText={onChange}
            editable={!readOnly}
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

/** A choice among many (models, say): the current one, and a searchable list to pick from. */
function OptionPicker({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: SettingOption[]; onChange: (value: string) => void; disabled?: boolean }) {
  const palette = usePalette();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const current = options.find((option) => option.value === value);
  const wanted = query.trim().toLowerCase();
  const shown = options.filter((option) => !wanted || `${option.label} ${option.value}`.toLowerCase().includes(wanted));
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${current?.label ?? (value || 'none')}`} disabled={disabled} onPress={() => setOpen(true)} style={[styles.picker, { borderColor: palette.border, backgroundColor: palette.surface }]}>
        <Text style={[styles.label, styles.flex, { color: palette.text }]} numberOfLines={1}>
          {current?.label ?? (value || 'None')}
        </Text>
        <Icon name="chevron-down" size={14} color={palette.textMuted} />
      </Pressable>
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <View style={[styles.sheet, { backgroundColor: palette.background }]}>
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: palette.text }]} numberOfLines={1}>
              {label}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => setOpen(false)} hitSlop={10}>
              <Text style={[styles.label, { color: palette.link }]}>Done</Text>
            </Pressable>
          </View>
          <View style={styles.pad}>
            <TextInput value={query} onChangeText={setQuery} placeholder="Search" placeholderTextColor={palette.textFaint} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" accessibilityLabel="Search" style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
          </View>
          <ScrollView contentContainerStyle={styles.options} keyboardShouldPersistTaps="handled">
            {shown.map((option) => (
              <Pressable
                key={option.value || 'none'}
                accessibilityRole="button"
                accessibilityState={{ selected: option.value === value }}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={({ pressed }) => [styles.option, pressed && { backgroundColor: palette.surface }]}>
                <Text style={[styles.label, styles.flex, { color: palette.text }]} numberOfLines={1}>
                  {option.label}
                </Text>
                {option.value === value ? <Icon name="check" size={16} color={palette.link} /> : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
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
  flex: { flex: 1 },
  picker: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10 },
  sheet: { flex: 1 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  sheetTitle: { flex: 1, fontFamily: fonts.semibold, fontSize: 17 },
  pad: { paddingHorizontal: 16, paddingBottom: 8 },
  options: { paddingHorizontal: 8, paddingBottom: 48 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 12, borderRadius: radius.md },
});
