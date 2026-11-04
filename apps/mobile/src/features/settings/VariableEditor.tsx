import { VARIABLE_KEY, VARIABLE_VALUE_LIMIT, variableTag, type Variable } from '@maviechat/owui-protocol';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { fonts, radius, usePalette } from '@/theme';

/**
 * Adds or edits one of your variables, in a sheet: a name (lower case, letters, digits and _) and
 * its value. Done changes the list; the Account tab's Save sends it.
 */
export function VariableEditor({
  variable,
  taken,
  onDone,
  onDelete,
  onClose,
}: {
  /** `'new'` to add one. */
  variable: Variable | 'new' | null;
  /** Names already used by the other variables. */
  taken: string[];
  onDone: (variable: Variable) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={variable !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {variable !== null ? <Editor key={variable === 'new' ? 'new' : variable.key} variable={variable} taken={taken} onDone={onDone} onDelete={onDelete} onClose={onClose} /> : null}
    </Modal>
  );
}

function Editor({ variable, taken, onDone, onDelete, onClose }: { variable: Variable | 'new'; taken: string[]; onDone: (variable: Variable) => void; onDelete: () => void; onClose: () => void }) {
  const palette = usePalette();
  const existing = variable === 'new' ? null : variable;
  const [key, setKey] = useState(existing?.key ?? '');
  const [value, setValue] = useState(existing?.value ?? '');
  const name = key.trim();
  const problem = !name ? null : !VARIABLE_KEY.test(name) ? 'Use lower-case letters, digits and _, starting with a letter.' : taken.includes(name) ? 'You have a variable with this name.' : value.length > VARIABLE_VALUE_LIMIT ? 'The value is too long.' : null;
  const ready = Boolean(name) && !problem;

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.action, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          {existing ? 'Edit Variable' : 'Add Variable'}
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={!ready}
          onPress={() => {
            onDone({ key: name, value });
            onClose();
          }}
          hitSlop={10}>
          <Text style={[styles.action, styles.strong, { color: ready ? palette.link : palette.textFaint }]}>Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.label, { color: palette.textMuted }]}>Name</Text>
        <TextInput
          value={key}
          onChangeText={setKey}
          placeholder="city"
          placeholderTextColor={palette.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={!existing}
          accessibilityLabel="Name"
          style={[styles.input, { color: palette.text, borderColor: problem ? palette.danger : palette.border, backgroundColor: palette.surface }]}
        />
        <Text style={[styles.hint, { color: problem ? palette.danger : palette.textFaint }]}>{problem ?? `In a system prompt: ${variableTag(name || 'name')}`}</Text>
        <Text style={[styles.label, { color: palette.textMuted }]}>Value</Text>
        <TextInput
          value={value}
          onChangeText={setValue}
          placeholder="Kuala Lumpur"
          placeholderTextColor={palette.textFaint}
          multiline
          textAlignVertical="top"
          accessibilityLabel="Value"
          style={[styles.input, styles.multiline, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
        />
        {existing ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onDelete();
              onClose();
            }}
            style={styles.delete}>
            <Text style={[styles.deleteText, { color: palette.danger }]}>Delete Variable</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  action: { fontFamily: fonts.regular, fontSize: 16 },
  strong: { fontFamily: fonts.semibold },
  content: { padding: 16, gap: 6, paddingBottom: 48 },
  label: { fontFamily: fonts.medium, fontSize: 13, marginTop: 8, marginLeft: 4 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginHorizontal: 4 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 15 },
  multiline: { minHeight: 120, lineHeight: 21 },
  delete: { alignSelf: 'center', marginTop: 24, padding: 8 },
  deleteText: { fontFamily: fonts.medium, fontSize: 15 },
});
