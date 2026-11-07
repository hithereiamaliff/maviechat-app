import type { InputVariable } from '@maviechat/owui-protocol';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { fonts, radius, usePalette } from '@/theme';

const KEYBOARDS: Record<string, KeyboardTypeOptions> = { email: 'email-address', url: 'url', tel: 'phone-pad', number: 'decimal-pad', range: 'decimal-pad' };
const HINTS: Record<string, string> = {
  date: 'YYYY-MM-DD',
  time: 'HH:MM',
  'datetime-local': 'YYYY-MM-DD HH:MM',
  month: 'YYYY-MM',
  week: 'YYYY-W01',
  color: '#RRGGBB',
};

/** The values a saved prompt asks for before it goes in the input, as the web's form asks them. */
export function PromptVariablesSheet({ variables, onCancel, onInsert }: { variables: InputVariable[] | null; onCancel: () => void; onInsert: (values: Record<string, string>) => void }) {
  return (
    <Modal visible={variables !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      {variables ? <Form variables={variables} onCancel={onCancel} onInsert={onInsert} /> : null}
    </Modal>
  );
}

const label = (name: string) => name.replace(/[_-]+/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());

function Form({ variables, onCancel, onInsert }: { variables: InputVariable[]; onCancel: () => void; onInsert: (values: Record<string, string>) => void }) {
  const palette = usePalette();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(variables.map((variable) => [variable.name, variable.default ?? (variable.type === 'checkbox' ? 'false' : '')])));
  const set = (name: string, value: string) => setValues((current) => ({ ...current, [name]: value }));
  const ready = variables.every((variable) => !variable.required || (values[variable.name] ?? '').trim() !== '');
  const input = [styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }];

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={8}>
          <Text style={[styles.link, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          Fill In the Prompt
        </Text>
        <View style={styles.spacer} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {variables.map((variable, index) => (
          <View key={variable.name} style={styles.field}>
            <Text style={[styles.fieldLabel, { color: palette.textMuted }]}>{`${label(variable.name)}${variable.required ? ' · required' : ''}`}</Text>
            {variable.type === 'select' && variable.options.length ? (
              variable.options.map((option) => {
                const on = values[variable.name] === option;
                return (
                  <Pressable
                    key={option}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    onPress={() => set(variable.name, option)}
                    style={[styles.option, { borderColor: on ? palette.text : palette.border }]}>
                    <Text style={[styles.optionText, { color: palette.text }]}>{option}</Text>
                    {on ? <Icon name="check" size={16} color={palette.text} strokeWidth={2} /> : null}
                  </Pressable>
                );
              })
            ) : variable.type === 'checkbox' ? (
              <Switch value={values[variable.name] === 'true'} onValueChange={(on) => set(variable.name, on ? 'true' : 'false')} accessibilityLabel={label(variable.name)} />
            ) : (
              <TextInput
                value={values[variable.name] ?? ''}
                onChangeText={(value) => set(variable.name, value)}
                placeholder={variable.placeholder ?? HINTS[variable.type] ?? ''}
                placeholderTextColor={palette.textFaint}
                keyboardType={KEYBOARDS[variable.type] ?? 'default'}
                autoCapitalize={variable.type === 'email' || variable.type === 'url' ? 'none' : 'sentences'}
                multiline={variable.type === 'textarea'}
                autoFocus={index === 0}
                textAlignVertical={variable.type === 'textarea' ? 'top' : 'center'}
                style={[input, variable.type === 'textarea' && styles.textarea]}
                accessibilityLabel={label(variable.name)}
              />
            )}
            {variable.type === 'range' && (variable.min !== undefined || variable.max !== undefined) ? (
              <Text style={[styles.hint, { color: palette.textFaint }]}>{`From ${variable.min ?? '…'} to ${variable.max ?? '…'}`}</Text>
            ) : null}
          </View>
        ))}
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: palette.border }]}>
        <Button label="Insert" onPress={() => onInsert(values)} disabled={!ready} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 },
  link: { fontFamily: fonts.medium, fontSize: 16, minWidth: 60 },
  title: { fontFamily: fonts.semibold, fontSize: 17 },
  spacer: { minWidth: 60 },
  content: { paddingHorizontal: 16, paddingBottom: 24, gap: 14 },
  field: { gap: 6 },
  fieldLabel: { fontFamily: fonts.medium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 15 },
  textarea: { minHeight: 100 },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10 },
  optionText: { fontFamily: fonts.regular, fontSize: 15 },
  hint: { fontFamily: fonts.regular, fontSize: 12 },
  footer: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
});
